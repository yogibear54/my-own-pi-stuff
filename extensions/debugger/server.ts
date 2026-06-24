/**
 * HTTP log server for the Pi AI Debugger (Part 1).
 *
 * Dependency-free (Node built-ins only). The caller supplies the logs directory
 * so this module stays decoupled from pi internals and is independently testable.
 *
 * Design reference: docs/01-log-server.md
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

/** Minimal shape of a telemetry packet (see docs/01-log-server.md). */
export interface LogPacket {
  log_id: string;
  event_timestamp: string;
  level: string;
  source: { file: string; line: number; function: string };
  message: string;
  variables?: Record<string, unknown>;
  stack_trace?: string;
  /** Any extra fields are preserved verbatim into the JSONL line. */
  [key: string]: unknown;
}

export interface LogServerHandle {
  /** Actual port the server is listening on (matches the requested port, or the OS-assigned one when 0). */
  readonly port: number;
  /** Absolute path of the per-session JSONL log file. */
  readonly logFile: string;
  /** Subscribe to each accepted packet. Returns an unsubscribe fn. */
  onPacket(cb: (packet: LogPacket) => void): () => void;
  /** Close the listener. Idempotent; resolves once closed. */
  close(): Promise<void>;
}

export interface StartLogServerOptions {
  /** Listening port. Default 8866. Pass 0 to let the OS assign a free port. */
  port?: number;
  /** Directory where the per-session log file is created (created if missing). */
  logsDir: string;
  /** Host/interface to bind. Defaults to loopback. */
  host?: string;
  /** Max packets kept in the in-memory ring buffer. Default 500. */
  bufferSize?: number;
}

const DEFAULT_PORT = 8866;
const DEFAULT_BUFFER_SIZE = 500;

/** Generate an 8-char alphanumeric base36 id for the log file name. */
function randomName8(): string {
  // 5 random bytes -> up to 10 base36 chars; slice 8. All chars are [0-9a-z].
  let s = "";
  for (const b of randomBytes(5)) s += b.toString(36).padStart(2, "0");
  return s.slice(0, 8);
}

/** Strict validation against the telemetry schema. */
export function isValidPacket(p: unknown): p is LogPacket {
  if (typeof p !== "object" || p === null) return false;
  const o = p as Record<string, unknown>;
  if (typeof o.log_id !== "string") return false;
  if (typeof o.event_timestamp !== "string") return false;
  if (typeof o.level !== "string") return false;
  if (typeof o.message !== "string") return false;

  const src = o.source;
  if (typeof src !== "object" || src === null) return false;
  const s = src as Record<string, unknown>;
  if (typeof s.file !== "string") return false;
  if (typeof s.line !== "number" || !Number.isFinite(s.line)) return false;
  if (typeof s.function !== "string") return false;

  if (o.variables !== undefined && (typeof o.variables !== "object" || o.variables === null)) return false;
  if (o.stack_trace !== undefined && typeof o.stack_trace !== "string") return false;
  return true;
}

/** Read and parse the request body as JSON. Throws on unparseable input. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(text); // throws SyntaxError on malformed JSON
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    Allow: "POST",
  });
  res.end(payload);
}

export async function startLogServer(opts: StartLogServerOptions): Promise<LogServerHandle> {
  const port = opts.port ?? DEFAULT_PORT;
  const host = opts.host ?? "127.0.0.1";
  const bufferCap = opts.bufferSize ?? DEFAULT_BUFFER_SIZE;

  await mkdir(opts.logsDir, { recursive: true });
  const logFile = join(opts.logsDir, `${randomName8()}.log`);

  const subscribers = new Set<(packet: LogPacket) => void>();
  const buffer: LogPacket[] = [];

  const server = createServer(async (req, res) => {
    // Only POST is allowed; everything else (GET, etc.) -> 405.
    if (req.method !== "POST") {
      send(res, 405, { status: "error", error: "Method Not Allowed" });
      return;
    }

    let parsed: unknown;
    try {
      parsed = await readJsonBody(req);
    } catch {
      send(res, 400, { status: "error", error: "Invalid JSON" });
      return;
    }

    if (!isValidPacket(parsed)) {
      send(res, 400, { status: "error", error: "Payload does not match telemetry schema" });
      return;
    }

    const packet = parsed;
    try {
      await appendFile(logFile, JSON.stringify(packet) + "\n", "utf8");
    } catch {
      send(res, 500, { status: "error", error: "Failed to write log" });
      return;
    }

    buffer.push(packet);
    if (buffer.length > bufferCap) buffer.shift();
    for (const cb of subscribers) {
      try {
        cb(packet);
      } catch {
        // subscriber errors must not affect request handling
      }
    }

    send(res, 200, { status: "success" });
  });

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return {
    port: actualPort,
    logFile,
    onPacket(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    close,
  };
}
