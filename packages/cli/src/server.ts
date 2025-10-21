import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { RunMeta } from "./types.js";
import { readJsonLines } from "./fs-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function startUIServer(
  runDir: string,
  meta: RunMeta,
  screencastEmitter: any,
  port: number
): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, `http://localhost:${port}`);
      
      // Serve static UI
      if (url.pathname === "/" || url.pathname === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        const htmlPath = path.join(__dirname, "../public/index.html");
        const html = await fs.readFile(htmlPath, "utf8").catch(() => 
          generateDefaultHTML()
        );
        res.end(html);
        return;
      }
      
      if (url.pathname === "/app.js") {
        res.writeHead(200, { "Content-Type": "application/javascript" });
        const jsPath = path.join(__dirname, "../public/app.js");
        const js = await fs.readFile(jsPath, "utf8").catch(() => 
          generateDefaultJS()
        );
        res.end(js);
        return;
      }
      
      if (url.pathname === "/app.js.map") {
        res.writeHead(200, { "Content-Type": "application/json" });
        const mapPath = path.join(__dirname, "../public/app.js.map");
        try {
          const sourceMap = await fs.readFile(mapPath, "utf8");
          res.end(sourceMap);
        } catch {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Source map not available");
        }
        return;
      }
      
      // API endpoints
      if (url.pathname === "/api/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, runDir, meta }));
        return;
      }
      
      if (url.pathname === "/api/frames") {
        const framesPath = path.join(runDir, "rrweb/frames.jsonl");
        const frames = await readJsonLines(framesPath).catch(() => []);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(frames));
        return;
      }
      
      if (url.pathname === "/api/screenshot/latest") {
        const imgPath = path.join(runDir, "screenshots/latest.png");
        try {
          const img = await fs.readFile(imgPath);
          res.writeHead(200, { "Content-Type": "image/png" });
          res.end(img);
        } catch {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("No screenshot available yet");
        }
        return;
      }
      
      if (url.pathname === "/api/logs/console") {
        const consolePath = path.join(runDir, "logs/console.jsonl");
        const logs = await readJsonLines(consolePath).catch(() => []);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(logs.slice(-100))); // Last 100 entries
        return;
      }
      
      if (url.pathname === "/api/logs/network") {
        const networkPath = path.join(runDir, "logs/network.jsonl");
        const logs = await readJsonLines(networkPath).catch(() => []);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(logs.slice(-100))); // Last 100 entries
        return;
      }
      
      if (url.pathname === "/api/logs/errors") {
        const consolePath = path.join(runDir, "logs/console_errors.jsonl");
        const networkPath = path.join(runDir, "logs/network_errors.jsonl");
        const jsPath = path.join(runDir, "logs/js_errors.jsonl");
        
        const [consoleErrors, networkErrors, jsErrors] = await Promise.all([
          readJsonLines(consolePath).catch(() => []),
          readJsonLines(networkPath).catch(() => []),
          readJsonLines(jsPath).catch(() => [])
        ]);
        
        const allErrors = [
          ...consoleErrors.map((e: any) => ({ ...e, source: "console" })),
          ...networkErrors.map((e: any) => ({ ...e, source: "network" })),
          ...jsErrors.map((e: any) => ({ ...e, source: "js" }))
        ].sort((a, b) => a.t - b.t);
        
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(allErrors.slice(-100))); // Last 100 entries
        return;
      }
      
      if (url.pathname === "/api/events") {
        const eventsPath = path.join(runDir, "rrweb/events.rrweb.jsonl");
        const eventsLines = await readJsonLines(eventsPath).catch(() => []);
        // Extract just the event data
        const events = eventsLines.map((line: any) => line.event || line);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(events));
        return;
      }
      
      // 404
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } catch (error) {
      console.error("Server error:", error);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal server error");
    }
  });
  
  // WebSocket for live screencast frames
  const wss = new WebSocketServer({ server, path: "/api/live" });
  wss.on("connection", (ws) => {
    console.error(`WebSocket client connected`);
    
    const frameHandler = (payload: { tabId: number; data: string }) => {
      ws.send(JSON.stringify({ 
        type: "screencast", 
        tabId: payload.tabId,
        data: payload.data 
      }));
    };
    
    screencastEmitter.on("frame", frameHandler);
    
    ws.on("close", () => {
      screencastEmitter.off("frame", frameHandler);
      console.error("WebSocket client disconnected");
    });
    
    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
    });
  });
  
  server.listen(port, () => {
    console.error(`RCE UI server listening on http://localhost:${port}`);
  });
  
  return server;
}

