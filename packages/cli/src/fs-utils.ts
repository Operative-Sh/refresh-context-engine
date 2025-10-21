import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

export function nowId(): string {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}-${ms}`;
}

export async function ensureDirs(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function writeJsonLines(file: string, obj: any): Promise<void> {
  await ensureDirs(path.dirname(file));
  await fs.appendFile(file, JSON.stringify(obj) + "\n");
}

export async function readJsonLines<T = any>(file: string): Promise<T[]> {
  const txt = await fs.readFile(file, "utf8").catch(() => "");
  const lines = txt.split(/\r?\n/).filter(Boolean);
  const results: T[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    try {
      results.push(JSON.parse(lines[i]));
    } catch (error: any) {
      // Log the error but continue processing other lines
      console.error(`[rce] Warning: Failed to parse JSON line ${i + 1}: ${error.message}`);
      console.error(`[rce] Line preview: ${lines[i].substring(0, 100)}...`);
      // Skip malformed lines instead of failing completely
    }
  }
  
  return results;
}

export async function symlinkForce(target: string, linkPath: string): Promise<void> {
  try { await fs.rm(linkPath, { force: true, recursive: false }); } catch {}
  await fs.symlink(target, linkPath, os.platform() === "win32" ? "junction" : "dir");
}

export async function fileExists(f: string): Promise<boolean> {
  try {
    await fs.access(f);
    return true;
  } catch {
    return false;
  }
}

/**
 * Binary search to find the frame at or before the target timestamp
 * Returns the frame with largest ts <= targetTs (rounds down)
 */
export function binarySearchFrameByTimestamp<T extends { ts: number }>(
  frames: T[],
  targetTs: number
): T | null {
  if (!frames.length) return null;
  if (targetTs < frames[0].ts) return null; // Before first frame
  if (targetTs >= frames[frames.length - 1].ts) return frames[frames.length - 1];
  
  let left = 0;
  let right = frames.length - 1;
  let result: T | null = null;
  
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const frame = frames[mid];
    
    if (frame.ts <= targetTs) {
      result = frame; // This frame is a candidate
      left = mid + 1; // Look for a later frame that's still <= targetTs
    } else {
      right = mid - 1; // Look earlier
    }
  }
  
  return result;
}


