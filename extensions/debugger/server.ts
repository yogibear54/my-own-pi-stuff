/**
 * HTTP log server for the Pi AI Debugger.
 *
 * Receives structured telemetry POSTed by injected logging snippets, validates
 * the payload against the telemetry schema, appends each accepted packet as a
 * JSONL line to a per-session log file, and keeps an in-memory ring buffer of
 * recent packets for the instrumentation widget.
 *
 * Standalone module — no pi context required. Built on node:http (no external
 * deps). Reference: docs/01-log-server.md.
 */
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { join } from "node:path";

/** Default inbound port (requirements: 8866). */
export const DEFAULT_PORT = 8866;

/** Env var that overrides the settings-configured port. */
const PORT_ENV = "PI_DEBUGGER_PORT";
/** Settings.json key/field: `{ "debugger": { "port": <number> } }`. */
const PORT_SETTINGS_KEY = "debugger";
const PORT_SETTINGS_FIELD = "port";

/** Maximum TCP port (auto-increment ceiling). */
const MAX_PORT = 65535;
/** Default ring-buffer size (last N accepted packets). */
const DEFAULT_BUFFER_SIZE = 500;
/** Session-id length (alphanumeric filename stem). */
const SESSION_ID_LEN = 8;

/** Required telemetry source location. */
export interface TelemetrySource {
	file: string;
	line: number;
	function: string;
}

/** A validated telemetry packet. */
export interface TelemetryPacket {
	log_id: string;
	event_timestamp: string;
	level: string;
	source: TelemetrySource;
	message: string;
	variables?: object;
	stack_trace?: string;
}

/** Subscriber callback, invoked synchronously per accepted packet. */
export type PacketCallback = (packet: TelemetryPacket, seq: number) => void;

/** Options for {@link startLogServer}. */
export interface LogServerOptions {
	/** Explicit port (highest precedence). */
	port?: number;
	/** Working directory for the logs folder. Defaults to process.cwd(). */
	cwd?: string;
	/** Ring-buffer size. Defaults to 500. */
	bufferSize?: number;
}

/** Handle returned by {@link startLogServer}. */
export interface LogServerHandle {
	/** Actual bound port (may exceed the requested port after auto-increment). */
	port: number;
	/** Absolute path of the per-session JSONL log file. */
	logFile: string;
	/** `http://localhost:<port>` — where injected snippets POST telemetry. */
	telemetryTarget: string;
	/** Stop the listener and drop the ring buffer. Idempotent. */
	close(): void;
	/** Set the single subscriber invoked per accepted packet. */
	onPacket(cb: PacketCallback): void;
}

/**
 * Validate an unknown value as a telemetry packet. Rejects if any required
 * field is missing or wrong-typed. `level` must be a non-empty string (no enum
 * check). `variables` / `stack_trace`, if present, must be the right type.
 */
function isTelemetryPacket(v: unknown): v is TelemetryPacket {
	if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
	const p = v as Record<string, unknown>;
	if (typeof p.log_id !== "string") return false;
	if (typeof p.event_timestamp !== "string") return false;
	if (typeof p.level !== "string" || p.level === "") return false;
	const s = p.source;
	if (typeof s !== "object" || s === null || Array.isArray(s)) return false;
	const src = s as Record<string, unknown>;
	if (typeof src.file !== "string") return false;
	if (typeof src.line !== "number") return false;
	if (typeof src.function !== "string") return false;
	if (typeof p.message !== "string") return false;
	if (p.variables !== undefined && (typeof p.variables !== "object" || p.variables === null)) return false;
	if (p.stack_trace !== undefined && typeof p.stack_trace !== "string") return false;
	return true;
}

/** Read the `debugger.port` number from a settings.json file, or undefined if absent/malformed. */
function readPortFromSettings(file: string): number | undefined {
	let text: string;
	try {
		text = readFileSync(file, "utf8");
	} catch {
		return undefined;
	}
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		return undefined;
	}
	const dbg = (json as Record<string, unknown> | null)?.[PORT_SETTINGS_KEY];
	if (typeof dbg === "object" && dbg !== null) {
		const port = (dbg as Record<string, unknown>)[PORT_SETTINGS_FIELD];
		if (typeof port === "number" && Number.isInteger(port)) return port;
	}
	return undefined;
}

