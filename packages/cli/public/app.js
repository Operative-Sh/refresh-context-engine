// RCE Live View Client
const ws = new WebSocket(`ws://${location.host}/api/live`);
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
    img.src = `data:image/jpeg;base64,${msg.data}`;
  }
};

// Fetch and display frames
fetch("/api/frames")
  .then(r => r.json())
  .then(frames => {
    const list = document.getElementById("frames-list");
    list.innerHTML = "";
    frames.forEach(f => {
      const div = document.createElement("div");
      div.className = "frame-item";
      div.textContent = `${f.ts}#${f.k} (i=${f.i})${f.tabId !== undefined ? ` tab=${f.tabId}` : ""}`;
      list.appendChild(div);
    });
  })
  .catch(err => {
    document.getElementById("frames-list").textContent = "Error loading frames: " + err.message;
  });

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
      div.className = `log-entry log-${log.source}${isError ? " log-error" : ""}`;
      
      const time = new Date(log.t).toLocaleTimeString();
      const content = log.text || log.message || `${log.method || ""} ${log.url || ""} ${log.status || ""}`;
      
      div.innerHTML = `<span class="log-time">${time}</span> [${log.source}] ${content}`;
      container.appendChild(div);
    });
    
    container.scrollTop = container.scrollHeight;
  });
}

updateLogs();
setInterval(updateLogs, 2000);


