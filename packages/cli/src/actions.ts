import type { Page } from "playwright";
import type { ActionResult } from "./types.js";
import { log } from "./logger.js";

export async function executeAction(
  page: Page,
  tool: string,
  args: any,
  startedAt: number
): Promise<ActionResult> {
  const t = Date.now();
  const dt = t - startedAt;
  const actionStart = Date.now();
  
  try {
    let result: any;
    
    switch (tool) {
      case "browser_navigate":
        await page.goto(args.url, { waitUntil: args.waitUntil ?? "domcontentloaded" });
        // Add 200ms buffer for any async rendering/state updates
        await new Promise(r => setTimeout(r, 200));
        result = { url: args.url, title: await page.title(), status: 200 };
        break;
      
      case "browser_navigate_back":
        await page.goBack({ waitUntil: "domcontentloaded" });
        // Add 200ms buffer for any async rendering/state updates
        await new Promise(r => setTimeout(r, 200));
        result = { url: page.url(), title: await page.title() };
        break;
      
      case "browser_click":
        await page.click(args.selector, {
          button: args.button ?? "left",
          clickCount: args.clickCount ?? 1,
          timeout: args.timeoutMs
        });
        result = { selector: args.selector };
        break;
      
      case "browser_type":
        await page.type(args.selector, args.text, { delay: args.delayMs });
        result = { selector: args.selector, chars: args.text.length };
        break;
      
      case "browser_press_key":
        await page.keyboard.press(args.key);
        result = { key: args.key };
        break;
      
      case "browser_hover":
        await page.hover(args.selector, { timeout: args.timeoutMs });
        result = { selector: args.selector };
        break;
      
      case "browser_select_option":
        const selectedValues = await page.selectOption(args.selector, 
          args.value !== undefined ? { value: args.value } :
          args.label !== undefined ? { label: args.label } :
          args.index !== undefined ? { index: args.index } : {}
        );
        result = { selector: args.selector, selected: selectedValues };
        break;
      
      case "browser_file_upload":
        await page.setInputFiles(args.selector, args.filePaths);
        result = { selector: args.selector, count: args.filePaths.length };
        break;
      
      case "browser_evaluate":
        const evalResult = await page.evaluate(
          args.isFunction !== false ? 
            new Function(`return (${args.expression})`)() : 
            args.expression,
          ...(args.args ?? [])
        );
        result = { value: evalResult };
        break;
      
      case "browser_wait_for":
        if (args.selector) {
          await page.waitForSelector(args.selector, {
            state: args.state ?? "visible",
            timeout: args.timeoutMs
          });
          result = { selector: args.selector, state: args.state ?? "visible" };
        } else {
          await page.waitForTimeout(args.timeoutMs ?? 1000);
          result = { waited: args.timeoutMs ?? 1000 };
        }
        break;
      
      case "browser_resize":
        await page.setViewportSize({ width: args.width, height: args.height });
        result = { width: args.width, height: args.height };
        break;
      
      case "browser_take_screenshot":
        const screenshotPath = args.path ?? `screenshot-${Date.now()}.png`;
        await page.screenshot({ 
          path: screenshotPath, 
          fullPage: args.fullPage ?? false 
        });
        result = { path: screenshotPath, fullPage: args.fullPage ?? false };
        break;
      
      case "browser_snapshot":
        const html = await page.content();
        result = { html, bytes: html.length };
        break;
      
      case "browser_handle_dialog":
        // Note: dialogs are handled via page.on('dialog') listener
        // This action sets up a one-time handler
        page.once("dialog", async (dialog) => {
          if (args.action === "accept") {
            await dialog.accept(args.promptText);
          } else {
            await dialog.dismiss();
          }
        });
        result = { action: args.action, ready: true };
        break;
      
      case "browser_close":
        await page.close();
        result = { closed: true };
        break;
      
      case "browser_drag":
        if (args.from && args.to) {
          // Drag from one selector/position to another
          const fromSelector = args.from.selector;
          const toSelector = args.to.selector;
          
          if (fromSelector && toSelector) {
            await page.dragAndDrop(fromSelector, toSelector);
            result = { from: fromSelector, to: toSelector };
          } else {
            // Coordinate-based drag
            const fromX = args.from.x ?? 0;
            const fromY = args.from.y ?? 0;
            const toX = args.to.x ?? 0;
            const toY = args.to.y ?? 0;
            
            await page.mouse.move(fromX, fromY);
            await page.mouse.down();
            await page.mouse.move(toX, toY, { steps: args.steps ?? 10 });
            await page.mouse.up();
            
            result = { from: { x: fromX, y: fromY }, to: { x: toX, y: toY } };
          }
        } else {
          throw new Error("Both 'from' and 'to' parameters are required for drag");
        }
        break;
      
      default:
        throw new Error(`Unknown action: ${tool}`);
    }
    
    const actionDuration = Date.now() - actionStart;
    log(`[action-timing] ${tool} executed in ${actionDuration}ms`);
    
    return { ok: true, t, dt, tool, args, result };
  } catch (error: any) {
    const actionDuration = Date.now() - actionStart;
    log(`[action-timing] ${tool} failed after ${actionDuration}ms: ${error.message}`);
    
    return {
      ok: false,
      t,
      dt,
      tool,
      args,
      error: { 
        message: error.message, 
        code: error.name === "TimeoutError" ? "E_TIMEOUT" : "E_ACTION_FAILED"
      }
    };
  }
}


