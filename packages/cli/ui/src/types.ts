// UI Types for RCE Dashboard

export interface FrameEntry {
  ts: number;
  k: number;
  i: number;
  tabId?: number;
}

export interface LogEntry {
  t: number;
  source: "console" | "network" | "js";
  text?: string;
  message?: string;
  method?: string;
  url?: string;
  status?: number;
  level?: string;
}

export interface WebSocketMessage {
  type: "screencast";
  data: string; // Base64 encoded image
  tabId?: number; // Tab ID for multi-tab sessions
}

export interface RRWebEvent {
  type: number;
  data: any;
  timestamp: number;
  delay?: number;
}

// Global rrweb types (from CDN)
declare global {
  const rrweb: {
    Replayer: any;
  };
  const rrwebPlayer: any;
}

