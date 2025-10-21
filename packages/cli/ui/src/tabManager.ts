// Tab Manager for Multi-Tab Screencast Display

export interface Tab {
  tabId: number;
  url: string;
  canvas: HTMLCanvasElement;
  lastUpdate: number;
}

export class TabManager {
  private tabs: Map<number, Tab> = new Map();
  private activeTabId: number = 0;
  private container: HTMLElement;
  private tabSelectorEl: HTMLElement;

  constructor(container: HTMLElement, tabSelectorEl: HTMLElement) {
    this.container = container;
    this.tabSelectorEl = tabSelectorEl;
  }

  getOrCreateTab(tabId: number, url?: string): Tab {
    const isNewTab = !this.tabs.has(tabId);
    
    if (isNewTab) {
      // Create new canvas for this tab
      const canvas = document.createElement("canvas");
      canvas.id = `screencast-tab-${tabId}`;
      canvas.className = "screencast-canvas";
      canvas.style.display = tabId === this.activeTabId ? "block" : "none";
      this.container.appendChild(canvas);

      const tab: Tab = {
        tabId,
        url: url || `Tab ${tabId}`,
        canvas,
        lastUpdate: Date.now(),
      };

      this.tabs.set(tabId, tab);
      this.updateTabSelector(); // Only update when new tab is created
    } else if (url && this.tabs.get(tabId)!.url !== url) {
      // Update URL if it changed
      this.tabs.get(tabId)!.url = url;
      this.updateTabSelector(); // Only update when URL changes
    }

    return this.tabs.get(tabId)!;
  }

  setActiveTab(tabId: number): void {
    this.activeTabId = tabId;

    // Update canvas visibility
    this.tabs.forEach((tab) => {
      tab.canvas.style.display = tab.tabId === tabId ? "block" : "none";
    });

    this.updateTabSelector();
  }

  getActiveTab(): Tab | undefined {
    return this.tabs.get(this.activeTabId);
  }

  getAllTabs(): Tab[] {
    return Array.from(this.tabs.values()).sort((a, b) => a.tabId - b.tabId);
  }

  private updateTabSelector(): void {
    const tabs = this.getAllTabs();

    if (tabs.length <= 1) {
      this.tabSelectorEl.style.display = "none";
      return;
    }

    this.tabSelectorEl.style.display = "flex";
    this.tabSelectorEl.innerHTML = "";

    tabs.forEach((tab) => {
      const btn = document.createElement("button");
      btn.className = `tab-btn${tab.tabId === this.activeTabId ? " active" : ""}`;
      
      // Show tab name from URL if available
      const tabName = this.getTabName(tab.url, tab.tabId);
      btn.textContent = tabName;
      btn.title = tab.url;
      btn.onclick = () => this.setActiveTab(tab.tabId);

      // Show last update time
      const age = Date.now() - tab.lastUpdate;
      if (age > 5000) {
        btn.classList.add("stale");
        btn.title += ` (inactive for ${Math.floor(age / 1000)}s)`;
      }

      this.tabSelectorEl.appendChild(btn);
    });
  }

  private getTabName(url: string, tabId: number): string {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      
      // Extract meaningful part of the path
      if (path === "/" || path === "") {
        return `${urlObj.hostname}`;
      }
      
      const parts = path.split("/").filter(Boolean);
      if (parts.length > 0) {
        return parts[parts.length - 1] || `Tab ${tabId}`;
      }
      
      return `Tab ${tabId}`;
    } catch {
      return `Tab ${tabId}`;
    }
  }

  updateTab(tabId: number): void {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.lastUpdate = Date.now();
      // Don't update selector on every frame - it's too expensive and makes buttons unclickable
      // The selector will be updated when tabs are created/changed or via periodic refresh
    }
  }
  
  // Periodically update tab selector to refresh stale indicators
  startPeriodicRefresh(): void {
    setInterval(() => {
      if (this.tabs.size > 1) {
        this.updateTabSelector();
      }
    }, 2000); // Update every 2 seconds instead of on every frame
  }
}

