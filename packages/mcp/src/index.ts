#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { execJson } from "./exec.js";
import { readFile } from "node:fs/promises";

const server = new Server(
  {
    name: "rce",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

// Helper to format content
function text(t: string) {
  return { type: "text" as const, text: t };
}

function imagePngBase64(buf: Buffer) {
  return { type: "image" as const, data: buf.toString("base64"), mimeType: "image/png" };
}

// Define tool schemas
const toolSchemas = {
  "rce_start": z.object({
    url: z.string().url().optional().describe("URL to navigate to"),
    serverCmd: z.string().optional().describe("Server command to run (e.g., 'npm run dev')"),
    bootWait: z.number().int().optional().describe("Milliseconds to wait for server to boot"),
  }),
  "rce_stop": z.object({}).strict(),
  "rce_restart": z.object({}).strict(),
  "rce_frames": z.object({}).strict(),
  "rce_shot": z.object({
    at: z.string().optional().describe("Timestamp (ISO, +ms, or ts#k)"),
    index: z.number().int().optional().describe("Event index"),
    ts: z.number().optional().describe("Unix timestamp in milliseconds (rounds down to nearest frame)"),
    tabId: z.number().int().optional().describe("Tab ID for multi-tab recordings"),
  }),
  "rce_screenshot-latest": z.object({}).strict(),
  "rce_diff": z.object({
    from: z.number().int().describe("From event index"),
    to: z.number().int().describe("To event index"),
    tabId: z.number().int().optional().describe("Tab ID"),
    format: z.enum(["html", "json"]).optional().describe("Output format"),
  }),
  "rce_tabs": z.object({
    action: z.enum(["list"]).optional().describe("Tab action (currently only list supported)"),
  }),
  "rce_action_navigate": z.object({
    url: z.string().describe("URL to navigate to"),
    waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
  }),
  "rce_action_navigate-back": z.object({}).strict(),
  "rce_action_click": z.object({
    selector: z.string().describe("CSS selector"),
    button: z.enum(["left", "right", "middle"]).optional(),
    clickCount: z.number().int().optional(),
  }),
  "rce_action_type": z.object({
    selector: z.string().describe("CSS selector"),
    text: z.string().describe("Text to type"),
    delayMs: z.number().int().optional(),
  }),
  "rce_action_press-key": z.object({
    key: z.string().describe("Key name (e.g., 'Enter', 'Escape')"),
  }),
  "rce_action_hover": z.object({
    selector: z.string().describe("CSS selector"),
  }),
  "rce_action_select-option": z.object({
    selector: z.string().describe("CSS selector"),
    value: z.string().optional(),
    label: z.string().optional(),
    index: z.number().int().optional(),
  }),
  "rce_action_file-upload": z.object({
    selector: z.string().describe("CSS selector"),
    filePaths: z.array(z.string()).min(1).describe("Array of file paths"),
  }),
  "rce_action_evaluate": z.object({
    expression: z.string().describe("JavaScript expression or function"),
    isFunction: z.boolean().optional(),
    args: z.array(z.any()).optional(),
  }),
  "rce_action_wait-for": z.object({
    selector: z.string().optional(),
    state: z.enum(["attached", "visible", "hidden", "detached"]).optional(),
    timeoutMs: z.number().int().optional(),
  }),
  "rce_action_resize": z.object({
    width: z.number().int().describe("Viewport width"),
    height: z.number().int().describe("Viewport height"),
  }),
  "rce_action_take-screenshot": z.object({
    path: z.string().optional(),
    fullPage: z.boolean().optional(),
  }),
  "rce_action_snapshot": z.object({}).strict(),
  "rce_action_handle-dialog": z.object({
    action: z.enum(["accept", "dismiss"]),
    promptText: z.string().optional(),
  }),
  "rce_action_close": z.object({}).strict(),
  "rce_action_drag": z.object({
    from: z.object({
      selector: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    }),
    to: z.object({
      selector: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    }),
    steps: z.number().int().optional(),
  }),
};

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "rce_start",
        description: "Start recording a web application session with rrweb",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to navigate to" },
            serverCmd: { type: "string", description: "Server command to run" },
            bootWait: { type: "number", description: "Milliseconds to wait for server" },
          },
        },
      },
      {
        name: "rce_stop",
        description: "Stop the current recording session",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "rce_restart",
        description: "Restart the recording session",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "rce_frames",
        description: "List all recorded frames with timestamps",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "rce_shot",
        description: "Take a screenshot at a specific timestamp or event index",
        inputSchema: {
          type: "object",
          properties: {
            at: { type: "string", description: "Timestamp (ISO, +ms, or ts#k)" },
            index: { type: "number", description: "Event index" },
            ts: { type: "number", description: "Unix timestamp in milliseconds (rounds down)" },
            tabId: { type: "number", description: "Tab ID" },
          },
        },
      },
      {
        name: "rce_screenshot-latest",
        description: "Get the latest screenshot",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "rce_diff",
        description: "Generate a DOM diff between two event indices",
        inputSchema: {
          type: "object",
          properties: {
            from: { type: "number", description: "From event index" },
            to: { type: "number", description: "To event index" },
            tabId: { type: "number", description: "Tab ID" },
            format: { type: "string", enum: ["html", "json"] },
          },
          required: ["from", "to"],
        },
      },
      {
        name: "rce_tabs",
        description: "Manage browser tabs (list tabs)",
        inputSchema: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["list"], description: "Tab action" },
          },
        },
      },
      // Browser actions
      {
        name: "rce_action_navigate",
        description: "Navigate to a URL",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string" },
            waitUntil: { type: "string", enum: ["load", "domcontentloaded", "networkidle"] },
          },
          required: ["url"],
        },
      },
      {
        name: "rce_action_click",
        description: "Click an element",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string" },
            button: { type: "string", enum: ["left", "right", "middle"] },
            clickCount: { type: "number" },
          },
          required: ["selector"],
        },
      },
      {
        name: "rce_action_type",
        description: "Type text into an element",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string" },
            text: { type: "string" },
            delayMs: { type: "number" },
          },
          required: ["selector", "text"],
        },
      },
      {
        name: "rce_action_press-key",
        description: "Press a keyboard key",
        inputSchema: {
          type: "object",
          properties: {
            key: { type: "string" },
          },
          required: ["key"],
        },
      },
      {
        name: "rce_action_hover",
        description: "Hover over an element",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string" },
          },
          required: ["selector"],
        },
      },
      {
        name: "rce_action_select-option",
        description: "Select an option in a dropdown",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string" },
            value: { type: "string" },
            label: { type: "string" },
            index: { type: "number" },
          },
          required: ["selector"],
        },
      },
      {
        name: "rce_action_wait-for",
        description: "Wait for an element to reach a state",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string" },
            state: { type: "string", enum: ["attached", "visible", "hidden", "detached"] },
            timeoutMs: { type: "number" },
          },
        },
      },
      {
        name: "rce_action_resize",
        description: "Resize the browser viewport",
        inputSchema: {
          type: "object",
          properties: {
            width: { type: "number" },
            height: { type: "number" },
          },
          required: ["width", "height"],
        },
      },
      {
        name: "rce_action_take-screenshot",
        description: "Take a screenshot of the current page",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            fullPage: { type: "boolean" },
          },
        },
      },
      {
        name: "rce_action_snapshot",
        description: "Get HTML snapshot of the current page",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Session control tools
    if (name === "rce_start") {
      const payload = toolSchemas["rce_start"].parse(args);
      const cmdArgs = ["dev"];
      if (payload.url) cmdArgs.push("--url", payload.url);
      if (payload.serverCmd) cmdArgs.push("--serverCmd", payload.serverCmd);
      if (payload.bootWait) cmdArgs.push("--bootWait", String(payload.bootWait));

      const res = await execJson(cmdArgs);
      return { content: [text(JSON.stringify(res, null, 2))] };
    }

    if (name === "rce_stop") {
      const res = await execJson(["stop"]);
      return { content: [text(JSON.stringify(res, null, 2))] };
    }

    if (name === "rce_restart") {
      const res = await execJson(["restart"]);
      return { content: [text(JSON.stringify(res, null, 2))] };
    }

    // Time travel tools
    if (name === "rce_frames") {
      const res = await execJson(["frames"]);
      return { content: [text(JSON.stringify(res, null, 2))] };
    }

    if (name === "rce_shot") {
      const payload = toolSchemas["rce_shot"].parse(args);
      const cmdArgs = ["shot"];
      if (payload.at) cmdArgs.push("--at", payload.at);
      if (payload.index !== undefined) cmdArgs.push("--index", String(payload.index));
      if (payload.ts !== undefined) cmdArgs.push("--ts", String(payload.ts));
      if (payload.tabId !== undefined) cmdArgs.push("--tab", String(payload.tabId));

      const res = await execJson<{ path: string }>(cmdArgs);
      const buf = await readFile(res.path);
      return { content: [imagePngBase64(buf)] };
    }

    if (name === "rce_screenshot-latest") {
      const res = await execJson<{ path: string }>(["screenshot"]);
      const buf = await readFile(res.path);
      return { content: [imagePngBase64(buf)] };
    }

    if (name === "rce_diff") {
      const payload = toolSchemas["rce_diff"].parse(args);
      const cmdArgs = ["diff", "--from", String(payload.from), "--to", String(payload.to)];
      if (payload.tabId !== undefined) cmdArgs.push("--tab", String(payload.tabId));
      if (payload.format) cmdArgs.push("--format", payload.format);

      const res = await execJson<{ path: string }>(cmdArgs);
      return { content: [text(`Diff saved: ${res.path}`)] };
    }

    if (name === "rce_tabs") {
      const payload = toolSchemas["rce_tabs"].parse(args);
      const cmdArgs = ["tabs", payload.action || "list"];
      const res = await execJson(cmdArgs);
      return { content: [text(JSON.stringify(res, null, 2))] };
    }

    // Browser actions
    if (name.startsWith("rce_action_")) {
      const actionName = name.replace("rce_action_", "");
      const browserTool = `browser_${actionName.replace(/-/g, "_")}`;

      const res = await execJson(["action", browserTool], args);
      return { content: [text(JSON.stringify(res, null, 2))] };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error: any) {
    return {
      content: [text(`Error: ${error.message}`)],
      isError: true,
    };
  }
});

