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
  return txt.split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
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


