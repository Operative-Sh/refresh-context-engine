import { spawn } from "node:child_process";
import path from "node:path";

export async function execRce(args: string[], input?: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    // Pass current working directory as env var so RCE CLI uses it
    const env = {
      ...process.env,
      RCE_WORK_DIR: process.cwd()
    };
    
    const p = spawn("rce", args, { 
      stdio: ["pipe", "pipe", "pipe"],
      env
    });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    
    // Use 'exit' instead of 'close' - doesn't wait for stdio to close
    p.on("exit", (code) => {
      resolve({ stdout: out, stderr: err, code: code ?? 1 });
    });
    
    if (input) {
      p.stdin.write(input);
    }
    p.stdin.end();
  });
}

export async function execJson<T = any>(args: string[], payload?: any): Promise<T> {
  const finalArgs = [...args, "--json"];
  const body = payload ? JSON.stringify(payload) : undefined;
  const { stdout, stderr, code } = await execRce(finalArgs, body);
  if (code !== 0) throw new Error(stderr || `rce ${finalArgs.join(" ")} failed`);
  try { return JSON.parse(stdout) as T; } catch { throw new Error(`Bad JSON from rce: ${stdout}`); }
}


