import type { LogEntry, WebSocketMessage } from "./types.js";
import { TabManager } from "./tabManager.js";

let currentView = "live";
let tabManager: TabManager | null = null;

export function setCurrentView(view: string): void {
  currentView = view;
}

export function getCurrentView(): string {
  return currentView;
}

// ========== Live View - WebSocket ==========
let ws: WebSocket | null = null;
let reconnectTimeout: number | null = null;

export function initializeLiveView(): void {
  const container = document.getElementById("screencast-container");
  const tabSelector = document.getElementById("tab-selector");
  const status = document.getElementById("status");

  if (!container || !tabSelector || !status) {
    console.error("Live view elements not found");
    return;
  }

  // Initialize tab manager
  tabManager = new TabManager(container, tabSelector);
  tabManager.startPeriodicRefresh();

  function connect() {
    // Don't create multiple connections
    if (ws && ws.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      ws = new WebSocket(`ws://${location.host}/api/live`);

      ws.onopen = () => {
        status.textContent = "Connected";
        status.style.color = "#4CAF50";
        console.log("[WS] Connected to screencast");
        
        // Clear any pending reconnect
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }
      };

      ws.onclose = (event) => {
        status.textContent = "Disconnected";
        status.style.color = "#f44336";
        console.log("[WS] Disconnected from screencast");
        
        // Don't auto-reconnect if closed normally or during page unload
        if (!event.wasClean && document.visibilityState === "visible") {
          console.log("[WS] Attempting to reconnect in 2s...");
          reconnectTimeout = window.setTimeout(connect, 2000);
        }
      };

      ws.onerror = (error) => {
        console.error("[WS] WebSocket error:", error);
        status.textContent = "Connection Error";
        status.style.color = "#f44336";
      };

      ws.onmessage = (e) => {
        try {
          const msg: WebSocketMessage = JSON.parse(e.data);
          if (msg.type === "screencast" && tabManager) {
            const tabId = msg.tabId ?? 0;
            const tab = tabManager.getOrCreateTab(tabId);
            const ctx = tab.canvas.getContext("2d");
            
            if (ctx) {
              const img = new Image();
              img.onload = () => {
                tab.canvas.width = img.width;
                tab.canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                tabManager!.updateTab(tabId);
              };
              img.onerror = (err) => {
                console.error(`[Canvas] Image load error for tab ${tabId}:`, err);
              };
              img.src = `data:image/jpeg;base64,${msg.data}`;
            }
          }
        } catch (err) {
          console.error("[WS] Error parsing message:", err);
        }
      };
    } catch (err) {
      console.error("[WS] Error creating WebSocket:", err);
      status.textContent = "Connection Failed";
      status.style.color = "#f44336";
    }
  }

  // Initial connection
  connect();

  // Cleanup on page unload
  window.addEventListener("beforeunload", () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
    }
    if (ws) {
      ws.close();
    }
  });

  // Load tab metadata to show better tab names
  fetch("/api/tabs")
    .then(r => r.json())
    .then(tabs => {
      tabs.forEach((tab: any) => {
        if (tabManager && tab.tabId !== undefined && tab.url) {
          // Update tab with URL info
          const existingTab = tabManager.getOrCreateTab(tab.tabId, tab.url);
        }
      });
    })
    .catch(err => console.error("Failed to load tab metadata:", err));

  // Start polling logs
  startLogPolling();
}

// Poll logs for live view
function updateLogs(): void {
  if (currentView !== "live") return; // Only update when on live view

  Promise.all([
    fetch("/api/logs/console").then((r) => r.json()).catch(() => []),
    fetch("/api/logs/network").then((r) => r.json()).catch(() => []),
    fetch("/api/logs/errors").then((r) => r.json()).catch(() => []),
  ]).then(([consoleEntries, network, errors]) => {
    const allLogs: LogEntry[] = [
      ...consoleEntries.map((e: any) => ({ ...e, source: "console" as const })),
      ...network.map((e: any) => ({ ...e, source: "network" as const })),
      ...errors,
    ]
      .sort((a, b) => a.t - b.t)
      .slice(-50);

    const container = document.getElementById("log-entries");
    if (!container) return;

    container.innerHTML = "";
    allLogs.forEach((log) => {
      const div = document.createElement("div");
      const isError =
        log.source === "js" || log.level === "error" || (log.status && log.status >= 400);
      div.className = `log-entry log-${log.source}${isError ? " log-error" : ""}`;

      const time = new Date(log.t).toLocaleTimeString();
      const content =
        log.text || log.message || `${log.method || ""} ${log.url || ""} ${log.status || ""}`;

      div.innerHTML = `<span class="log-time">${time}</span> [${log.source}] ${content}`;
      container.appendChild(div);
    });

    container.scrollTop = container.scrollHeight;
  });
}

function startLogPolling(): void {
  updateLogs();
  setInterval(updateLogs, 2000);
}

