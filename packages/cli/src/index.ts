#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { parseArgs } from "./args.js";
import { startRecorder } from "./recorder.js";
import { startUIServer } from "./server.js";
import { replayAndScreenshot } from "./replayer.js";
import { executeAction } from "./actions.js";
import { generateDiff } from "./diff.js";
import { log, logError } from "./logger.js";
import { 
  nowId, 
  ensureDirs, 
  writeJsonLines, 
  readJsonLines, 
  symlinkForce, 
  fileExists,
  binarySearchFrameByTimestamp
} from "./fs-utils.js";
import type { Config, RunMeta, FrameEntry, TabMeta } from "./types.js";

// Work directory must be explicitly set
const WORK_DIR = process.env.RCE_WORK_DIR || process.cwd();
const RCE_DIR = path.join(WORK_DIR, ".rce");
const DATA_DIR = path.join(RCE_DIR, "data");
const CURRENT_SYM = path.join(RCE_DIR, "current");

const DEFAULT_CONFIG: Config = {
  url: "http://localhost:3000",
  serverCmd: "npm run dev",
  bootWaitMs: 1500,
  headful: true,  // Default to headful (visible browser)
  viewport: { width: 1280, height: 800 },
  rrweb: {
    recordCanvas: true,
    collectFonts: true,
    sampling: { mousemove: 50, input: "last" }
  },
  ui: {
    port: 43210,
    screencastFps: 12,
    jpegQuality: 70
  }
};

