import { DiffDOM } from "diff-dom";
import { promises as fs } from "node:fs";
import path from "node:path";
import { replayToHTML } from "./replayer.js";

export async function generateDiff(
  events: any[],
  fromIndex: number,
  toIndex: number,
  outPath: string,
  format: "html" | "json",
  viewport: { width: number; height: number }
): Promise<string> {
  // Replay to fromIndex, extract HTML
  const html1 = await replayToHTML(events, fromIndex, viewport);
  
  // Replay to toIndex, extract HTML
  const html2 = await replayToHTML(events, toIndex, viewport);
  
  // Parse and diff using DiffDOM
  const dd = new DiffDOM();
  
  // Convert HTML strings to DOM for diffing
  const DOMParserClass = (globalThis as any).DOMParser;
  const parser = DOMParserClass ? new DOMParserClass() : null;
  
  // For Node.js environment, we need to work with HTML strings
  // DiffDOM can work with HTML strings directly in some cases
  let diff: any;
  try {
    // Try to diff the HTML strings
    diff = dd.diff(html1, html2);
  } catch (error) {
    // Fallback: simple text diff
    diff = {
      fromLength: html1.length,
      toLength: html2.length,
      changes: html1 !== html2 ? "HTML content differs" : "No changes"
    };
  }
  
  // Ensure output directory exists
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  
  if (format === "json") {
    await fs.writeFile(outPath, JSON.stringify(diff, null, 2));
  } else {
    // Generate HTML report with side-by-side view + highlighted changes
    const report = generateDiffReport(html1, html2, diff, fromIndex, toIndex);
    await fs.writeFile(outPath, report);
  }
  
  return outPath;
}

function generateDiffReport(
  html1: string,
  html2: string,
  diff: any,
  fromIndex: number,
  toIndex: number
): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>DOM Diff Report: Frame ${fromIndex} vs ${toIndex}</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      margin: 0;
      padding: 20px;
      background: #f5f5f5;
    }
    .header {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      margin: 0 0 10px 0;
      color: #333;
    }
    .meta {
      color: #666;
      font-size: 14px;
    }
    .container {
      display: flex;
      gap: 20px;
      margin-bottom: 20px;
    }
    .side {
      flex: 1;
      background: white;
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .side h2 {
      margin: 0 0 15px 0;
      color: #333;
      font-size: 18px;
      border-bottom: 2px solid #e0e0e0;
      padding-bottom: 10px;
    }
    .html-preview {
      max-height: 600px;
      overflow: auto;
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 10px;
      background: #fafafa;
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .diff-summary {
      background: white;
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .diff-summary h2 {
      margin: 0 0 15px 0;
      color: #333;
    }
    .diff-data {
      background: #f8f8f8;
      padding: 15px;
      border-radius: 4px;
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 12px;
      white-space: pre-wrap;
      max-height: 400px;
      overflow: auto;
    }
    .added {
      background-color: #e6ffe6;
      color: #006600;
    }
    .removed {
      background-color: #ffe6e6;
      color: #cc0000;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>DOM Diff Report</h1>
    <div class="meta">
      Comparing Frame ${fromIndex} → Frame ${toIndex}
    </div>
  </div>
  
  <div class="container">
    <div class="side">
      <h2>Frame ${fromIndex} (Before)</h2>
      <div class="html-preview">${escapeHtml(html1)}</div>
    </div>
    <div class="side">
      <h2>Frame ${toIndex} (After)</h2>
      <div class="html-preview">${escapeHtml(html2)}</div>
    </div>
  </div>
  
  <div class="diff-summary">
    <h2>Diff Details</h2>
    <div class="diff-data">${JSON.stringify(diff, null, 2)}</div>
  </div>
</body>
</html>`;
}

function escapeHtml(html: string): string {
  return html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

