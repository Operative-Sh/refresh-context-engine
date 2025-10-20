import { createServer, type Server as NetServer, Socket } from "node:net";
import { promises as fs } from "node:fs";
import path from "node:path";
import { log } from "./logger.js";

export interface IPCMessage {
  id: string;
  type: "action" | "ping";
  tool?: string;
  args?: any;
}

export interface IPCResponse {
  id: string;
  ok: boolean;
  result?: any;
  error?: string;
}

export class IPCServer {
  private server: NetServer | null = null;
  private socketPath: string;
  private clients: Set<Socket> = new Set();
  private messageHandler: ((msg: IPCMessage) => Promise<IPCResponse>) | null = null;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  async start(): Promise<void> {
    console.error(`[ipc-debug] Starting IPC server at ${this.socketPath}`);
    
    // Close any existing server on this instance
    if (this.server) {
      console.error(`[ipc-debug] Closing existing server first...`);
      await this.stop();
      await new Promise(r => setTimeout(r, 100));
    }
    
    // Ensure socket directory exists
    await fs.mkdir(path.dirname(this.socketPath), { recursive: true });
    
    // Check if socket file exists before cleanup
    try {
      await fs.access(this.socketPath);
      console.error(`[ipc-debug] Socket file exists, removing...`);
      await fs.rm(this.socketPath, { force: true });
      await new Promise(r => setTimeout(r, 300));
      console.error(`[ipc-debug] Socket file removed`);
    } catch (err: any) {
      console.error(`[ipc-debug] No existing socket file (code: ${err.code})`);
    }

    return new Promise((resolve, reject) => {
      console.error(`[ipc-debug] Creating server...`);
      this.server = createServer((socket) => {
        socket.setNoDelay(true); // Disable Nagle's algorithm for immediate send
        this.clients.add(socket);
        
        let buffer = "";
        
        socket.on("data", async (data) => {
          buffer += data.toString();
          
          // Process complete messages (newline-delimited JSON)
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete message in buffer
          
          for (const line of lines) {
            if (!line.trim()) continue;
            
            try {
              const msg: IPCMessage = JSON.parse(line);
              log(`[ipc] Received message: ${msg.type} (id: ${msg.id})`);
              const response = await this.handleMessage(msg);
              log(`[ipc] Handler returned: ok=${response.ok} (id: ${response.id})`);
              const responseStr = JSON.stringify(response) + "\n";
              socket.write(responseStr, (err) => {
                if (err) {
                  console.error("[ipc] Error writing response:", err);
                } else {
                  log(`[ipc] Response sent successfully (id: ${response.id})`);
                }
              });
            } catch (error: any) {
              console.error("[ipc] Error processing message:", error);
              const errorResponse: IPCResponse = {
                id: "unknown",
                ok: false,
                error: error.message
              };
              const responseStr = JSON.stringify(errorResponse) + "\n";
              socket.write(responseStr, (err) => {
                if (err) console.error("[ipc] Error writing error response:", err);
              });
            }
          }
        });
        
        socket.on("end", () => {
          this.clients.delete(socket);
        });
        
        socket.on("error", (err) => {
          console.error("[ipc] Socket error:", err);
          this.clients.delete(socket);
        });
      });
      
      console.error(`[ipc-debug] Attempting to listen on ${this.socketPath}`);
      this.server.listen(this.socketPath, () => {
        console.error(`[ipc-debug] Server listening successfully!`);
        resolve();
      });
      
      this.server.on("error", (err: any) => {
        console.error(`[ipc-debug] Server error event fired: ${err.code}`);
        if (err.code === 'EADDRINUSE') {
          console.error(`[ipc] ERROR: Socket already in use at ${this.socketPath}`);
          console.error("[ipc] This usually means a previous RCE session didn't clean up properly.");
          console.error("[ipc] Try: pkill -f 'rce dev' or manually remove the socket file");
        }
        reject(err);
      });
    });
  }

