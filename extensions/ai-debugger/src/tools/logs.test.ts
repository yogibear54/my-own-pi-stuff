/**
 * Tests for the debug_logs tool.
 *
 * Strategy:
 * - Pure functions (formatLogEntry, formatFilters, buildLogsResult, buildNoLogsMessage)
 *   are tested directly
 * - The execute function is tested with a real LogCollector in an isolated temp dir,
 *   POSTing actual log entries via HTTP and querying them back through the tool
 * - This end-to-end approach verifies: POST → collector buffer → getLogs → tool → formatted output
 *
 * Per TODO verifies:
 * - POST logs to collector → call debug_logs with no filter → returns all
 * - Filter by hypothesis=1 → returns only h1 logs
 * - No logs → "no logs collected yet" message
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import { SessionStore } from "../session-store.js";
import { LogCollector } from "../log-collector.js";
import { DEFAULTS } from "../config.js";
import {
	createLogsTool,
	formatLogEntry,
	formatFilters,
	buildLogsResult,
	buildNoLogsMessage,
	DEFAULT_LIMIT,
} from "./logs.js";
import type { LogsParams, LogsToolDeps } from "./logs.js";
import type { DebugLogEntry } from "../types.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// ── Test isolation ─────────────────────────────────────────────────────────

let tmpDir: string;
let store: SessionStore;
let collector: LogCollector;
let deps: LogsToolDeps;
let port: number;

beforeEach(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-debugger-logs-test-"));
	store = new SessionStore(tmpDir);
	collector = new LogCollector(tmpDir, 1000);
	await collector.start(0); // ephemeral port
	port = collector.listeningPort;
	deps = { store, collector };
});

afterEach(async () => {
	await collector.stop();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Create an active session and return its ID. */
function setupSession(): string {
	return store.create("Test bug", DEFAULTS.maxIterations).id;
}

