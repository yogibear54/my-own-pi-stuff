/**
 * Tests for LogCollector.
 *
 * Strategy:
 * - Each test gets an isolated temp directory for log file output.
 * - The HTTP server binds to port 0 (OS-assigned) so tests don't conflict
 *   with each other or with a running dev instance.
 * - After each test, the collector is stopped and the temp dir is cleaned up.
 * - Helper `postLog` sends a POST /log request and returns the response.
 *
 * Covers every verification criterion from the TODO:
 * - Start collector, POST a log entry, query it back
 * - POST invalid JSON → 400
 * - Ring buffer discards oldest when full
 * - Stop shuts down cleanly
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import { LogCollector } from "./log-collector.js";
import type { DebugLogEntry } from "./types.js";

// ── Test isolation ─────────────────────────────────────────────────────────

let tmpDir: string;
let collector: LogCollector;
let port: number;

beforeEach(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-debugger-logcollector-test-"));
	// Use port 0 to get an OS-assigned port (avoids conflicts)
	collector = new LogCollector(tmpDir, 100);
	await collector.start(0);
	port = collector.listeningPort;
});

afterEach(async () => {
	await collector.stop();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────────────────────────────

interface PostResult {
	status: number;
	body: unknown;
}

/** Send a POST /log request with a JSON body. */
function postLog(body: unknown): Promise<PostResult> {
	return new Promise((resolve, reject) => {
		const data = JSON.stringify(body);
		const req = http.request(
			{ hostname: "127.0.0.1", port, path: "/log", method: "POST", headers: { "Content-Type": "application/json" } },
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => {
					let parsed: unknown;
					try {
						parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
					} catch {
						parsed = Buffer.concat(chunks).toString("utf-8");
					}
					resolve({ status: res.statusCode ?? 0, body: parsed });
				});
			},
		);
		req.on("error", reject);
		req.write(data);
		req.end();
	});
}

/** Send a request with arbitrary method/path. */
function request(method: string, reqPath: string, body?: unknown): Promise<PostResult> {
	return new Promise((resolve, reject) => {
		const data = body ? JSON.stringify(body) : "";
		const req = http.request(
			{ hostname: "127.0.0.1", port, path: reqPath, method, headers: body ? { "Content-Type": "application/json" } : {} },
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => {
					let parsed: unknown;
					try {
						parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
					} catch {
						parsed = Buffer.concat(chunks).toString("utf-8");
					}
					resolve({ status: res.statusCode ?? 0, body: parsed });
				});
			},
		);
		req.on("error", reject);
		if (body) req.write(data);
		req.end();
	});
}