// Resources
const RESOURCES = [
  { uri: "rce://current/console", path: ".rce/current/logs/console.jsonl", mime: "text/plain", name: "console" },
  { uri: "rce://current/network", path: ".rce/current/logs/network.jsonl", mime: "text/plain", name: "network" },
  { uri: "rce://current/js-errors", path: ".rce/current/logs/js_errors.jsonl", mime: "text/plain", name: "js-errors" },
  { uri: "rce://current/frames", path: ".rce/current/rrweb/frames.jsonl", mime: "text/plain", name: "frames" },
  {
    uri: "rce://current/screenshot-latest",
    path: ".rce/current/screenshots/latest.png",
    mime: "image/png",
    name: "screenshot-latest",
  },
];

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: RESOURCES.map((r) => ({
      uri: r.uri,
      name: r.name,
      mimeType: r.mime,
      description: "RCE artifact",
    })),
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  const r = RESOURCES.find((x) => x.uri === uri);
  if (!r) {
    throw new Error(`Unknown resource: ${uri}`);
  }

  try {
    const bytes = await readFile(r.path);
    if (r.mime === "image/png") {
      return {
        contents: [
          {
            uri: r.uri,
            mimeType: r.mime,
            blob: bytes.toString("base64"),
          },
        ],
      };
    }
    return {
      contents: [
        {
          uri: r.uri,
          mimeType: r.mime,
          text: bytes.toString("utf8"),
        },
      ],
    };
  } catch (error: any) {
    throw new Error(`Failed to read resource ${uri}: ${error.message}`);
  }
});

// Bootstrap
async function main() {
  // If RCE_WORK_DIR is set, change to that directory
  if (process.env.RCE_WORK_DIR) {
    process.chdir(process.env.RCE_WORK_DIR);
    console.error(`RCE MCP server changed to: ${process.cwd()}`);
  }
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("RCE MCP server ready (stdio).");
  console.error(`RCE MCP server cwd: ${process.cwd()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