/** Send a POST /log request with a JSON body. */
function postLog(body: unknown): Promise<{ status: number; body: unknown }> {
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

/** Build a valid log entry body for POSTing. */
function makeLogBody(overrides: Partial<DebugLogEntry> = {}): Record<string, unknown> {
	return {
		timestamp: "2026-06-14T12:30:45.000Z",
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

/** POST multiple log entries. */
async function postEntries(bodies: Record<string, unknown>[]): Promise<void> {
	for (const body of bodies) {
		await postLog(body);
	}
}

/** A minimal mock ctx (logs doesn't use UI). */
function makeCtx(): ExtensionContext {
	return {} as ExtensionContext;
}

/** Build a DebugLogEntry for pure-function tests. */
function makeEntry(overrides: Partial<DebugLogEntry> = {}): DebugLogEntry {
	return {
		timestamp: "2026-06-14T12:30:45.000Z",
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

// ── formatLogEntry ─────────────────────────────────────────────────────────

describe("formatLogEntry", () => {
	it("includes timestamp, hypothesis, file:line, level, and tag in header", () => {
		const result = formatLogEntry(makeEntry());
		expect(result).toContain("[2026-06-14T12:30:45.000Z]");
		expect(result).toContain("#1");
		expect(result).toContain("src/cart.ts:42");
		expect(result).toContain("[info]");
		expect(result).toContain("cart_state");
	});

	it("includes JSON-stringified data on the second line", () => {
		const result = formatLogEntry(makeEntry({ data: { count: 5 } }));
		const lines = result.split("\n");
		expect(lines).toHaveLength(2);
		expect(lines[1]).toBe('  {"count":5}');
	});

	it("omits line when it is 0", () => {
		const result = formatLogEntry(makeEntry({ line: 0 }));
		expect(result).toContain("src/cart.ts");
		expect(result).not.toContain("src/cart.ts:0");
	});

	it("shows (no location) when file is empty", () => {
		const result = formatLogEntry(makeEntry({ file: "", line: 0 }));
		expect(result).toContain("(no location)");
	});

	it("handles nested data objects", () => {
		const result = formatLogEntry(makeEntry({ data: { user: { name: "alice", age: 30 } } }));
		expect(result).toContain('"user"');
		expect(result).toContain('"alice"');
	});
});

// ── formatFilters ──────────────────────────────────────────────────────────

describe("formatFilters", () => {
	it("returns empty string when no filters active", () => {
		expect(formatFilters({})).toBe("");
	});

	it("includes hypothesis", () => {
		expect(formatFilters({ hypothesisId: 1 })).toContain("hypothesis=1");
	});

	it("includes multiple filters joined by comma", () => {
		const result = formatFilters({ hypothesisId: 2, level: "warn", tag: "checkout" });
		expect(result).toContain("hypothesis=2");
		expect(result).toContain("level=warn");
		expect(result).toContain("tag=checkout");
	});

	it("includes search in quotes", () => {
		const result = formatFilters({ search: "null pointer" });
		expect(result).toContain('search="null pointer"');
	});

	it("includes since timestamp", () => {
		const result = formatFilters({ since: "2026-06-14T00:00:00.000Z" });
		expect(result).toContain("since=2026-06-14T00:00:00.000Z");
	});

	it("includes limit", () => {
		expect(formatFilters({ limit: 10 })).toContain("limit=10");
	});
});

// ── buildLogsResult ────────────────────────────────────────────────────────

describe("buildLogsResult", () => {
	it("includes entry count in header", () => {
		const result = buildLogsResult("abc123", [makeEntry(), makeEntry()], {});
		expect(result).toContain("2 log entries for session abc123");
	});

	it("uses singular 'entry' for one log", () => {
		const result = buildLogsResult("abc123", [makeEntry()], {});
		expect(result).toContain("1 log entry for session abc123");
	});

	it("includes active filters in header", () => {
		const result = buildLogsResult("abc123", [makeEntry()], { level: "warn" });
		expect(result).toContain("(filters: level=warn)");
	});

	it("includes each formatted entry", () => {
		const entries = [
			makeEntry({ tag: "first" }),
			makeEntry({ tag: "second" }),
		];
		const result = buildLogsResult("abc123", entries, {});
		expect(result).toContain("first");
		expect(result).toContain("second");
	});

	it("includes next-step guidance", () => {
		const result = buildLogsResult("abc123", [makeEntry()], {});
		expect(result).toContain("debug_fix");
	});
});

// ── buildNoLogsMessage ─────────────────────────────────────────────────────

describe("buildNoLogsMessage", () => {
	it("suggests reproducing the bug when no logs at all", () => {
		const result = buildNoLogsMessage("abc123", 0);
		expect(result).toContain("No logs collected yet");
		expect(result).toContain("abc123");
		expect(result).toContain("reproduce the bug");
	});

	it("suggests broadening filters when logs exist but don't match", () => {
		const result = buildNoLogsMessage("abc123", 10);
		expect(result).toContain("No logs match the current filters");
		expect(result).toContain("10 total log(s)");
		expect(result).toContain("broadening");
	});

	it("includes session ID in both cases", () => {
		expect(buildNoLogsMessage("xyz789", 0)).toContain("xyz789");
		expect(buildNoLogsMessage("xyz789", 5)).toContain("xyz789");
	});
});

// ── createLogsTool — execute ───────────────────────────────────────────────

describe("createLogsTool — execute", () => {
	it("throws when no active session", async () => {
		const tool = createLogsTool(deps);
		await expect(
			tool.execute("call-1", {}, undefined, undefined, makeCtx()),
		).rejects.toThrow("No active debug session");
	});

	it("returns no-logs message when collector is empty", async () => {
		setupSession();
		const tool = createLogsTool(deps);
		const result = await tool.execute("call-1", {}, undefined, undefined, makeCtx());

		expect(result.content[0].text).toContain("No logs collected yet");
		expect(result.details.count).toBe(0);
		expect(result.details.totalInSession).toBe(0);
	});

	it("returns all logs for the session with no filters", async () => {
		const sessionId = setupSession();
		await postEntries([
			makeLogBody({ session: sessionId, tag: "first" }),
			makeLogBody({ session: sessionId, tag: "second" }),
			makeLogBody({ session: sessionId, tag: "third" }),
		]);

		const tool = createLogsTool(deps);
		const result = await tool.execute("call-1", {}, undefined, undefined, makeCtx());

		expect(result.details.count).toBe(3);
		expect(result.content[0].text).toContain("3 log entries");
		expect(result.content[0].text).toContain("first");
		expect(result.content[0].text).toContain("second");
		expect(result.content[0].text).toContain("third");
	});

	it("scopes results to the active session only", async () => {
		const sessionId = setupSession();
		// POST logs for a DIFFERENT session
		await postEntries([
			makeLogBody({ session: "other-session", tag: "other" }),
			makeLogBody({ session: sessionId, tag: "mine" }),
		]);

		const tool = createLogsTool(deps);
		const result = await tool.execute("call-1", {}, undefined, undefined, makeCtx());

		expect(result.details.count).toBe(1);
		expect(result.content[0].text).toContain("mine");
		expect(result.content[0].text).not.toContain("other");
	});

	it("filters by hypothesis ID", async () => {
		const sessionId = setupSession();
		await postEntries([
			makeLogBody({ session: sessionId, hypothesis: 1, tag: "h1a" }),
			makeLogBody({ session: sessionId, hypothesis: 2, tag: "h2" }),
			makeLogBody({ session: sessionId, hypothesis: 1, tag: "h1b" }),
		]);

		const tool = createLogsTool(deps);
		const result = await tool.execute(
			"call-1", { hypothesisId: 1 }, undefined, undefined, makeCtx(),
		);

		expect(result.details.count).toBe(2);
		expect(result.content[0].text).toContain("h1a");
		expect(result.content[0].text).toContain("h1b");
		expect(result.content[0].text).not.toContain('"h2"');
		expect(result.content[0].text).not.toContain("tag=h2");
	});

	it("filters by tag", async () => {
		const sessionId = setupSession();
		await postEntries([
			makeLogBody({ session: sessionId, tag: "cart_state" }),
			makeLogBody({ session: sessionId, tag: "checkout" }),
		]);

		const tool = createLogsTool(deps);
		const result = await tool.execute(
			"call-1", { tag: "cart_state" }, undefined, undefined, makeCtx(),
		);

		expect(result.details.count).toBe(1);
		expect(result.content[0].text).toContain("cart_state");
	});

	it("filters by level", async () => {
		const sessionId = setupSession();
		await postEntries([
			makeLogBody({ session: sessionId, level: "info", tag: "ok" }),
			makeLogBody({ session: sessionId, level: "error", tag: "bad" }),
			makeLogBody({ session: sessionId, level: "warn", tag: "risky" }),
		]);

		const tool = createLogsTool(deps);
		const result = await tool.execute(
			"call-1", { level: "error" }, undefined, undefined, makeCtx(),
		);

		expect(result.details.count).toBe(1);
		expect(result.content[0].text).toContain("[error]");
		expect(result.content[0].text).not.toContain("[info]");
	});

	it("filters by search term across data", async () => {
		const sessionId = setupSession();
		await postEntries([
			makeLogBody({ session: sessionId, data: { status: "success" }, tag: "a" }),
			makeLogBody({ session: sessionId, data: { status: "failure" }, tag: "b" }),
		]);

		const tool = createLogsTool(deps);
		const result = await tool.execute(
			"call-1", { search: "failure" }, undefined, undefined, makeCtx(),
		);

		expect(result.details.count).toBe(1);
		expect(result.content[0].text).toContain("failure");
	});

	it("respects explicit limit", async () => {
		const sessionId = setupSession();
		// Post 10 entries
		const bodies = Array.from({ length: 10 }, (_, i) =>
			makeLogBody({ session: sessionId, tag: `tag${i}` }),
		);
		await postEntries(bodies);

		const tool = createLogsTool(deps);
		const result = await tool.execute(
			"call-1", { limit: 3 }, undefined, undefined, makeCtx(),
		);

		expect(result.details.count).toBe(3);
		expect(result.content[0].text).toContain("3 log entries");
	});

	it("applies default limit of 50 when not specified", async () => {
		const sessionId = setupSession();
		// Post 60 entries
		const bodies = Array.from({ length: 60 }, (_, i) =>
			makeLogBody({ session: sessionId, tag: `tag${i}` }),
		);
		await postEntries(bodies);

		const tool = createLogsTool(deps);
		const result = await tool.execute("call-1", {}, undefined, undefined, makeCtx());

		expect(result.details.count).toBe(DEFAULT_LIMIT);
		expect(result.details.totalInSession).toBe(60);
	});

	it("returns no-logs-message when logs exist but filters exclude them", async () => {
		const sessionId = setupSession();
		await postEntries([
			makeLogBody({ session: sessionId, hypothesis: 1, tag: "h1" }),
		]);

		const tool = createLogsTool(deps);
		const result = await tool.execute(
			"call-1", { hypothesisId: 99 }, undefined, undefined, makeCtx(),
		);

		expect(result.details.count).toBe(0);
		expect(result.details.totalInSession).toBe(1);
		expect(result.content[0].text).toContain("No logs match the current filters");
		expect(result.content[0].text).toContain("1 total log(s)");
	});

	it("includes structured details with session, count, and filters", async () => {
		const sessionId = setupSession();
		await postEntries([makeLogBody({ session: sessionId })]);

		const tool = createLogsTool(deps);
		const result = await tool.execute(
			"call-1", { hypothesisId: 1, level: "info" }, undefined, undefined, makeCtx(),
		);

		expect(result.details.sessionId).toBe(sessionId);
		expect(result.details.count).toBe(1);
		expect(result.details.totalInSession).toBe(1);
		expect(result.details.filters).toEqual({ hypothesisId: 1, level: "info" });
	});

	it("includes filter info in the header when filters are active", async () => {
		const sessionId = setupSession();
		await postEntries([makeLogBody({ session: sessionId, hypothesis: 1 })]);

		const tool = createLogsTool(deps);
		const result = await tool.execute(
			"call-1", { hypothesisId: 1 }, undefined, undefined, makeCtx(),
		);

		expect(result.content[0].text).toContain("hypothesis=1");
	});

	it("returns entries newest-first", async () => {
		const sessionId = setupSession();
		await postEntries([
			makeLogBody({ session: sessionId, timestamp: "2026-06-14T10:00:00.000Z", tag: "oldest" }),
			makeLogBody({ session: sessionId, timestamp: "2026-06-14T11:00:00.000Z", tag: "middle" }),
			makeLogBody({ session: sessionId, timestamp: "2026-06-14T12:00:00.000Z", tag: "newest" }),
		]);

		const tool = createLogsTool(deps);
		const result = await tool.execute("call-1", {}, undefined, undefined, makeCtx());

		const text = result.content[0].text;
		// Newest should appear before middle, middle before oldest
		const newestIdx = text.indexOf("newest");
		const middleIdx = text.indexOf("middle");
		const oldestIdx = text.indexOf("oldest");
		expect(newestIdx).toBeLessThan(middleIdx);
		expect(middleIdx).toBeLessThan(oldestIdx);
	});
});
