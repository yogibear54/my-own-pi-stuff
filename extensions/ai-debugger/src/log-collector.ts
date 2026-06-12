/**
 * Log collector — lightweight HTTP server that receives instrumented log entries.
 *
 * Design:
 * - Listens on `127.0.0.1` only (not `0.0.0.0`) so it's unreachable from the network.
 * - Accepts `POST /log` with a JSON body matching the DebugLogEntry envelope.
 *   All other routes return 404.
 * - Stores entries in an in-memory ring buffer (configurable max, oldest discarded).
 * - Appends each entry to `.pi/debug/<session>/logs.jsonl` on disk.
 * - Emits a `"log"` event for each received entry (used by the widget for live updates).
 *
 * Per FR-4.1 through FR-4.4 of REQUIREMENTS.md.
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import type { DebugLogEntry, LogLevel } from "./types.js";

// ── Filter interface ───────────────────────────────────────────────────────

export interface LogFilter {
	sessionId?: string;
	hypothesisId?: number;
	tag?: string;
	level?: LogLevel;
	/** ISO 8601 — only return entries after this timestamp */
	since?: string;
	/** Free-text search across stringified data */
	search?: string;
	/** Max entries to return (default 50) */
	limit?: number;
}

// ── LogCollector ───────────────────────────────────────────────────────────

export class LogCollector extends EventEmitter {
	private readonly projectRoot: string;
	private readonly maxEntries: number;
	private buffer: DebugLogEntry[] = [];
	private server: http.Server | null = null;
	private port: number = 0;

	constructor(projectRoot: string, maxEntries: number) {
		super();
		this.projectRoot = projectRoot;
		this.maxEntries = maxEntries;
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────

	/**
	 * Start the HTTP log collector server.
	 *
	 * Binds to `127.0.0.1:<port>` only — not reachable from the network.
	 * Resolves once the server is listening.
	 *
	 * @param port - Port number (from config, default 19847)
	 */
	async start(port: number): Promise<void> {
		this.port = port;

		this.server = http.createServer((req, res) => {
			this.handleRequest(req, res);
		});

		return new Promise((resolve, reject) => {
			this.server!.on("error", reject);
			this.server!.listen(port, "127.0.0.1", () => {
				this.server!.removeListener("error", reject);
				// Read the actual port (important when port 0 is used for OS-assigned ports)
				const addr = this.server!.address();
				if (addr && typeof addr === "object") {
					this.port = addr.port;
				}
				resolve();
			});
		});
	}

	/**
	 * Stop the HTTP server gracefully.
	 *
	 * Stops accepting new connections and waits for in-flight requests to finish.
	 * Safe to call multiple times or when not started.
	 */
	async stop(): Promise<void> {
		if (!this.server) return;
		const server = this.server;
		this.server = null;
		return new Promise((resolve) => {
			server.close(() => resolve());
		});
	}

	/** Whether the server is currently running. */
	get isRunning(): boolean {
		return this.server !== null;
	}

	/** The port the server is listening on (0 if not started). */
	get listeningPort(): number {
		return this.server ? this.port : 0;
	}

	// ── Query ─────────────────────────────────────────────────────────────

	/**
	 * Query collected logs with optional filters.
	 *
	 * Returns entries from the in-memory ring buffer. Disk is not read —
	 * the ring buffer is the source of truth for queries. Full history is
	 * always on disk in `logs.jsonl`.
	 *
	 * @param filters - Optional filters (sessionId, hypothesisId, tag, level, since, search, limit)
	 * @returns Filtered log entries, newest first, limited to `filter.limit` (default 50)
	 */
	getLogs(filters: LogFilter = {}): DebugLogEntry[] {
		const limit = filters.limit ?? 50;
		let entries = this.buffer;

		if (filters.sessionId) {
			entries = entries.filter((e) => e.session === filters.sessionId);
		}
		if (filters.hypothesisId !== undefined) {
			entries = entries.filter((e) => e.hypothesis === filters.hypothesisId);
		}
		if (filters.tag) {
			entries = entries.filter((e) => e.tag === filters.tag);
		}
		if (filters.level) {
			entries = entries.filter((e) => e.level === filters.level);
		}
		if (filters.since) {
			const sinceMs = new Date(filters.since).getTime();
			if (!isNaN(sinceMs)) {
				entries = entries.filter((e) => new Date(e.timestamp).getTime() > sinceMs);
			}
		}
		if (filters.search) {
			const term = filters.search.toLowerCase();
			entries = entries.filter((e) => JSON.stringify(e).toLowerCase().includes(term));
		}

		// Return newest first, limited
		return entries.slice(-limit).reverse();
	}

	/**
	 * Get the most recent N entries for a session.
	 *
	 * Used by the debug session widget for the live log feed.
	 * Returns entries in chronological order (oldest to newest).
	 *
	 * @param sessionId - Session to get entries for
	 * @param count - Number of recent entries to return
	 */
	getRecent(sessionId: string, count: number): DebugLogEntry[] {
		const sessionEntries = this.buffer.filter((e) => e.session === sessionId);
		return sessionEntries.slice(-count);
	}

	/** Current number of entries in the in-memory buffer. */
	get count(): number {
		return this.buffer.length;
	}

	/** Clear all entries from the in-memory buffer. Does not affect disk. */
	clear(): void {
		this.buffer = [];
	}

	// ── HTTP handler (private) ────────────────────────────────────────────

	private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
		// Only POST /log is accepted
		if (req.method !== "POST" || req.url !== "/log") {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Not found. Only POST /log is accepted." }));
			return;
		}

		this.handlePostLog(req, res);
	}

