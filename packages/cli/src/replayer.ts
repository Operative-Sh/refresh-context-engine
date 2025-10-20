import { chromium } from "playwright";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { FrameEntry } from "./types.js";

export async function replayAndScreenshot(
  events: any[],
  targetIndex: number,
  outPath: string,
  viewport: { width: number; height: number }
): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport })).newPage();
  
  const subset = events.slice(0, targetIndex + 1);
  
  console.error(`[replay] Replaying ${subset.length} events to index ${targetIndex}`);
  
  const html = `
<!doctype html>
<meta charset="utf-8"/>
<style>html,body,#root{margin:0;height:100%;overflow:hidden}</style>
<div id="root"></div>
<script>window.__EVENTS__ = ${JSON.stringify(subset)};</script>
<script src="https://unpkg.com/rrweb@latest/dist/rrweb.min.js"></script>
<script src="https://unpkg.com/rrweb@latest/dist/rrweb-replay.min.js"></script>
<script>
(function(){
  console.log('Starting replay with', window.__EVENTS__.length, 'events');
  const root = document.getElementById('root');
  const r = new rrweb.Replayer(window.__EVENTS__, {
    root, 
    speed: 9999,  // Play super fast to reach target frame
    mouseTail: false, 
    showWarning: false, 
    UNSAFE_replayCanvas: true,
    skipInactive: true
  });
  
  let readyFired = false;
  const markReady = () => {
    if (!readyFired) {
      readyFired = true;
      console.log('Replay complete, marking ready');
      setTimeout(() => window._ready = 1, 300);
    }
  };
  
  r.on('finish', markReady);
  r.on('fullsnapshot-rebuilded', () => {
    console.log('Full snapshot rebuilt');
  });
  
  r.play();
  
  // Fallback: mark ready after 2 seconds regardless
  setTimeout(markReady, 2000);
})();
</script>`;
  
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForFunction(() => (window as any)._ready === 1, { timeout: 30000 }).catch(() => {
    console.error("[replay] Warning: Timeout waiting for replay ready signal");
  });
  
  // Wait a bit more for any async rendering
  await new Promise(r => setTimeout(r, 200));
  
  // Ensure output directory exists
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  
  await page.screenshot({ path: outPath, fullPage: true });
  await browser.close();
  
  console.error(`[replay] Screenshot saved to ${outPath}`);
  return outPath;
}

export async function replayToHTML(
  events: any[],
  targetIndex: number,
  viewport: { width: number; height: number }
): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport })).newPage();
  
  const subset = events.slice(0, targetIndex + 1);
  
  const html = `
<!doctype html>
<meta charset="utf-8"/>
<style>html,body,#root{margin:0;height:100%}</style>
<div id="root"></div>
<script>window.__EVENTS__ = ${JSON.stringify(subset)};</script>
<script src="https://unpkg.com/rrweb@latest/dist/rrweb.min.js"></script>
<script src="https://unpkg.com/rrweb@latest/dist/rrweb-replay.min.js"></script>
<script>
(function(){
  const root = document.getElementById('root');
  const r = new rrweb.Replayer(window.__EVENTS__, {
    root, speed: 1, mouseTail: false, showWarning: false, UNSAFE_replayCanvas: true
  });
  r.pause();
  r.on('fullsnapshot-rebuilded', () => {
    r.play(0);
    setTimeout(() => {
      r.pause();
      requestAnimationFrame(() => requestAnimationFrame(() => window._ready = 1));
    }, 100);
  });
  r.play(0);
})();
</script>`;
  
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForFunction(() => (window as any)._ready === 1, { timeout: 30000 });
  
  // Get the replayed HTML content
  const replayedHtml = await page.evaluate(() => {
    const root = document.getElementById('root');
    return root ? root.innerHTML : '';
  });
  
  await browser.close();
  
  return replayedHtml;
}