/**
 * Resolve the effective port: option > env > project settings > global settings
 * > default. Project-local settings override global.
 */
function resolvePort(opts: LogServerOptions, cwd: string): number {
	if (typeof opts.port === "number") return opts.port;
	const env = process.env[PORT_ENV];
	if (env !== undefined && env !== "") {
		const n = Number.parseInt(env, 10);
		if (Number.isInteger(n)) return n;
	}
	const local = readPortFromSettings(join(cwd, CONFIG_DIR_NAME, "settings.json"));
	if (typeof local === "number") return local;
	const global = readPortFromSettings(join(getAgentDir(), "settings.json"));
	if (typeof global === "number") return global;
	return DEFAULT_PORT;
}

/** Generate an 8-char base36 session id from random bytes (rejection-sampled to avoid modulo bias). */
function newSessionId(): string {
	const max = 36n ** BigInt(SESSION_ID_LEN); // ~41.4 bits → 6 random bytes suffice
	let n = max;
	while (n >= max) {
		const bytes = randomBytes(6); // 48 bits
		n = 0n;
		for (const b of bytes) n = (n << 8n) | BigInt(b);
	}
	return n.toString(36).padStart(SESSION_ID_LEN, "0");
}

/** Write a JSON response. */
function respond(res: ServerResponse, status: number, body?: unknown, headers?: Record<string, string>): void {
	res.writeHead(status, { "Content-Type": "application/json", ...(headers ?? {}) });
	res.end(body !== undefined ? JSON.stringify(body) : "");
}

/**
 * Start the HTTP log server. Resolves once listening. On `EADDRINUSE`, the port
 * auto-increments (up to {@link MAX_PORT}) until a free port is found.
 */
export async function startLogServer(opts: LogServerOptions = {}): Promise<LogServerHandle> {
	const cwd = opts.cwd ?? process.cwd();
	const bufferSize = opts.bufferSize ?? DEFAULT_BUFFER_SIZE;
	const startPort = resolvePort(opts, cwd);

	// --- Per-session log file: <cwd>/<CONFIG_DIR_NAME>/logs/<id>.log ---
	const logsDir = join(cwd, CONFIG_DIR_NAME, "logs");
	mkdirSync(logsDir, { recursive: true });
	const logFile = join(logsDir, `${newSessionId()}.log`);
	writeFileSync(logFile, ""); // create the session file up front

	// --- In-memory state ---
	const buffer: { seq: number; packet: TelemetryPacket }[] = [];
	let seq = 0;
	let packetCb: PacketCallback | null = null;
	let closed = false;

	const accept = (packet: TelemetryPacket): void => {
		const n = ++seq;
		buffer.push({ seq: n, packet });
		if (buffer.length > bufferSize) buffer.shift();
		appendFileSync(logFile, `${JSON.stringify(packet)}\n`);
		packetCb?.(packet, n);
	};

	const server = createServer((req, res) => {
		if (req.method !== "POST") {
			respond(res, 405, { status: "error" }, { Allow: "POST" });
			return;
		}
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("error", () => respond(res, 400, { status: "error" }));
		req.on("end", () => {
			let parsed: unknown;
			try {
				parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			} catch {
				respond(res, 400, { status: "error" });
				return;
			}
			if (!isTelemetryPacket(parsed)) {
				respond(res, 400, { status: "error" });
				return;
			}
			accept(parsed);
			respond(res, 200, { status: "success" });
		});
	});

	const port = await new Promise<number>((resolve, reject) => {
		let port = startPort;
		server.on("error", (err: NodeJS.ErrnoException) => {
			if (err.code === "EADDRINUSE" && port < MAX_PORT) {
				port++;
				server.listen(port, "127.0.0.1");
			} else {
				reject(err);
			}
		});
		server.on("listening", () => {
			const addr = server.address();
			resolve(addr && typeof addr === "object" ? addr.port : port);
		});
		server.listen(port, "127.0.0.1");
	});

	return {
		port,
		logFile,
		telemetryTarget: `http://localhost:${port}`,
		close() {
			if (closed) return;
			closed = true;
			buffer.length = 0;
			server.close();
		},
		onPacket(cb) {
			packetCb = cb;
		},
	};
}
