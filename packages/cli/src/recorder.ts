import { chromium, type Browser, type BrowserContext, type Page, type CDPSession } from "playwright";
import { promises as fs, unlinkSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { writeJsonLines } from "./fs-utils.js";
import { executeAction } from "./actions.js";
import { IPCServer } from "./ipc.js";
import { log, logError } from "./logger.js";
import type { Config, RecorderHandle, FrameEntry, TabMeta } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RRWEB_PATH = path.join(__dirname, "../vendor/rrweb-browser.js");

// Helper function to start rrweb recording on a page
async function startRRWebRecording(page: Page, config: Config): Promise<void> {
  try {
    // Skip rrweb on about:blank (no real content)
    const url = page.url();
    log(`[rrweb-debug] startRRWebRecording called for: ${url}`);
    if (url === 'about:blank') {
      log(`[rrweb-debug] Skipping about:blank`);
      return;
    }
    
    // Wait for page to be ready
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    log(`[rrweb-debug] Page ready, injecting rrweb...`);
    
    // Inject rrweb from local bundle (not CDN - avoids network/CSP issues)
    const rrwebScript = readFileSync(RRWEB_PATH, 'utf8');
    await page.addScriptTag({ content: rrwebScript }).catch((err) => {
      log(`[rrweb-debug] Failed to inject script: ${err.message}`);
      return;
    });
    
    log(`[rrweb-debug] Local rrweb bundle injected, waiting for initialization...`);
    
    // Wait a bit for script to fully execute
    await new Promise(r => setTimeout(r, 200));
    
    // Check if rrweb is available in a SINGLE evaluate to avoid context switching
    const rrwebInfo = await page.evaluate(() => {
      const rrweb = (window as any).rrweb;
      return {
        exists: typeof rrweb !== 'undefined',
        hasRecord: typeof rrweb?.record === 'function',
        keys: rrweb ? Object.keys(rrweb).slice(0, 10) : []
      };
    });
    
    log(`[rrweb-debug] rrweb status: ${JSON.stringify(rrwebInfo)}`);
    
    if (!rrwebInfo.hasRecord) {
      log(`[rrweb-debug] rrweb.record not available - skipping`);
      return;
    }
    
    // Start rrweb recording - use __rrwebEmit directly
    const started = await page.evaluate((samplingConfig) => {
      // Stop any existing recording first
      if ((window as any).__rrwebStop) {
        (window as any).__rrwebStop();
      }
      
      // Start new recording
      const stopFn = (window as any).rrweb.record({
        emit: (e: any) => {
          (window as any).__rrwebEmit(e);
        },
        recordCanvas: true,
        collectFonts: true,
        recordCrossOriginIframes: true, // Record iframe content
        inlineStylesheet: true, // Capture inline styles from iframes
        sampling: samplingConfig,
        checkoutEveryNms: 10 * 1000 // Take full snapshot every 10 seconds as backup
      });
      
      (window as any).__rrwebStop = stopFn;
      
      // Force a full snapshot immediately after starting recording
      // This ensures we have a complete snapshot of the current page state
      if ((window as any).rrweb && (window as any).rrweb.takeFullSnapshot) {
        setTimeout(() => {
          try {
            (window as any).rrweb.takeFullSnapshot();
          } catch (e) {
            console.error('Failed to take full snapshot:', e);
          }
        }, 50);
      }
      
      // Return info about the page
      return {
        url: window.location.href,
        hasContent: document.body?.children.length > 0
      };
    }, config.rrweb.sampling);
    
    log(`[rrweb] Recording started on ${started.url} (hasContent: ${started.hasContent})`);
  } catch (error: any) {
    // Ignore "Execution context was destroyed" errors during navigation
    if (!error.message?.includes("Execution context was destroyed")) {
      console.error("Failed to inject rrweb:", error.message);
    }
  }
}

export async function startRecorder(
  runDir: string,
  runId: string,
  config: Config,
  startedAt: number
): Promise<RecorderHandle> {
  // Setup paths
  const WORK_DIR = process.env.RCE_WORK_DIR || process.cwd();
  const RCE_DIR = path.join(WORK_DIR, ".rce");
  const storageStatePath = path.join(RCE_DIR, "storage-state.json");
  
  // Launch browser (headless or headful based on config)
  const browser = await chromium.launch({ 
    headless: !config.headful,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--disable-restore-session-state',
      '--disable-session-crashed-bubble',
      '--hide-crash-restore-bubble',
      '--test-type',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-backgrounding-occluded-windows'
    ]
  });
  
  // Load storage state if it exists (for auth persistence)
  let storageState = undefined;
  try {
    const stateData = await fs.readFile(storageStatePath, "utf8");
    storageState = JSON.parse(stateData);
    log("[rce] Loaded storage state (cookies, localStorage preserved)");
  } catch {
    log("[rce] No storage state found, starting with clean session");
  }
  
  // Create context with storage state
  const context = await browser.newContext({ 
    viewport: config.viewport,
    storageState
  });
  
  // Add stealth init script to help bypass bot detection (for Google OAuth)
  await context.addInitScript(() => {
    // Override navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false
    });
    
    // Add chrome object (makes it look more like real Chrome)
    (window as any).chrome = {
      runtime: {}
    };
  });
  
  log("[rce] Browser started (login will persist via storage state)");
  
  const pages = new Map<number, Page>();
  let nextTabId = 0;
  const screencastEmitter = new EventEmitter();
  
  // Start IPC server for action commands
  // Use FIXED socket path (not session-specific) for easier cleanup and faster restarts
  const socketPath = path.join(RCE_DIR, "control.sock");
  const ipcServer = new IPCServer(socketPath);
  
  // Register emergency cleanup for socket on process exit
  process.on("exit", () => {
    try {
      unlinkSync(socketPath);
      console.error("[exit-handler] Socket cleaned up");
    } catch (err: any) {
      console.error("[exit-handler] Failed to clean socket:", err.message);
    }
  });
  
  await ipcServer.start();
  log(`[rce] IPC server started at ${ipcServer.getSocketPath()}`);
  
  // Frame tracking state
  const tsCounts = new Map<number, number>();
  let absIndex = -1;
  
  // Helper to write timestamped entry
  const writeTimestamped = async (file: string, data: any, tabId?: number) => {
    const t = Date.now();
    const dt = t - startedAt;
    const entry = { t, dt, ...data };
    if (tabId !== undefined) {
      (entry as any).tabId = tabId;
    }
    await writeJsonLines(file, entry);
  };
  
  // Helper to setup page recording
  const setupPageRecording = async (page: Page, tabId: number) => {
    pages.set(tabId, page);
    
    // Write tab metadata
    const tabMetaPath = path.join(runDir, "meta", "tabs.jsonl");
    await writeTimestamped(tabMetaPath, { tabId, url: page.url() }, tabId);
    
    // Console logging
    page.on("console", async (msg) => {
      const consolePath = path.join(runDir, "logs", "console.jsonl");
      const consoleErrPath = path.join(runDir, "logs", "console_errors.jsonl");
      await writeTimestamped(consolePath, {
        level: msg.type(),
        text: msg.text(),
        location: msg.location()
      }, tabId);
      if (["error", "warning"].includes(msg.type())) {
        await writeTimestamped(consoleErrPath, {
          level: msg.type(),
          text: msg.text(),
          location: msg.location()
        }, tabId);
      }
    });
    
    // Network logging
    page.on("request", async (req) => {
      const networkPath = path.join(runDir, "logs", "network.jsonl");
      await writeTimestamped(networkPath, {
        phase: "request",
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType()
      }, tabId);
    });
    
    page.on("response", async (res) => {
      const networkPath = path.join(runDir, "logs", "network.jsonl");
      const networkErrPath = path.join(runDir, "logs", "network_errors.jsonl");
      const status = res.status();
      const entry = {
        phase: "response",
        status,
        url: res.url(),
        statusText: res.statusText()
      };
      await writeTimestamped(networkPath, entry, tabId);
      if (status >= 400) {
        await writeTimestamped(networkErrPath, entry, tabId);
      }
    });
    
    // JS runtime errors
    page.on("pageerror", async (error) => {
      const jsErrorPath = path.join(runDir, "logs", "js_errors.jsonl");
      await writeTimestamped(jsErrorPath, {
        message: error.message,
        stack: error.stack
      }, tabId);
    });
    
    // Expose rrweb emit binding
    await page.exposeFunction("__rrwebEmit", async (evt: any) => {
      absIndex += 1;
      
      // Write raw rrweb event with tabId
      const eventsPath = path.join(runDir, "rrweb", "events.rrweb.jsonl");
      await writeJsonLines(eventsPath, { tabId, event: evt });
      
      // Track frames (exclude Custom events type 5)
      const isCustom = evt?.type === 5;
      if (!isCustom) {
        const ts = evt.timestamp;
        const count = tsCounts.get(ts) ?? 0;
        const key = `${ts}#${count}`;
        
        const frameEntry: FrameEntry = { ts, k: count, i: absIndex, tabId };
        
        // frames.txt (human-readable)
        const framesTxtPath = path.join(runDir, "rrweb", "frames.txt");
        await fs.appendFile(framesTxtPath, key + "\n");
        
        // frames.jsonl (structured)
        const framesJsonlPath = path.join(runDir, "rrweb", "frames.jsonl");
        await writeJsonLines(framesJsonlPath, frameEntry);
        
        // Per-tab frames
        const tabFramesPath = path.join(runDir, "rrweb", `frames.tab-${tabId}.jsonl`);
        await writeJsonLines(tabFramesPath, frameEntry);
        
        tsCounts.set(ts, count + 1);
      }
    });
    
    // Don't inject rrweb immediately on about:blank
    // Wait for actual navigation via load event
    page.on("load", async () => {
      log(`[rrweb] Load event fired for: ${page.url()}`);
      await startRRWebRecording(page, config);
    });
    
    // Debounced auto-save on auth navigations (prevents spam during OAuth redirects)
    // Save storage state on EVERY navigation (guarantees logout/login persistence)
    page.on("framenavigated", async (frame) => {
      if (frame === page.mainFrame()) {
        const url = frame.url();
        
        // Skip about:blank
        if (url === 'about:blank') {
          return;
        }
        
        // Save immediately after navigation
        const saved = await saveStorageState();
        if (saved) {
          log(`[storage] State saved after navigation`);
        }
      }
    });
    
    // Setup CDP screencast
    try {
      const cdpSession: CDPSession = await context.newCDPSession(page);
      await cdpSession.send("Page.startScreencast", {
        format: "jpeg",
        quality: config.ui.jpegQuality,
        maxWidth: config.viewport.width,
        maxHeight: config.viewport.height,
        everyNthFrame: Math.ceil(60 / config.ui.screencastFps)
      });
      
      cdpSession.on("Page.screencastFrame", async (payload: any) => {
        // Acknowledge frame
        await cdpSession.send("Page.screencastFrameAck", { sessionId: payload.sessionId });
        
        // Emit frame to UI server
        screencastEmitter.emit("frame", { tabId, data: payload.data });
        
        // Update latest.png for this tab
        const latestPath = path.join(runDir, "screenshots", `latest.tab-${tabId}.png`);
        const buffer = Buffer.from(payload.data, "base64");
        await fs.writeFile(latestPath, buffer);
        
        // If this is the primary tab (tabId 0), also update latest.png
        if (tabId === 0) {
          const primaryLatestPath = path.join(runDir, "screenshots", "latest.png");
          await fs.writeFile(primaryLatestPath, buffer);
        }
      });
    } catch (error) {
      console.error(`Failed to start screencast for tab ${tabId}:`, error);
    }
  };
  
  // Create initial page
  const primaryPage = await context.newPage();
  
  // Navigate IMMEDIATELY before setting up recording (reduces visual flash)
  if (config.url) {
    // Start navigation without waiting
    const navigationPromise = primaryPage.goto(config.url, { waitUntil: "domcontentloaded" });
    
    // Set up recording while navigation is in progress
    await setupPageRecording(primaryPage, 0);
    
    // Now wait for navigation to complete
    await navigationPromise;
  } else {
    // No URL provided, just setup recording
    await setupPageRecording(primaryPage, 0);
  }
  
  // Handle new pages (tabs) created after primary
  context.on("page", async (page) => {
    if (page !== primaryPage) {
      const tabId = nextTabId++;
      await setupPageRecording(page, tabId);
    }
  });
  
  nextTabId = 1; // Reset after primary page
  
  // Write browser PID for cleanup
  const browserProcess = (browser as any).process?.();
  if (browserProcess?.pid) {
    const pidPath = path.join(runDir, "browser.pid");
    await fs.writeFile(pidPath, String(browserProcess.pid));
  }
  
  // Helper to save storage state
  const saveStorageState = async () => {
    try {
      if (browser.isConnected()) {
        await context.storageState({ path: storageStatePath });
        return true;
      }
    } catch (err: any) {
      console.error("[rce] Failed to save storage state:", err.message);
    }
    return false;
  };
  
  // Set up IPC message handler for actions
  ipcServer.onMessage(async (msg) => {
    if (msg.type === "action" && msg.tool && msg.args !== undefined) {
      try {
        // Execute action on primary page
        const actionResult = await executeAction(primaryPage, msg.tool, msg.args, startedAt);
        
        // Log action to file
        const actionsPath = path.join(runDir, "actions", "actions.jsonl");
        await writeJsonLines(actionsPath, actionResult);
        
        return {
          id: msg.id,
          ok: actionResult.ok,
          result: actionResult.ok ? actionResult.result : undefined,
          error: actionResult.ok ? undefined : (
            typeof actionResult.error === "string" 
              ? actionResult.error 
              : actionResult.error?.message || "Unknown error"
          )
        };
      } catch (error: any) {
        return {
          id: msg.id,
          ok: false,
          error: error.message
        };
      }
    }
    
    return {
      id: msg.id,
      ok: false,
      error: "Invalid message format"
    };
  });
  
  const stopFn = async () => {
    try {
      // Only close IPC server here
      // Browser close happens in cleanup handler AFTER storage state save
      await ipcServer.stop();
      log("[rce] IPC server closed");
    } catch (error) {
      logError("Error closing IPC", error);
    }
  };
  
  return {
    browser,
    context,
    primaryPage,
    pages,
    stopFn,
    screencastEmitter,
    ipcServer
  } as any;
}

