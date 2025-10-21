// RCE Live View Client
let currentView = "live";
let rrwebPlayerInstance = null;

// Debug: Check what's available
console.log("rrweb available:", typeof rrweb !== 'undefined');
console.log("rrwebPlayer available:", typeof rrwebPlayer !== 'undefined');
if (typeof rrweb !== 'undefined') {
  console.log("rrweb.Replayer:", typeof rrweb.Replayer);
}

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
    
    // Load replay if switching to it for the first time
    if (view === "replay" && !rrwebPlayerInstance) {
      loadReplayEvents();
    }
  });
});

// ========== Live View - WebSocket ==========
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

// Poll logs for live view
function updateLogs() {
  if (currentView !== "live") return; // Only update when on live view
  
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
    if (!container) return;
    
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

// ========== Replay View - rrweb Player ==========
function loadReplayEvents() {
  const statusEl = document.getElementById("replay-status");
  const containerEl = document.getElementById("replay-container");
  const infoEl = document.getElementById("replay-info");
  
  if (!statusEl || !containerEl || !infoEl) {
    console.error("Replay elements not found");
    return;
  }
  
  statusEl.textContent = "Loading events...";
  statusEl.style.display = "block";
  
  fetch("/api/events")
    .then(r => r.json())
    .then(events => {
      if (!events || events.length === 0) {
        statusEl.textContent = "No events recorded yet. Start using the app to record interactions.";
        return;
      }
      
      console.log(`Loaded ${events.length} rrweb events`);
      
      // Clear container and create wrapper
      containerEl.innerHTML = '<div id="replay-wrapper"></div>';
      const wrapperEl = document.getElementById("replay-wrapper");
      
      // Destroy existing replayer if any
      if (rrwebPlayerInstance && rrwebPlayerInstance.pause) {
        try {
          rrwebPlayerInstance.pause();
        } catch (e) {}
      }
      
      // Create rrweb Replayer (simple, built-in to rrweb library)
      try {
        // Check if rrwebPlayer (Svelte component) is available
        if (typeof rrwebPlayer !== 'undefined') {
          // Use rrweb-player (Svelte component with built-in UI)
          rrwebPlayerInstance = new rrwebPlayer({
            target: wrapperEl,
            props: {
              events: events,
              autoPlay: false,
              showController: true,
              speedOption: [0.5, 1, 2, 4, 8],
              skipInactive: false,
              width: 1280,
              height: 800
            }
          });
        } else {
          // Fallback: use basic rrweb.Replayer
          rrwebPlayerInstance = new rrweb.Replayer(events, {
            root: wrapperEl,
            speed: 1,
            showController: true,
            showWarning: false,
            UNSAFE_replayCanvas: true
          });
          rrwebPlayerInstance.play();
        }
        
        // Hide status and update info
        statusEl.style.display = "none";
        const duration = events.length > 0 ? (events[events.length - 1].timestamp - events[0].timestamp) / 1000 : 0;
        infoEl.textContent = `${events.length} events • ${duration.toFixed(1)}s duration`;
        
        console.log("rrweb player initialized successfully");
      } catch (error) {
        console.error("Error creating rrweb player:", error);
        statusEl.style.display = "block";
        statusEl.textContent = `Error: ${error.message}`;
      }
    })
    .catch(err => {
      statusEl.style.display = "block";
      statusEl.textContent = "Error loading events: " + err.message;
      console.error("Failed to load events:", err);
    });
}

// Replay controls
document.getElementById("replay-refresh")?.addEventListener("click", () => {
  loadReplayEvents();
});