/** Build a valid log entry body with defaults. */
function makeEntry(overrides: Partial<DebugLogEntry> = {}): Record<string, unknown> {
	return {
		timestamp: "2026-06-11T17:30:00.000Z",
		session: "abc123",
		hypothesis: 1,
		file: "src/cart.ts",
		line: 42,
		level: "info",
		tag: "cart_state",
		data: { items: 3, total: 49.99 },
		...overrides,
	};
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("LogCollector", () => {
	// ── Lifecycle ────────────────────────────────────────────────────────
	describe("start / stop", () => {
		it("starts and reports running", () => {
			expect(collector.isRunning).toBe(true);
			expect(port).toBeGreaterThan(0);
		});

		it("stops cleanly", async () => {
			await collector.stop();
			expect(collector.isRunning).toBe(false);
			expect(collector.listeningPort).toBe(0);
		});

		it("stop is idempotent (safe to call twice)", async () => {
			await collector.stop();
			await collector.stop(); // should not throw
			expect(collector.isRunning).toBe(false);
		});
	});

	// ── POST /log — happy path ───────────────────────────────────────────
	describe("POST /log — valid entries", () => {
		it("accepts a valid log entry and returns 200", async () => {
			const result = await postLog(makeEntry());
			expect(result.status).toBe(200);
			expect(result.body).toEqual({ ok: true });
		});

		it("stores the entry in the buffer", async () => {
			await postLog(makeEntry());
			expect(collector.count).toBe(1);

			const logs = collector.getLogs({ sessionId: "abc123" });
			expect(logs).toHaveLength(1);
			expect(logs[0].session).toBe("abc123");
			expect(logs[0].tag).toBe("cart_state");
		});

		it("stores all fields correctly", async () => {
			await postLog(makeEntry());
			const entry = collector.getLogs({ sessionId: "abc123" })[0];
			expect(entry.timestamp).toBe("2026-06-11T17:30:00.000Z");
			expect(entry.session).toBe("abc123");
			expect(entry.hypothesis).toBe(1);
			expect(entry.file).toBe("src/cart.ts");
			expect(entry.line).toBe(42);
			expect(entry.level).toBe("info");
			expect(entry.tag).toBe("cart_state");
			expect(entry.data).toEqual({ items: 3, total: 49.99 });
		});

		it("appends to logs.jsonl on disk", async () => {
			await postLog(makeEntry());
			const logFile = path.join(tmpDir, ".pi", "debug", "abc123", "logs.jsonl");
			expect(fs.existsSync(logFile)).toBe(true);

			const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n");
			expect(lines).toHaveLength(1);
			const parsed = JSON.parse(lines[0]);
			expect(parsed.session).toBe("abc123");
		});

		it("defaults timestamp to now if omitted", async () => {
			const before = new Date().toISOString();
			await postLog(makeEntry({ timestamp: undefined }));
			const after = new Date().toISOString();

			const entry = collector.getLogs({ sessionId: "abc123" })[0];
			expect(entry.timestamp >= before).toBe(true);
			expect(entry.timestamp <= after).toBe(true);
		});

		it("defaults file to empty string if omitted", async () => {
			await postLog(makeEntry({ file: undefined }));
			const entry = collector.getLogs({ sessionId: "abc123" })[0];
			expect(entry.file).toBe("");
		});

		it("defaults line to 0 if omitted", async () => {
			await postLog(makeEntry({ line: undefined }));
			const entry = collector.getLogs({ sessionId: "abc123" })[0];
			expect(entry.line).toBe(0);
		});

		it("emits a 'log' event", async () => {
			let emitted: DebugLogEntry | undefined;
			collector.on("log", (entry: DebugLogEntry) => {
				emitted = entry;
			});

			await postLog(makeEntry({ tag: "emitted_tag" }));
			expect(emitted).toBeDefined();
			expect(emitted!.tag).toBe("emitted_tag");
		});

		it("accepts multiple entries", async () => {
			await postLog(makeEntry({ hypothesis: 1 }));
			await postLog(makeEntry({ hypothesis: 2 }));
			await postLog(makeEntry({ hypothesis: 3 }));
			expect(collector.count).toBe(3);
		});
	});

	// ── POST /log — validation errors ────────────────────────────────────
	describe("POST /log — validation errors", () => {
		it("returns 400 for invalid JSON", async () => {
			const result = await postRaw("{ not json !!!");
			expect(result.status).toBe(400);
			expect((result.body as { error: string }).error).toMatch(/Invalid JSON/);
		});

		it("returns 400 when session is missing", async () => {
			const result = await postLog(makeEntry({ session: undefined }));
			expect(result.status).toBe(400);
		});

		it("returns 400 when hypothesis is missing", async () => {
			const result = await postLog(makeEntry({ hypothesis: undefined }));
			expect(result.status).toBe(400);
		});

		it("returns 400 when level is missing", async () => {
			const result = await postLog(makeEntry({ level: undefined }));
			expect(result.status).toBe(400);
		});

		it("returns 400 when level is invalid", async () => {
			const result = await postLog(makeEntry({ level: "critical" }));
			expect(result.status).toBe(400);
		});

		it("returns 400 when tag is missing", async () => {
			const result = await postLog(makeEntry({ tag: undefined }));
			expect(result.status).toBe(400);
		});

		it("returns 400 when data is missing", async () => {
			const result = await postLog(makeEntry({ data: undefined }));
			expect(result.status).toBe(400);
		});

		it("returns 400 when data is an array", async () => {
			const result = await postLog(makeEntry({ data: [1, 2, 3] }));
			expect(result.status).toBe(400);
		});

		it("returns 400 when data is null", async () => {
			const result = await postLog(makeEntry({ data: null }));
			expect(result.status).toBe(400);
		});
	});

	// ── Routing ──────────────────────────────────────────────────────────
	describe("routing", () => {
		it("returns 404 for GET /log", async () => {
			const result = await request("GET", "/log");
			expect(result.status).toBe(404);
		});

		it("returns 404 for POST /other", async () => {
			const result = await request("POST", "/other", makeEntry());
			expect(result.status).toBe(404);
		});

		it("returns 404 for GET /", async () => {
			const result = await request("GET", "/");
			expect(result.status).toBe(404);
		});
	});

	// ── Ring buffer ──────────────────────────────────────────────────────
	describe("ring buffer", () => {
		it("discards oldest entries when buffer is full", async () => {
			// Create a collector with maxEntries=3
			await collector.stop();
			const small = new LogCollector(tmpDir, 3);
			await small.start(0);
			const smallPort = small.listeningPort;

			// POST 5 entries
			for (let i = 1; i <= 5; i++) {
				await postLogTo(smallPort, makeEntry({ hypothesis: i, tag: `tag_${i}` }));
			}

			expect(small.count).toBe(3);

			// Oldest 2 should be discarded; entries 3, 4, 5 remain
			const logs = small.getLogs({ limit: 100 });
			expect(logs.map((e) => e.hypothesis)).toEqual([5, 4, 3]); // newest first

			await small.stop();
		});

		it("still appends all entries to disk even when buffer is full", async () => {
			await collector.stop();
			const small = new LogCollector(tmpDir, 2);
			await small.start(0);
			const smallPort = small.listeningPort;

			for (let i = 1; i <= 4; i++) {
				await postLogTo(smallPort, makeEntry({ hypothesis: i }));
			}

			// Disk should have all 4
			const logFile = path.join(tmpDir, ".pi", "debug", "abc123", "logs.jsonl");
			const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n");
			expect(lines).toHaveLength(4);

			await small.stop();
		});
	});

	// ── getLogs filters ─────────────────────────────────────────────────
	describe("getLogs", () => {
		beforeEach(async () => {
			await postLog(makeEntry({ session: "s1", hypothesis: 1, level: "info", tag: "cart", data: { x: "hello" } }));
			await postLog(makeEntry({ session: "s1", hypothesis: 2, level: "warn", tag: "auth", data: { x: "world" } }));
			await postLog(makeEntry({ session: "s2", hypothesis: 1, level: "error", tag: "cart", data: { x: "hello" } }));
		});

		it("returns newest-first by default", () => {
			const logs = collector.getLogs({ sessionId: "s1" });
			expect(logs[0].hypothesis).toBe(2); // newest first
			expect(logs[1].hypothesis).toBe(1);
		});

		it("filters by sessionId", () => {
			const logs = collector.getLogs({ sessionId: "s2" });
			expect(logs).toHaveLength(1);
			expect(logs[0].session).toBe("s2");
		});

		it("filters by hypothesisId", () => {
			const logs = collector.getLogs({ hypothesisId: 1 });
			expect(logs).toHaveLength(2);
		});

		it("filters by tag", () => {
			const logs = collector.getLogs({ tag: "auth" });
			expect(logs).toHaveLength(1);
			expect(logs[0].tag).toBe("auth");
		});

		it("filters by level", () => {
			const logs = collector.getLogs({ level: "error" });
			expect(logs).toHaveLength(1);
			expect(logs[0].level).toBe("error");
		});

		it("filters by since (ISO 8601)", async () => {
			// Post one with a far-future timestamp
			await postLog(makeEntry({ session: "s1", tag: "future", timestamp: "2099-01-01T00:00:00.000Z" }));

			const logs = collector.getLogs({ sessionId: "s1", since: "2050-01-01T00:00:00.000Z" });
			expect(logs).toHaveLength(1);
			expect(logs[0].tag).toBe("future");
		});

		it("filters by search text", () => {
			const logs = collector.getLogs({ search: "world" });
			expect(logs).toHaveLength(1);
			expect(logs[0].tag).toBe("auth");
		});

		it("respects limit", () => {
			const logs = collector.getLogs({ limit: 2 });
			expect(logs.length).toBeLessThanOrEqual(2);
		});

		it("combines multiple filters", () => {
			const logs = collector.getLogs({ sessionId: "s1", level: "warn" });
			expect(logs).toHaveLength(1);
			expect(logs[0].tag).toBe("auth");
		});

		it("returns empty array when nothing matches", () => {
			const logs = collector.getLogs({ tag: "nonexistent" });
			expect(logs).toEqual([]);
		});
	});

	// ── getRecent ────────────────────────────────────────────────────────
	describe("getRecent", () => {
		it("returns last N entries for a session in chronological order", async () => {
			for (let i = 1; i <= 5; i++) {
				await postLog(makeEntry({ hypothesis: i, session: "s1" }));
			}
			await postLog(makeEntry({ session: "other" })); // different session

			const recent = collector.getRecent("s1", 3);
			expect(recent).toHaveLength(3);
			expect(recent.map((e) => e.hypothesis)).toEqual([3, 4, 5]); // chronological
		});

		it("returns all entries if fewer than count", async () => {
			await postLog(makeEntry({ session: "s1" }));
			const recent = collector.getRecent("s1", 10);
			expect(recent).toHaveLength(1);
		});

		it("returns empty for unknown session", () => {
			expect(collector.getRecent("nope", 5)).toEqual([]);
		});
	});

	// ── clear ────────────────────────────────────────────────────────────
	describe("clear", () => {
		it("clears the in-memory buffer", async () => {
			await postLog(makeEntry());
			expect(collector.count).toBe(1);

			collector.clear();
			expect(collector.count).toBe(0);
		});

		it("does not affect disk", async () => {
			await postLog(makeEntry());
			collector.clear();

			const logFile = path.join(tmpDir, ".pi", "debug", "abc123", "logs.jsonl");
			expect(fs.existsSync(logFile)).toBe(true);
		});
	});
});

// ── Extra helpers for ring buffer tests ────────────────────────────────────

/** POST a log entry to a specific port (for tests with separate collectors). */
function postLogTo(targetPort: number, body: Record<string, unknown>): Promise<PostResult> {
	return new Promise((resolve, reject) => {
		const data = JSON.stringify(body);
		const req = http.request(
			{ hostname: "127.0.0.1", port: targetPort, path: "/log", method: "POST", headers: { "Content-Type": "application/json" } },
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => {
					let parsed: unknown;
					try {
						parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
					} catch {
						parsed = Buffer.concat(chunks).toString("utf-8");
					}
					resolve({ status: res.statusCode ?? 0, body: parsed });
				});
			},
		);
		req.on("error", reject);
		req.write(data);
		req.end();
	});
}

/** POST raw text (not JSON-parsed) to test invalid JSON handling. */
function postRaw(text: string): Promise<PostResult> {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ hostname: "127.0.0.1", port, path: "/log", method: "POST", headers: { "Content-Type": "application/json" } },
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => {
					let parsed: unknown;
					try {
						parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
					} catch {
						parsed = Buffer.concat(chunks).toString("utf-8");
					}
					resolve({ status: res.statusCode ?? 0, body: parsed });
				});
			},
		);
		req.on("error", reject);
		req.write(text);
		req.end();
	});
}
