/**
 * Minimal MCP Streamable HTTP client for smoke tests and evidence capture.
 * Plain Node (global fetch), no dependencies. Understands both plain-JSON
 * and text/event-stream responses from the SDK transport.
 */
import { spawn } from "node:child_process";

export async function bootServer({ port, dataDir, cwd }) {
  const env = { ...process.env, PORT: String(port), FOREMAN_DATA_DIR: dataDir };
  const proc = spawn("node", ["dist/index.js"], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  proc.stdout.on("data", (d) => (log += d));
  proc.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return { proc, base, log: () => log };
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      proc.kill("SIGKILL");
      throw new Error(`server did not come up on :${port}\n${log}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

export async function stopServer(proc) {
  if (proc.exitCode !== null) return;
  proc.kill("SIGTERM");
  await Promise.race([
    new Promise((r) => proc.once("exit", r)),
    new Promise((r) => setTimeout(r, 3_000)),
  ]);
  if (proc.exitCode === null) proc.kill("SIGKILL");
}

export class McpClient {
  constructor(base) {
    this.url = `${base}/mcp`;
    this.nextId = 1;
  }

  async raw(method, params) {
    const id = this.nextId++;
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} -> HTTP ${res.status}: ${text.slice(0, 400)}`);
    // SSE: pick the data: line whose JSON-RPC id matches.
    if (text.includes("data:")) {
      for (const line of text.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const msg = JSON.parse(line.slice(5).trim());
        if (msg.id === id) return msg;
      }
      throw new Error(`${method}: no matching SSE message in: ${text.slice(0, 400)}`);
    }
    return JSON.parse(text);
  }

  async initialize() {
    const msg = await this.raw("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "foreman-smoke", version: "1.0.0" },
    });
    if (msg.error) throw new Error(`initialize error: ${JSON.stringify(msg.error)}`);
    return msg.result;
  }

  async listTools() {
    const msg = await this.raw("tools/list", {});
    if (msg.error) throw new Error(`tools/list error: ${JSON.stringify(msg.error)}`);
    return msg.result.tools;
  }

  async callTool(name, args = {}) {
    const msg = await this.raw("tools/call", { name, arguments: args });
    if (msg.error) throw new Error(`tools/call ${name} error: ${JSON.stringify(msg.error)}`);
    return msg.result;
  }
}

export function toolText(result) {
  return (result.content ?? []).map((c) => c.text ?? "").join("\n");
}