  onMessage(handler: (msg: IPCMessage) => Promise<IPCResponse>): void {
    this.messageHandler = handler;
  }

  private async handleMessage(msg: IPCMessage): Promise<IPCResponse> {
    if (msg.type === "ping") {
      return { id: msg.id, ok: true, result: "pong" };
    }
    
    if (this.messageHandler) {
      return await this.messageHandler(msg);
    }
    
    return {
      id: msg.id,
      ok: false,
      error: "No message handler registered"
    };
  }

  async stop(): Promise<void> {
    // Close all client connections
    for (const client of this.clients) {
      client.destroy();
    }
    this.clients.clear();
    
    // Close server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => {
          resolve();
        });
      });
    }
    
    // Clean up socket file
    try {
      await fs.unlink(this.socketPath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        console.error("[ipc] Warning: Could not remove socket on stop:", err.message);
      }
    }
  }

  getSocketPath(): string {
    return this.socketPath;
  }
}

export class IPCClient {
  private socket: Socket | null = null;
  private socketPath: string;
  private pendingRequests = new Map<string, { resolve: (res: IPCResponse) => void; reject: (err: Error) => void }>();
  private buffer = "";

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new Socket();
      this.socket.setNoDelay(true); // Disable Nagle's algorithm
      
      this.socket.connect(this.socketPath, () => {
        console.error("[ipc-client] Connected to socket");
        resolve();
      });
      
      this.socket.on("data", (data) => {
        console.error(`[ipc-client] Received data: ${data.toString().substring(0, 100)}...`);
        this.buffer += data.toString();
        
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() || "";
        
        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const response: IPCResponse = JSON.parse(line);
            console.error(`[ipc-client] Parsed response: ok=${response.ok} (id: ${response.id})`);
            const pending = this.pendingRequests.get(response.id);
            if (pending) {
              this.pendingRequests.delete(response.id);
              console.error(`[ipc-client] Resolving pending request (id: ${response.id})`);
              pending.resolve(response);
            } else {
              console.error(`[ipc-client] No pending request found for id: ${response.id}`);
            }
          } catch (error) {
            console.error("[ipc-client] Failed to parse response:", error);
          }
        }
      });
      
      this.socket.on("error", (err) => {
        reject(err);
      });
      
      this.socket.on("close", () => {
        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
          pending.reject(new Error("Connection closed"));
          this.pendingRequests.delete(id);
        }
      });
    });
  }

  async sendAction(tool: string, args: any): Promise<IPCResponse> {
    if (!this.socket) {
      throw new Error("Not connected");
    }
    
    const id = Math.random().toString(36).substring(7);
    const msg: IPCMessage = { id, type: "action", tool, args };
    
    return new Promise((resolve, reject) => {
      console.error(`[ipc-client] Sending action: ${tool} (id: ${id})`);
      this.pendingRequests.set(id, { resolve, reject });
      
      // Write message to socket
      const msgStr = JSON.stringify(msg) + "\n";
      console.error(`[ipc-client] Writing message: ${msgStr.substring(0, 100)}...`);
      const written = this.socket!.write(msgStr);
      console.error(`[ipc-client] Write returned: ${written}`);
      
      if (!written) {
        // If socket buffer is full, wait for drain
        this.socket!.once('drain', () => {
          console.error("[ipc-client] Socket drained, message sent");
        });
      }
      
      // Timeout after 35 seconds to allow for Playwright's 30s action timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          console.error(`[ipc-client] Request timeout for id: ${id}`);
          reject(new Error("Request timeout after 35s"));
        }
      }, 35000);
    });
  }

  async ping(): Promise<boolean> {
    if (!this.socket) {
      throw new Error("Not connected");
    }
    
    const id = Math.random().toString(36).substring(7);
    const msg: IPCMessage = { id, type: "ping" };
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { 
        resolve: (res) => resolve(res.ok), 
        reject 
      });
      this.socket!.write(JSON.stringify(msg) + "\n");
      
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error("Ping timeout"));
        }
      }, 5000);
    });
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
  }
}

