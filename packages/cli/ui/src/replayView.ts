import type { RRWebEvent } from "./types.js";

let rrwebPlayerInstance: any = null;
let currentReplayTab: number = 0;
let allEvents: any[] = [];

// ========== Replay View - rrweb Player ==========
export function initializeReplayView(): void {
  // Debug: Check what's available
  console.log("rrweb available:", typeof rrweb !== "undefined");
  console.log("rrwebPlayer available:", typeof rrwebPlayer !== "undefined");
  if (typeof rrweb !== "undefined") {
    console.log("rrweb.Replayer:", typeof rrweb.Replayer);
  }

  // Replay controls
  const refreshBtn = document.getElementById("replay-refresh");
  refreshBtn?.addEventListener("click", () => {
    loadReplayEvents();
  });
}

export function loadReplayEvents(): void {
  const statusEl = document.getElementById("replay-status") as HTMLElement;
  const containerEl = document.getElementById("replay-container") as HTMLElement;
  const infoEl = document.getElementById("replay-info") as HTMLElement;

  if (!statusEl || !containerEl || !infoEl) {
    console.error("Replay elements not found");
    return;
  }

  statusEl.textContent = "Loading events...";
  statusEl.style.display = "block";

  fetch("/api/events")
    .then((r) => r.json())
    .then((eventsData: any[]) => {
      if (!eventsData || eventsData.length === 0) {
        statusEl.textContent = "No events recorded yet. Start using the app to record interactions.";
        return;
      }

      // Store all events with their tabId wrapper
      allEvents = eventsData;
      
      // Extract unique tabIds
      const tabIds = [...new Set(eventsData.map((e: any) => e.tabId ?? 0))].sort();
      
      console.log(`Loaded ${eventsData.length} rrweb events across ${tabIds.length} tab(s)`);
      
      // Show tab selector if multiple tabs
      const replayTabSelector = document.getElementById("replay-tab-selector");
      if (replayTabSelector && tabIds.length > 1) {
        replayTabSelector.style.display = "flex";
        replayTabSelector.innerHTML = "";
        
        tabIds.forEach((tabId: number) => {
          const btn = document.createElement("button");
          btn.className = `replay-tab-btn${tabId === currentReplayTab ? " active" : ""}`;
          btn.textContent = `Tab ${tabId}`;
          const count = eventsData.filter((e: any) => (e.tabId ?? 0) === tabId).length;
          btn.title = `${count} events`;
          btn.onclick = () => {
            currentReplayTab = tabId;
            loadTabReplay(tabId);
          };
          replayTabSelector.appendChild(btn);
        });
      }
      
      // Load the current tab's replay
      loadTabReplay(currentReplayTab);
    })
    .catch((err: Error) => {
      statusEl.style.display = "block";
      statusEl.textContent = "Error loading events: " + err.message;
      console.error("Failed to load events:", err);
    });
}

function loadTabReplay(tabId: number): void {
  const statusEl = document.getElementById("replay-status") as HTMLElement;
  const containerEl = document.getElementById("replay-container") as HTMLElement;
  const infoEl = document.getElementById("replay-info") as HTMLElement;
  
  if (!containerEl || !infoEl) return;
  
  // Filter events for this tab
  const tabEvents = allEvents
    .filter((e: any) => (e.tabId ?? 0) === tabId)
    .map((e: any) => e.event || e);
  
  if (tabEvents.length === 0) {
    if (statusEl) {
      statusEl.style.display = "block";
      statusEl.textContent = `No events for Tab ${tabId}`;
    }
    return;
  }
  
  console.log(`Loading replay for Tab ${tabId}: ${tabEvents.length} events`);

  // Clear container and create wrapper
  containerEl.innerHTML = '<div id="replay-wrapper"></div>';
  const wrapperEl = document.getElementById("replay-wrapper");
  if (!wrapperEl) {
    console.error("Failed to create replay wrapper");
    return;
  }

  // Destroy existing replayer if any
  if (rrwebPlayerInstance && rrwebPlayerInstance.pause) {
    try {
      rrwebPlayerInstance.pause();
    } catch (e) {
      // Ignore errors on pause
    }
  }

  // Create rrweb Replayer
  try {
    // Check if rrwebPlayer (Svelte component) is available
    if (typeof rrwebPlayer !== "undefined") {
      // Get container dimensions
      const containerWidth = wrapperEl.clientWidth;
      const containerHeight = wrapperEl.clientHeight;
      
      // Use rrweb-player (Svelte component with built-in UI)
      rrwebPlayerInstance = new rrwebPlayer({
        target: wrapperEl,
        props: {
          events: tabEvents,
          autoPlay: false,
          showController: true,
          speedOption: [0.5, 1, 2, 4, 8],
          skipInactive: false,
          width: containerWidth || 1280,
          height: containerHeight || 800,
        },
      });
      
      console.log(`rrweb-player initialized with dimensions: ${containerWidth}x${containerHeight}`);
    } else {
      // Fallback: use basic rrweb.Replayer
      rrwebPlayerInstance = new rrweb.Replayer(tabEvents, {
        root: wrapperEl,
        speed: 1,
        showController: true,
        showWarning: false,
        UNSAFE_replayCanvas: true,
      });
      rrwebPlayerInstance.play();
    }

    // Hide status and update info
    if (statusEl) statusEl.style.display = "none";
    const duration =
      tabEvents.length > 0 ? (tabEvents[tabEvents.length - 1].timestamp - tabEvents[0].timestamp) / 1000 : 0;
    infoEl.textContent = `Tab ${tabId}: ${tabEvents.length} events • ${duration.toFixed(1)}s`;

    console.log("rrweb player initialized successfully");
    
    // Update tab selector active state
    const replayTabSelector = document.getElementById("replay-tab-selector");
    if (replayTabSelector) {
      replayTabSelector.querySelectorAll(".replay-tab-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.textContent === `Tab ${tabId}`);
      });
    }
  } catch (error: any) {
    console.error("Error creating rrweb player:", error);
    if (statusEl) {
      statusEl.style.display = "block";
      statusEl.textContent = `Error: ${error.message}`;
    }
  }
}

