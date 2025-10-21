import type { RRWebEvent } from "./types.js";

let rrwebPlayerInstance: any = null;

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
    .then((events: RRWebEvent[]) => {
      if (!events || events.length === 0) {
        statusEl.textContent = "No events recorded yet. Start using the app to record interactions.";
        return;
      }

      console.log(`Loaded ${events.length} rrweb events`);

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
              height: 800,
            },
          });
        } else {
          // Fallback: use basic rrweb.Replayer
          rrwebPlayerInstance = new rrweb.Replayer(events, {
            root: wrapperEl,
            speed: 1,
            showController: true,
            showWarning: false,
            UNSAFE_replayCanvas: true,
          });
          rrwebPlayerInstance.play();
        }

        // Hide status and update info
        statusEl.style.display = "none";
        const duration =
          events.length > 0 ? (events[events.length - 1].timestamp - events[0].timestamp) / 1000 : 0;
        infoEl.textContent = `${events.length} events • ${duration.toFixed(1)}s duration`;

        console.log("rrweb player initialized successfully");
      } catch (error: any) {
        console.error("Error creating rrweb player:", error);
        statusEl.style.display = "block";
        statusEl.textContent = `Error: ${error.message}`;
      }
    })
    .catch((err: Error) => {
      statusEl.style.display = "block";
      statusEl.textContent = "Error loading events: " + err.message;
      console.error("Failed to load events:", err);
    });
}

