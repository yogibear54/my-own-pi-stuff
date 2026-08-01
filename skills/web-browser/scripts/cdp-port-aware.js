/**
 * Port-aware CDP client
 */
import WebSocket from "ws";

export async function connect(port = 9222, timeout = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetch(`http://localhost:${port}/json/version`, {
      signal: controller.signal,
    });
    const { webSocketDebuggerUrl } = await resp.json();
    clearTimeout(timeoutId);

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(webSocketDebuggerUrl);
      const connectTimeout = setTimeout(() => {
        ws.close();
        reject(new Error("WebSocket connect timeout"));
      }, timeout);

      ws.on("open", () => {
        clearTimeout(connectTimeout);
        resolve(new CDP(ws));
      });
      ws.on("error", (e) => {
        clearTimeout(connectTimeout);
        reject(e);
      });
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === "AbortError") {
      throw new Error(`Connection timeout - is Chrome running on port ${port}?`);
    }
    throw e;
  }
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.callbacks = new Map();
    this.sessions = new Map();
    this.eventHandlers = new Map();

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) {
          reject(new Error(msg.error.message));
        } else {
          resolve(msg.result);
        }
      }
    });
  }

  send(method, params = {}, sessionId = null) {
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(msg));
    });
  }
}