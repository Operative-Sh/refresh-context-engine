// RCE Dashboard - Main Entry Point
import { initializeLiveView, setCurrentView } from "./liveView.js";
import { initializeReplayView, loadReplayEvents } from "./replayView.js";

// Tab switching
function initializeTabs(): void {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const view = (tab as HTMLElement).dataset.view;
      if (!view) return;

      setCurrentView(view);

      // Update tabs
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      // Update views
      document.querySelectorAll(".view-panel").forEach((panel) => {
        panel.classList.toggle("hidden", !panel.id.startsWith(view));
      });

      // Load replay if switching to it for the first time
      if (view === "replay") {
        loadReplayEvents();
      }
    });
  });
}

// Initialize app
function init(): void {
  initializeTabs();
  initializeLiveView();
  initializeReplayView();
}

// Start when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

