export interface RunMeta {
  runId: string;
  runDir: string;
  startedAt: number;
  url: string;
  viewport: { width: number; height: number };
  headless: boolean;
}

export interface FrameEntry {
  ts: number;    // timestamp (epoch ms)
  k: number;     // ordinal within that timestamp
  i: number;     // absolute event index
  tabId?: number; // optional tab identifier
}

export interface TabMeta {
  tabId: number;
  url: string;
  t: number;
  dt: number;
}

export interface ActionResult {
  ok: boolean;
  t: number;
  dt: number;
  tool: string;
  args: any;
  result?: any;
  error?: { message: string; code?: string };
}

export interface Config {
  url: string;
  serverCmd: string;
  bootWaitMs: number;
  headful: boolean;
  viewport: { width: number; height: number };
  rrweb: {
    recordCanvas: boolean;
    collectFonts: boolean;
    sampling: { mousemove: number; input: string };
  };
  ui: {
    port: number;
    screencastFps: number;
    jpegQuality: number;
  };
}

export interface RecorderHandle {
  browser: any;
  primaryPage: any;
  pages: Map<number, any>;
  stopFn: () => Promise<void>;
  screencastEmitter: any;
}

