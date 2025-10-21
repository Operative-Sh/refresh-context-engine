import type { LogEntry, WebSocketMessage } from "./types.js";

let currentView = "live";

export function setCurrentView(view: string): void {
  currentView = view;
}

export function getCurrentView(): string {
  return currentView;
}

// ========== Live View - WebSocket ==========
export function initializeLiveView(): void {
  const ws = new WebSocket(`ws://${location.host}/api/live`);
  const canvas = document.getElementById("screencast") as HTMLCanvasElement;
  const ctx = canvas?.getContext("2d");
  const status = document.getElementById("status");

  if (!canvas || !ctx || !status) {
    console.error("Live view elements not found");
    return;
  }

  ws.onopen = () => {
    status.textContent = "Connected";
    status.style.color = "#4CAF50";
  };

  ws.onclose = () => {
    status.textContent = "Disconnected";
    status.style.color = "#f44336";
  };

  ws.onmessage = (e) => {
    const msg: WebSocketMessage = JSON.parse(e.data);
    if (msg.type === "screencast") {
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
      };
      img.src = `data:image/jpeg;base64,${msg.data}`;
    }
  };

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