function generateDefaultHTML(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>RCE Live View</title>
  <link rel="stylesheet" href="https://unpkg.com/rrweb-player@latest/dist/style.css"/>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui; display: flex; flex-direction: column; height: 100vh; background: #1a1a1a; color: #e0e0e0; }
    #toolbar { padding: 1rem; border-bottom: 1px solid #333; background: #2a2a2a; display: flex; align-items: center; justify-content: space-between; }
    #toolbar h2 { margin: 0; color: #fff; font-size: 20px; }
    #status { color: #4CAF50; font-size: 14px; }
    .tabs { display: flex; gap: 0.5rem; }
    .tab { padding: 0.5rem 1rem; background: #1a1a1a; border: 1px solid #333; border-radius: 4px; cursor: pointer; color: #aaa; transition: all 0.2s; }
    .tab:hover { background: #333; color: #fff; }
    .tab.active { background: #4CAF50; color: #fff; border-color: #4CAF50; }
    #main { display: flex; flex: 1; overflow: hidden; }
    .view-panel { flex: 1; display: flex; flex-direction: column; }
    .view-panel.hidden { display: none; }
    
    /* Live View */
    #live-view { display: flex; }
    #live-left { flex: 2; display: flex; flex-direction: column; border-right: 1px solid #333; }
    #screencast-container { flex: 1; background: #000; position: relative; overflow: auto; display: flex; align-items: center; justify-content: center; }
    #screencast { max-width: 100%; max-height: 100%; border: 1px solid #333; }
    #live-right { flex: 1; display: flex; flex-direction: column; background: #1a1a1a; }
    #logs { flex: 1; overflow: auto; padding: 1rem; font-family: monospace; font-size: 12px; }
    #logs h3 { margin: 0 0 1rem 0; color: #fff; font-size: 16px; }
    .log-entry { padding: 4px 8px; margin: 2px 0; border-left: 3px solid #666; background: #222; border-radius: 2px; }
    .log-console { border-left-color: #2196F3; }
    .log-network { border-left-color: #4CAF50; }
    .log-error { border-left-color: #f44336; background: #2a1a1a; }
    .log-time { color: #888; font-size: 10px; }
    
    /* Replay View */
    #replay-view { display: flex; flex-direction: column; padding: 1rem; }
    #replay-header { margin-bottom: 1rem; }
    #replay-header h3 { margin: 0 0 0.5rem 0; color: #fff; }
    #replay-controls { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
    #replay-controls button { padding: 0.5rem 1rem; background: #333; border: 1px solid #555; color: #fff; border-radius: 4px; cursor: pointer; }
    #replay-controls button:hover { background: #444; }
    #replay-controls button:disabled { opacity: 0.5; cursor: not-allowed; }
    #replay-container { flex: 1; background: #000; border: 1px solid #333; border-radius: 4px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
    #replay-status { padding: 1rem; color: #888; text-align: center; }
    
    /* rrweb-player styling overrides */
    .rr-player { width: 100% !important; height: 100% !important; }
    .rr-player__frame { background: #fff !important; }
  </style>
</head>
<body>
  <div id="toolbar">
    <h2>RCE Recorder</h2>
    <div class="tabs">
      <div class="tab active" data-view="live">Live View</div>
      <div class="tab" data-view="replay">Replay Recording</div>
    </div>
    <span id="status">Connecting...</span>
  </div>
  <div id="main">
    <div id="live-view" class="view-panel">
      <div id="live-left">
        <div id="screencast-container">
          <canvas id="screencast"></canvas>
        </div>
      </div>
      <div id="live-right">
        <div id="logs">
          <h3>Console & Network Events</h3>
          <div id="log-entries">Loading logs...</div>
        </div>
      </div>
    </div>
    <div id="replay-view" class="view-panel hidden">
      <div id="replay-header">
        <h3>Session Replay</h3>
        <div id="replay-controls">
          <button id="replay-refresh">Refresh Events</button>
          <button id="replay-play" disabled>Play</button>
          <button id="replay-pause" disabled>Pause</button>
          <button id="replay-restart" disabled>Restart</button>
          <span id="replay-info" style="color: #888; margin-left: 1rem;"></span>
        </div>
      </div>
      <div id="replay-container">
        <div id="replay-status">Loading events...</div>
      </div>
    </div>
  </div>
  <script src="https://unpkg.com/rrweb@latest/dist/rrweb.min.js"></script>
  <script src="https://unpkg.com/rrweb-player@latest/dist/index.js"></script>
  <script src="/app.js"></script>
</body>
</html>`;
}

function generateDefaultJS(): string {
  return `// RCE Live View Client
let currentView = "live";
let rrwebPlayer = null;

// Tab switching
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    const view = tab.dataset.view;
    currentView = view;
    
    // Update tabs
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    
    // Update views
    document.querySelectorAll(".view-panel").forEach(panel => {
      panel.classList.toggle("hidden", !panel.id.startsWith(view));
    });
    
    // Load replay if switching to it
    if (view === "replay" && !rrwebPlayer) {
      loadReplayEvents();
    }
  });
});

// Live View - WebSocket
const ws = new WebSocket(\`ws://\${location.host}/api/live\`);
const canvas = document.getElementById("screencast");
const ctx = canvas.getContext("2d");
const status = document.getElementById("status");

ws.onopen = () => {
  status.textContent = "Connected";
  status.style.color = "#4CAF50";
};

ws.onclose = () => {
  status.textContent = "Disconnected";
  status.style.color = "#f44336";
};

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "screencast") {
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
    };
    img.src = \`data:image/jpeg;base64,\${msg.data}\`;
  }
};

// Poll logs
function updateLogs() {
  Promise.all([
    fetch("/api/logs/console").then(r => r.json()).catch(() => []),
    fetch("/api/logs/network").then(r => r.json()).catch(() => []),
    fetch("/api/logs/errors").then(r => r.json()).catch(() => [])
  ]).then(([console, network, errors]) => {
    const allLogs = [
      ...console.map(e => ({ ...e, source: "console" })),
      ...network.map(e => ({ ...e, source: "network" })),
      ...errors
    ].sort((a, b) => a.t - b.t).slice(-50);
    
    const container = document.getElementById("log-entries");
    container.innerHTML = "";
    allLogs.forEach(log => {
      const div = document.createElement("div");
      const isError = log.source === "js" || log.level === "error" || log.status >= 400;
      div.className = \`log-entry log-\${log.source}\${isError ? " log-error" : ""}\`;
      
      const time = new Date(log.t).toLocaleTimeString();
      const content = log.text || log.message || \`\${log.method || ""} \${log.url || ""} \${log.status || ""}\`;
      
      div.innerHTML = \`<span class="log-time">\${time}</span> [\${log.source}] \${content}\`;
      container.appendChild(div);
    });
    
    container.scrollTop = container.scrollHeight;
  });
}

updateLogs();
setInterval(updateLogs, 2000);

// Replay View - rrweb Player
function loadReplayEvents() {
  const statusEl = document.getElementById("replay-status");
  const containerEl = document.getElementById("replay-container");
  const infoEl = document.getElementById("replay-info");
  
  statusEl.textContent = "Loading events...";
  
  fetch("/api/events")
    .then(r => r.json())
    .then(events => {
      if (!events || events.length === 0) {
        statusEl.textContent = "No events recorded yet. Start using the app to record interactions.";
        return;
      }
      
      // Clear status message
      containerEl.innerHTML = "";
      
      // Create rrweb player
      try {
        rrwebPlayer = new rrwebPlayer({
          target: containerEl,
          props: {
            events,
            width: 1280,
            height: 800,
            autoPlay: false,
            showController: true,
            speedOption: [1, 2, 4, 8],
            UNSAFE_replayCanvas: true
          }
        });
        
        // Enable controls
        document.getElementById("replay-play").disabled = false;
        document.getElementById("replay-pause").disabled = false;
        document.getElementById("replay-restart").disabled = false;
        
        // Update info
        infoEl.textContent = \`\${events.length} events loaded\`;
        
        console.log("rrweb player initialized with", events.length, "events");
      } catch (error) {
        console.error("Error creating rrweb player:", error);
        containerEl.innerHTML = \`<div id="replay-status">Error: \${error.message}</div>\`;
      }
    })
    .catch(err => {
      statusEl.textContent = "Error loading events: " + err.message;
      console.error("Failed to load events:", err);
    });
}

// Replay controls
document.getElementById("replay-refresh")?.addEventListener("click", () => {
  if (rrwebPlayer) {
    rrwebPlayer.$destroy();
    rrwebPlayer = null;
  }
  loadReplayEvents();
});

document.getElementById("replay-play")?.addEventListener("click", () => {
  if (rrwebPlayer) {
    rrwebPlayer.play();
  }
});

document.getElementById("replay-pause")?.addEventListener("click", () => {
  if (rrwebPlayer) {
    rrwebPlayer.pause();
  }
});

document.getElementById("replay-restart")?.addEventListener("click", () => {
  if (rrwebPlayer) {
    rrwebPlayer.goto(0);
  }
});
`;
}