async function loadConfig(): Promise<Config> {
  const configPath = path.join(process.cwd(), "rce.config.json");
  try {
    const configFile = await fs.readFile(configPath, "utf8");
    const userConfig = JSON.parse(configFile);
    return { ...DEFAULT_CONFIG, ...userConfig };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function jsonOutput(data: any, flags: any): void {
  if (flags.json) {
    console.log(JSON.stringify(data, null, 2));
  }
}

async function cmdDev(flags: any): Promise<void> {
  const config = await loadConfig();
  
  // Auto-stop any existing RCE instance to prevent port conflicts
  try {
    const currentExists = await fileExists(CURRENT_SYM);
    if (currentExists) {
      console.error("[rce] Stopping existing instance...");
      await cmdStop();
      
      // Wait for port to be released (try up to 5 seconds)
      const port = flags.port ? Number(flags.port) : 43210;
      let attempts = 0;
      const maxAttempts = 10;
      
      while (attempts < maxAttempts) {
        try {
          // Try to create a server on the port to check if it's free
          const testServer = http.createServer();
          await new Promise<void>((resolve, reject) => {
            testServer.once('error', reject);
            testServer.listen(port, () => {
              testServer.close(() => resolve());
            });
          });
          console.error("[rce] Port released, ready to start");
          break;
        } catch (e: any) {
          if (e.code === 'EADDRINUSE') {
            attempts++;
            console.error(`[rce] Waiting for port ${port} to be released... (${attempts}/${maxAttempts})`);
            await new Promise(resolve => setTimeout(resolve, 500));
          } else {
            break; // Other error, just continue
          }
        }
      }
    }
  } catch (err) {
    // Ignore errors - if stop fails, we'll try to start anyway
  }
  
  // Override config with CLI flags
  if (flags.url) config.url = flags.url;
  if (flags.serverCmd) config.serverCmd = flags.serverCmd;
  if (flags.bootWait) config.bootWaitMs = Number(flags.bootWait);
  if (flags.port) config.ui.port = Number(flags.port);
  if (flags.headless !== undefined) config.headful = !flags.headless; // --headless flag inverts headful
  
  // Clear storage state if requested (clears login, cookies, etc.)
  if (flags.clearState) {
    const storageStatePath = path.join(RCE_DIR, "storage-state.json");
    try {
      await fs.unlink(storageStatePath);
      console.error("[rce] Storage state cleared (fresh login required)");
    } catch {}
  }
  
  const runId = nowId();
  const runDir = path.join(DATA_DIR, runId);
  
  // Create run directory structure
  await ensureDirs(path.join(runDir, "meta"));
  await ensureDirs(path.join(runDir, "logs"));
  await ensureDirs(path.join(runDir, "rrweb"));
  await ensureDirs(path.join(runDir, "screenshots"));
  await ensureDirs(path.join(runDir, "diffs"));
  await ensureDirs(path.join(runDir, "actions"));
  await ensureDirs(path.join(runDir, "snapshots"));
  
  const startedAt = Date.now();
  
  // Write run metadata
  const meta: RunMeta = {
    runId,
    runDir,
    startedAt,
    url: config.url,
    viewport: config.viewport,
    headless: true
  };
  
  await fs.writeFile(
    path.join(runDir, "meta/recorder.meta.json"),
    JSON.stringify(meta, null, 2)
  );
  
  // Save main process PID for stopping
  await fs.writeFile(
    path.join(runDir, "main.pid"),
    String(process.pid)
  );
  
  // Symlink current
  await symlinkForce(runDir, CURRENT_SYM);
  
  // Start dev server if requested
  let serverProc: any = null;
  if (config.serverCmd && config.serverCmd !== "none") {
    const [cmd, ...args] = config.serverCmd.split(" ");
    serverProc = spawn(cmd, args, { 
      cwd: process.cwd(),
      stdio: "pipe"
    });
    
    const serverLog = path.join(runDir, "logs/server.log");
    const logStream = await fs.open(serverLog, "a");
    
    serverProc.stdout.on("data", (d: Buffer) => logStream.write(d));
    serverProc.stderr.on("data", (d: Buffer) => logStream.write(d));
    
    if (serverProc.pid) {
      await fs.writeFile(path.join(runDir, "server.pid"), String(serverProc.pid));
    }
    
    log(`[rce] Starting server: ${config.serverCmd}`);
    await new Promise(r => setTimeout(r, config.bootWaitMs));
  }
  
  // Register cleanup handler EARLY (before recorder starts)
  // This ensures Ctrl+C during startup cleans up properly
  let recorder: any = null;
  let isCleaningUp = false;
  const cleanup = async () => {
    if (isCleaningUp) return; // Prevent double cleanup
    isCleaningUp = true;
    
    console.error("\n[rce] Stopping...");
    
    // Storage state is saved on every navigation, so no need to save on exit
    
    // Close IPC server
    if (recorder?.stopFn) {
      await recorder.stopFn();
    }
    
    // Close browser
    if (recorder?.browser) {
      try {
        await recorder.browser.close();
      } catch {}
    }
    
    // Kill dev server
    if (serverProc) {
      serverProc.kill();
    }
    
    console.error("[rce] Cleanup complete");
    process.exit(0);
  };
  
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  
  // Start recorder
  log(`[rce] Starting recorder for ${config.url}`);
  recorder = await startRecorder(runDir, runId, config, startedAt);
  
  // Start UI server
  log(`[rce] Starting UI server on http://localhost:${config.ui.port}`);
  await startUIServer(runDir, meta, recorder.screencastEmitter, config.ui.port);
  
  log(`[rce] Run: ${runId}`);
  log(`[rce] Files in: ${runDir}`);
  log(`[rce] Press Ctrl+C to stop, or run "rce stop" from another shell`);
  
  jsonOutput({ ok: true, runId, runDir, meta }, flags);
  
  await new Promise(() => {}); // Keep process alive
}

async function cmdStop(): Promise<void> {
  try {
    const runDir = await fs.readlink(CURRENT_SYM);
    const resolvedRunDir = path.resolve(path.dirname(CURRENT_SYM), runDir);
    
    // Kill main RCE process (UI server, etc.)
    const mainPidPath = path.join(resolvedRunDir, "main.pid");
    if (await fileExists(mainPidPath)) {
      const pid = Number(await fs.readFile(mainPidPath, "utf8"));
      // Don't kill ourselves if we're the main process
      if (pid !== process.pid) {
        try { process.kill(pid, "SIGTERM"); } catch {}
        await new Promise(r => setTimeout(r, 100));
        try { process.kill(pid, "SIGKILL"); } catch {}
      }
      await fs.rm(mainPidPath, { force: true });
    }
    
    // Kill browser
    const browserPidPath = path.join(resolvedRunDir, "browser.pid");
    if (await fileExists(browserPidPath)) {
      const pid = Number(await fs.readFile(browserPidPath, "utf8"));
      try { process.kill(pid, "SIGTERM"); } catch {}
      await new Promise(r => setTimeout(r, 100));
      try { process.kill(pid, "SIGKILL"); } catch {}
      await fs.rm(browserPidPath, { force: true });
    }
    
    // Kill server
    const serverPidPath = path.join(resolvedRunDir, "server.pid");
    if (await fileExists(serverPidPath)) {
      const pid = Number(await fs.readFile(serverPidPath, "utf8"));
      try { process.kill(pid, "SIGTERM"); } catch {}
      await new Promise(r => setTimeout(r, 100));
      try { process.kill(pid, "SIGKILL"); } catch {}
      await fs.rm(serverPidPath, { force: true });
    }
    
    console.error("[rce] Stopped");
  } catch (error: any) {
    console.error("[rce] No active run or error stopping:", error.message);
    process.exit(1);
  }
}

async function cmdRestart(flags: any): Promise<void> {
  await cmdStop().catch(() => {});
  await new Promise(r => setTimeout(r, 1000));
  await cmdDev(flags);
}

async function cmdFrames(flags: any): Promise<void> {
  try {
    const runDir = await fs.readlink(CURRENT_SYM);
    const resolvedRunDir = path.resolve(path.dirname(CURRENT_SYM), runDir);
    
    const framesPath = path.join(resolvedRunDir, "rrweb/frames.jsonl");
    const frames = await readJsonLines<FrameEntry>(framesPath);
    
    if (flags.json) {
      console.log(JSON.stringify(frames, null, 2));
    } else {
      frames.forEach(f => {
        console.log(`${f.ts}#${f.k}  i=${f.i}${f.tabId !== undefined ? ` tab=${f.tabId}` : ""}`);
      });
    }
  } catch (error: any) {
    console.error("[rce] Error reading frames:", error.message);
    process.exit(1);
  }
}

async function cmdShot(flags: any): Promise<void> {
  try {
    const runDir = await fs.readlink(CURRENT_SYM);
    const resolvedRunDir = path.resolve(path.dirname(CURRENT_SYM), runDir);
    
    // Load events
    const eventsPath = path.join(resolvedRunDir, "rrweb/events.rrweb.jsonl");
    const eventsLines = await readJsonLines<any>(eventsPath);
    
    // Handle multi-tab: filter by tabId if specified
    const tabId = flags.tab !== undefined ? Number(flags.tab) : undefined;
    const events = tabId !== undefined 
      ? eventsLines.filter(e => e.tabId === tabId).map(e => e.event)
      : eventsLines.map(e => e.event);
    
    if (!events.length) {
      console.error("[rce] No events found");
      process.exit(1);
    }
    
    // Determine target index and auto-detect tab if not specified
    let targetIndex: number;
    let autoDetectedTabId: number | undefined = undefined;
    
    if (flags.index !== undefined) {
      targetIndex = Number(flags.index);
      
      // Auto-detect tab from frame index if not explicitly specified
      if (tabId === undefined) {
        const framesPath = path.join(resolvedRunDir, "rrweb/frames.jsonl");
        const frames = await readJsonLines<FrameEntry>(framesPath);
        const targetFrame = frames.find(f => f.i === targetIndex);
        if (targetFrame && targetFrame.tabId !== undefined) {
          autoDetectedTabId = targetFrame.tabId;
          console.error(`[rce] Auto-detected tabId ${autoDetectedTabId} from frame ${targetIndex}`);
        }
      }
    } else if (flags.ts !== undefined) {
      // Direct timestamp support with binary search (rounds down)
      const targetTs = Number(flags.ts);
      const framesPath = path.join(resolvedRunDir, "rrweb/frames.jsonl");
      const frames = await readJsonLines<FrameEntry>(framesPath);
      const filteredFrames = tabId !== undefined 
        ? frames.filter(f => f.tabId === tabId)
        : frames;
      
      const frame = binarySearchFrameByTimestamp(filteredFrames, targetTs);
      if (!frame) {
        console.error(`[rce] No frame found at or before timestamp ${targetTs}`);
        process.exit(1);
      }
      
      targetIndex = frame.i;
      autoDetectedTabId = frame.tabId;
      console.error(`[rce] Found frame ${targetIndex} at timestamp ${frame.ts} (closest to ${targetTs})`);
    } else if (flags.at) {
      const framesPath = path.join(resolvedRunDir, "rrweb/frames.jsonl");
      const frames = await readJsonLines<FrameEntry>(framesPath);
      const filteredFrames = tabId !== undefined 
        ? frames.filter(f => f.tabId === tabId)
        : frames;
      
      const at = String(flags.at);
      const firstTs = events[0].timestamp;
      
      if (at.includes("#")) {
        // ts#k format
        const [tsStr, kStr] = at.split("#");
        const ts = Number(tsStr);
        const k = Number(kStr);
        const frame = filteredFrames.find(f => f.ts === ts && f.k === k);
        if (!frame) {
          console.error(`[rce] Frame not found: ${at}`);
          process.exit(1);
        }
        targetIndex = frame.i;
      } else if (at.startsWith("+")) {
        // Offset from start
        const offset = Number(at.slice(1));
        const targetTs = firstTs + offset;
        const candidates = filteredFrames.filter(f => f.ts <= targetTs);
        if (!candidates.length) {
          console.error("[rce] No frame at or before that time");
          process.exit(1);
        }
        targetIndex = candidates[candidates.length - 1].i;
      } else {
        // ISO timestamp
        const targetTs = Date.parse(at);
        const candidates = filteredFrames.filter(f => f.ts <= targetTs);
        if (!candidates.length) {
          console.error("[rce] No frame at or before that time");
          process.exit(1);
        }
        targetIndex = candidates[candidates.length - 1].i;
      }
    } else {
      console.error('[rce] Usage: rce shot (--index N | --ts TIMESTAMP | --at "<ISO|+ms|ts#k>") [--out path] [--tab N]');
      process.exit(1);
    }
    
    // Load config for viewport
    const config = await loadConfig();
    
    // Use auto-detected tabId if no explicit tabId was provided
    const finalTabId = tabId ?? autoDetectedTabId;
    
    // Re-filter events if we auto-detected a different tab
    const finalEvents = finalTabId !== undefined && finalTabId !== tabId
      ? eventsLines.filter(e => e.tabId === finalTabId).map(e => e.event)
      : events;
    
    if (!finalEvents.length) {
      console.error(`[rce] No events found for tab ${finalTabId ?? tabId}`);
      process.exit(1);
    }
    
    console.error(`[rce] Using ${finalEvents.length} events from tab ${finalTabId ?? tabId ?? 0}`);
    
    // Generate screenshot
    const outPath = flags.out ?? path.join(resolvedRunDir, "screenshots", `shot_${Date.now()}.png`);
    const resultPath = await replayAndScreenshot(finalEvents, targetIndex, outPath, config.viewport);
    
    if (flags.json) {
      console.log(JSON.stringify({ ok: true, path: resultPath }, null, 2));
    } else {
      console.log(resultPath);
    }
  } catch (error: any) {
    console.error("[rce] Error taking screenshot:", error.message);
    if (flags.json) {
      console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
    }
    process.exit(1);
  }
}

async function cmdScreenshot(flags: any): Promise<void> {
  try {
    const runDir = await fs.readlink(CURRENT_SYM);
    const resolvedRunDir = path.resolve(path.dirname(CURRENT_SYM), runDir);
    
    const latestPath = path.join(resolvedRunDir, "screenshots/latest.png");
    
    if (!(await fileExists(latestPath))) {
      console.error("[rce] No latest screenshot available");
      process.exit(1);
    }
    
    if (flags.json) {
      console.log(JSON.stringify({ ok: true, path: latestPath }, null, 2));
    } else {
      console.log(latestPath);
    }
  } catch (error: any) {
    console.error("[rce] Error getting screenshot:", error.message);
    process.exit(1);
  }
}

async function cmdDiff(flags: any): Promise<void> {
  try {
    const runDir = await fs.readlink(CURRENT_SYM);
    const resolvedRunDir = path.resolve(path.dirname(CURRENT_SYM), runDir);
    
    // Support both index and timestamp modes
    const hasIndexMode = flags.from !== undefined && flags.to !== undefined;
    const hasTimestampMode = flags.fromTs !== undefined && flags.toTs !== undefined;
    
    if (!hasIndexMode && !hasTimestampMode) {
      console.error('[rce] Usage: rce diff (--from N --to M) OR (--from-ts TS --to-ts TS) [--tab N] [--format html|json]');
      process.exit(1);
    }
    
    let fromIndex: number;
    let toIndex: number;
    const format = flags.format ?? "html";
    const tabId = flags.tab !== undefined ? Number(flags.tab) : undefined;
    
    if (hasTimestampMode) {
      // Timestamp mode: use binary search
      const fromTs = Number(flags.fromTs);
      const toTs = Number(flags.toTs);
      
      const framesPath = path.join(resolvedRunDir, "rrweb/frames.jsonl");
      const frames = await readJsonLines<FrameEntry>(framesPath);
      const filteredFrames = tabId !== undefined 
        ? frames.filter(f => f.tabId === tabId)
        : frames;
      
      const fromFrame = binarySearchFrameByTimestamp(filteredFrames, fromTs);
      const toFrame = binarySearchFrameByTimestamp(filteredFrames, toTs);
      
      if (!fromFrame || !toFrame) {
        console.error(`[rce] Could not find frames for timestamps ${fromTs} to ${toTs}`);
        process.exit(1);
      }
      
      fromIndex = fromFrame.i;
      toIndex = toFrame.i;
      console.error(`[rce] From: frame ${fromIndex} at ${fromFrame.ts}, To: frame ${toIndex} at ${toFrame.ts}`);
    } else {
      // Index mode
      fromIndex = Number(flags.from);
      toIndex = Number(flags.to);
    }
    
    // Load events
    const eventsPath = path.join(resolvedRunDir, "rrweb/events.rrweb.jsonl");
    const eventsLines = await readJsonLines<any>(eventsPath);
    
    const events = tabId !== undefined 
      ? eventsLines.filter(e => e.tabId === tabId).map(e => e.event)
      : eventsLines.map(e => e.event);
    
    // Load config for viewport
    const config = await loadConfig();
    
    const outPath = flags.out ?? path.join(
      resolvedRunDir, 
      "diffs", 
      `diff_${fromIndex}_${toIndex}.${format}`
    );
    
    const resultPath = await generateDiff(
      events, 
      fromIndex, 
      toIndex, 
      outPath, 
      format as "html" | "json",
      config.viewport
    );
    
    if (flags.json) {
      console.log(JSON.stringify({ ok: true, path: resultPath }, null, 2));
    } else {
      console.log(resultPath);
    }
  } catch (error: any) {
    console.error("[rce] Error generating diff:", error.message);
    process.exit(1);
  }
}

async function cmdAction(flags: any, positionals: string[]): Promise<void> {
  const t0 = Date.now();
  try {
    const runDir = await fs.readlink(CURRENT_SYM);
    const resolvedRunDir = path.resolve(path.dirname(CURRENT_SYM), runDir);
    console.error(`[timing] Symlink resolved: ${Date.now() - t0}ms`);
    
    const tool = positionals[0];
    if (!tool) {
      console.error('[rce] Usage: rce action <tool> --json \'{"arg":"value"}\'');
      process.exit(1);
    }
    
    // Parse args from --json flag or stdin
    const t1 = Date.now();
    let args: any = {};
    if (flags.json && typeof flags.json === "string") {
      args = JSON.parse(flags.json);
    } else if (flags.json === true && !process.stdin.isTTY) {
      // Only read from stdin if it's being piped (not a TTY)
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      const input = Buffer.concat(chunks).toString();
      if (input.trim()) {
        args = JSON.parse(input);
      }
    }
    console.error(`[timing] Args parsed: ${Date.now() - t1}ms`);
    
    // Socket is at fixed location: .rce/control.sock (not session-specific)
    const socketPath = path.join(RCE_DIR, "control.sock");
    
    // Connect to IPC server
    const t2 = Date.now();
    const { IPCClient } = await import("./ipc.js");
    const client = new IPCClient(socketPath);
    
    try {
      await client.connect();
      console.error(`[timing] Connected: ${Date.now() - t2}ms`);
      
      const t3 = Date.now();
      const response = await client.sendAction(tool, args);
      console.error(`[timing] Action completed: ${Date.now() - t3}ms`);
      
      if (flags.json) {
        console.log(JSON.stringify(response, null, 2));
      } else {
        if (response.ok) {
          console.log("[rce] Action executed successfully");
          if (response.result) {
            console.log(JSON.stringify(response.result, null, 2));
          }
        } else {
          console.error("[rce] Action failed:", response.error);
          process.exit(1);
        }
      }
      
      const t4 = Date.now();
      await client.disconnect();
      console.error(`[timing] Disconnected: ${Date.now() - t4}ms`);
      const t5 = Date.now();
      console.error(`[timing] TOTAL: ${Date.now() - t0}ms`);
      console.error(`[timing] About to exit...`);
      process.exit(0); // Force immediate exit
    } catch (error: any) {
      if (error.code === "ENOENT" || error.code === "ECONNREFUSED") {
        console.error("[rce] Error: Recorder not running. Start a recording session with 'rce dev' first.");
      } else {
        console.error("[rce] Error connecting to recorder:", error.message);
      }
      process.exit(1);
    }
  } catch (error: any) {
    console.error("[rce] Error executing action:", error.message);
    process.exit(1);
  }
}

async function cmdTabs(flags: any, positionals: string[]): Promise<void> {
  try {
    const runDir = await fs.readlink(CURRENT_SYM);
    const resolvedRunDir = path.resolve(path.dirname(CURRENT_SYM), runDir);
    const action = positionals[0] || "list";
    
    // Read tab metadata
    const tabMetaPath = path.join(resolvedRunDir, "meta/tabs.jsonl");
    const tabs = await readJsonLines<TabMeta>(tabMetaPath).catch(() => []);
    
    if (action === "list") {
      const result = tabs.map(t => ({
        tabId: t.tabId,
        url: t.url,
        timestamp: t.t
      }));
      
      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log("[rce] Active tabs:");
        result.forEach(t => console.log(`  Tab ${t.tabId}: ${t.url}`));
      }
    } else if (action === "new") {
      // Note: Can't create tabs remotely yet, need action system
      console.error("[rce] Tab creation requires action system (not yet implemented)");
      process.exit(1);
    } else if (action === "close") {
      console.error("[rce] Tab closing requires action system (not yet implemented)");
      process.exit(1);
    } else {
      console.error(`[rce] Unknown tabs action: ${action}`);
      process.exit(1);
    }
  } catch (error: any) {
    console.error("[rce] Error:", error.message);
    process.exit(1);
  }
}

async function cmdServe(flags: any): Promise<void> {
  try {
    const runDir = await fs.readlink(CURRENT_SYM);
    const resolvedRunDir = path.resolve(path.dirname(CURRENT_SYM), runDir);
    
    const metaPath = path.join(resolvedRunDir, "meta/recorder.meta.json");
    const meta: RunMeta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    
    const config = await loadConfig();
    const port = flags.port ? Number(flags.port) : config.ui.port;
    
    // Start UI server without screencast (for replay mode)
    const { EventEmitter } = await import("node:events");
    const emitter = new EventEmitter();
    
    await startUIServer(resolvedRunDir, meta, emitter, port);
    
    console.error(`[rce] UI server started on http://localhost:${port}`);
    console.error(`[rce] Press Ctrl+C to stop`);
    
    // Keep alive
    await new Promise(() => {});
  } catch (error: any) {
    console.error("[rce] Error starting UI server:", error.message);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  await ensureDirs(DATA_DIR);
  
  const { cmd, flags, positionals } = parseArgs(process.argv);
  
  if (!cmd || ["help", "-h", "--help"].includes(cmd)) {
    console.log(`
RCE (Refresh Context Engine) - Web app recording and time-travel debugging

Usage:
  rce dev [--url URL] [--serverCmd "cmd"] [--bootWait ms] [--port N] [--headless] [--clear-state]
  rce stop
  rce restart [same flags as dev]
  rce frames [--json] [--tab N]
  rce shot (--index N | --at "<ISO|+ms|ts#k>") [--out path] [--tab N] [--json]
  rce screenshot [--json] [--tab N]
  rce diff --from N --to M [--tab N] [--format html|json] [--out path] [--json]
  rce action <tool> --json '{"arg":"value"}'
  rce serve [--port N]
  rce tabs (list|new|close) [--json]

Files live in .rce/data/<run-id>/:
  - rrweb/events.rrweb.jsonl
  - rrweb/frames.jsonl (ts, k, i, tabId)
  - logs/{console,network,js_errors}.jsonl
  - screenshots/latest.png
  - meta/recorder.meta.json
`);
    process.exit(0);
  }
  
  try {
    switch (cmd) {
      case "dev": await cmdDev(flags); break;
      case "stop": await cmdStop(); break;
      case "restart": await cmdRestart(flags); break;
      case "frames": await cmdFrames(flags); break;
      case "shot": await cmdShot(flags); break;
      case "screenshot": await cmdScreenshot(flags); break;
      case "diff": await cmdDiff(flags); break;
      case "action": await cmdAction(flags, positionals); break;
      case "tabs": await cmdTabs(flags, positionals); break;
      case "serve": await cmdServe(flags); break;
      default:
        console.error(`[rce] Unknown command: ${cmd}`);
        console.error('[rce] Run "rce help" for usage');
        process.exit(1);
    }
  } catch (error: any) {
    console.error("[rce] Error:", error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main().catch(error => {
  console.error("[rce] Fatal error:", error);
  process.exit(1);
});