	private handlePostLog(req: http.IncomingMessage, res: http.ServerResponse): void {
		const chunks: Buffer[] = [];

		req.on("data", (chunk: Buffer) => {
			chunks.push(chunk);
		});

		req.on("end", () => {
			const body = Buffer.concat(chunks).toString("utf-8");

			// Parse JSON
			let parsed: unknown;
			try {
				parsed = JSON.parse(body);
			} catch {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Invalid JSON" }));
				return;
			}

			// Validate and build entry
			const entry = this.validateAndBuildEntry(parsed);
			if (!entry) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						error:
							"Missing required fields. Required: session (string), hypothesis (number), level (string), tag (string), data (object).",
					}),
				);
				return;
			}

			// Store
			this.addToBuffer(entry);
			this.appendToDisk(entry);
			this.emit("log", entry);

			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: true }));
		});
	}

	/**
	 * Validate the POST body and build a DebugLogEntry.
	 *
	 * Required fields: session (string), hypothesis (number), level (valid LogLevel),
	 * tag (string), data (object).
	 * Optional fields with defaults: timestamp → now, file → "", line → 0.
	 *
	 * @returns A valid DebugLogEntry, or null if validation fails
	 */
	private validateAndBuildEntry(raw: unknown): DebugLogEntry | null {
		if (typeof raw !== "object" || raw === null) return null;
		const obj = raw as Record<string, unknown>;

		// Required fields
		if (typeof obj.session !== "string" || !obj.session) return null;
		if (typeof obj.hypothesis !== "number") return null;
		if (typeof obj.tag !== "string" || !obj.tag) return null;
		if (typeof obj.data !== "object" || obj.data === null || Array.isArray(obj.data)) return null;

		// Level must be a valid LogLevel
		const validLevels: LogLevel[] = ["debug", "info", "warn", "error"];
		if (!validLevels.includes(obj.level as LogLevel)) return null;

		return {
			timestamp:
				typeof obj.timestamp === "string" ? obj.timestamp : new Date().toISOString(),
			session: obj.session,
			hypothesis: obj.hypothesis,
			file: typeof obj.file === "string" ? obj.file : "",
			line: typeof obj.line === "number" ? obj.line : 0,
			level: obj.level as LogLevel,
			tag: obj.tag,
			data: obj.data as Record<string, unknown>,
		};
	}

	/** Add entry to the in-memory ring buffer, discarding oldest if at capacity. */
	private addToBuffer(entry: DebugLogEntry): void {
		this.buffer.push(entry);
		while (this.buffer.length > this.maxEntries) {
			this.buffer.shift();
		}
	}

	/** Append entry to `.pi/debug/<session>/logs.jsonl` on disk. */
	private appendToDisk(entry: DebugLogEntry): void {
		const logsDir = path.join(this.projectRoot, ".pi", "debug", entry.session);
		try {
			fs.mkdirSync(logsDir, { recursive: true });
			fs.appendFileSync(path.join(logsDir, "logs.jsonl"), JSON.stringify(entry) + "\n", "utf-8");
		} catch {
			// Disk write failure should not crash the collector or the instrumented app.
			// The in-memory buffer still has the data; disk is for persistence.
		}
	}
}
