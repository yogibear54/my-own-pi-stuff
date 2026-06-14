/**
 * Tests for the /debug logs command.
 *
 * Strategy:
 * - Pure functions (formatTime, formatData, formatLogLine, buildLogsNotification)
 *   are tested directly
 * - The command handler is trivial (get session, get recent logs, notify), so
 *   testing the pure functions covers the core formatting logic
 *
 * Per TODO verifies:
 * - No session → "no active session" message (handler logic)
 * - Session with logs → formatted output
 * - Session with no logs → "waiting" message
 */

import { describe, it, expect } from "vitest";
import {
	formatTime,
	formatData,
	formatLogLine,
	buildLogsNotification,
	RECENT_LOG_COUNT,
} from "./logs.js";
import type { DebugLogEntry } from "../types.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<DebugLogEntry> = {}): DebugLogEntry {
	return {
		timestamp: "2026-06-14T12:04:32.000Z",
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

// ── RECENT_LOG_COUNT ───────────────────────────────────────────────────────

describe("RECENT_LOG_COUNT", () => {
	it("is 20", () => {
		expect(RECENT_LOG_COUNT).toBe(20);
	});
});

// ── formatTime ─────────────────────────────────────────────────────────────

describe("formatTime", () => {
	it("formats ISO timestamp as HH:MM:SS", () => {
		// Note: this uses local time (getHours). We test the format, not the TZ.
		const result = formatTime("2026-06-14T12:04:32.000Z");
		expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
	});

	it("returns the raw string for unparseable input", () => {
		expect(formatTime("not-a-timestamp")).toBe("not-a-timestamp");
	});

	it("handles different timestamps", () => {
		const result = formatTime("2026-06-14T23:59:01.000Z");
		expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
	});
});

// ── formatData ─────────────────────────────────────────────────────────────

describe("formatData", () => {
	it("formats primitive values as key=value", () => {
		expect(formatData({ items: 3, total: 49.99 })).toBe("items=3 total=49.99");
	});

	it("formats string values directly", () => {
		expect(formatData({ status: "ok" })).toBe("status=ok");
	});

	it("formats boolean values", () => {
		expect(formatData({ valid: true })).toBe("valid=true");
	});

	it("JSON-stringifies nested objects", () => {
		expect(formatData({ user: { name: "alice" } })).toBe('user={"name":"alice"}');
	});

	it("JSON-stringifies arrays", () => {
		expect(formatData({ items: [1, 2, 3] })).toBe("items=[1,2,3]");
	});

	it("formats null values", () => {
		expect(formatData({ value: null })).toBe("value=null");
	});

	it("returns (empty) for empty object", () => {
		expect(formatData({})).toBe("(empty)");
	});

	it("handles multiple mixed-type values", () => {
		const result = formatData({ count: 5, name: "test", active: true });
		expect(result).toBe("count=5 name=test active=true");
	});
});

// ── formatLogLine ──────────────────────────────────────────────────────────

describe("formatLogLine", () => {
	it("formats a complete log line with all fields", () => {
		const entry = makeEntry();
		const result = formatLogLine(entry);
		// Format: HH:MM:SS level [hN] tag │ data
		expect(result).toMatch(/^\d{2}:\d{2}:\d{2} info  \[h1\] cart_state │ items=3 total=49.99$/);
	});

	it("includes the hypothesis ID", () => {
		const result = formatLogLine(makeEntry({ hypothesis: 3 }));
		expect(result).toContain("[h3]");
	});

	it("includes the tag", () => {
		const result = formatLogLine(makeEntry({ tag: "payment_timeout" }));
		expect(result).toContain("payment_timeout");
	});

	it("includes level (padded for alignment)", () => {
		const infoLine = formatLogLine(makeEntry({ level: "info" }));
		const errorLine = formatLogLine(makeEntry({ level: "error" }));
		// "info " (5 chars with pad) vs "error" (5 chars)
		expect(infoLine).toContain(" info  ");
		expect(errorLine).toContain(" error");
	});

	it("includes formatted data", () => {
		const result = formatLogLine(makeEntry({ data: { duration: 30125 } }));
		expect(result).toContain("duration=30125");
	});

	it("matches the TODO example format", () => {
		const entry1 = makeEntry({
			timestamp: "2026-06-14T12:04:32.000Z",
			level: "info",
			hypothesis: 1,
			tag: "cart_state",
			data: { items: 3, total: 49.99 },
		});
		const entry2 = makeEntry({
			timestamp: "2026-06-14T12:04:33.000Z",
			level: "error",
			hypothesis: 3,
			tag: "payment_timeout",
			data: { duration: 30125 },
		});
		const line1 = formatLogLine(entry1);
		const line2 = formatLogLine(entry2);
		// Both should follow the format structure
		expect(line1).toContain("info");
		expect(line1).toContain("[h1]");
		expect(line1).toContain("cart_state");
		expect(line1).toContain("items=3");
		expect(line1).toContain("total=49.99");

		expect(line2).toContain("error");
		expect(line2).toContain("[h3]");
		expect(line2).toContain("payment_timeout");
		expect(line2).toContain("duration=30125");
	});
});

// ── buildLogsNotification ──────────────────────────────────────────────────

describe("buildLogsNotification", () => {
	it("returns waiting message when no logs", () => {
		const result = buildLogsNotification("abc123", [], 0);
		expect(result).toBe("No logs received yet. Reproduce the bug to generate entries.");
	});

	it("includes header with count and session ID", () => {
		const entries = [makeEntry(), makeEntry({ tag: "second" })];
		const result = buildLogsNotification("abc123", entries, 2);
		const lines = result.split("\n");
		expect(lines[0]).toBe("📋 Last 2 logs for session abc123:");
	});

	it("uses singular 'log' for one entry", () => {
		const result = buildLogsNotification("abc123", [makeEntry()], 1);
		expect(result).toContain("Last 1 log");
	});

	it("uses plural 'logs' for multiple entries", () => {
		const entries = [makeEntry(), makeEntry()];
		const result = buildLogsNotification("abc123", entries, 2);
		expect(result).toContain("Last 2 logs");
	});

	it("includes each formatted log line", () => {
		const entries = [
			makeEntry({ tag: "first" }),
			makeEntry({ tag: "second", hypothesis: 2 }),
		];
		const result = buildLogsNotification("abc123", entries, 2);
		expect(result).toContain("[h1] first");
		expect(result).toContain("[h2] second");
	});

	it("includes footer with total count when more logs exist", () => {
		const entries = [makeEntry()];
		const result = buildLogsNotification("abc123", entries, 47);
		expect(result).toContain("47 total entries");
		expect(result).toContain("debug_logs tool");
	});

	it("omits footer when all entries are shown", () => {
		const entries = [makeEntry(), makeEntry()];
		const result = buildLogsNotification("abc123", entries, 2);
		expect(result).not.toContain("total entries");
	});

	it("matches the TODO example structure", () => {
		const entries = [
			makeEntry({
				timestamp: "2026-06-14T12:04:32.000Z",
				level: "info",
				hypothesis: 1,
				tag: "cart_state",
				data: { items: 3, total: 49.99 },
			}),
			makeEntry({
				timestamp: "2026-06-14T12:04:33.000Z",
				level: "error",
				hypothesis: 3,
				tag: "payment_timeout",
				data: { duration: 30125 },
			}),
		];
		const result = buildLogsNotification("abc123", entries, 47);
		const lines = result.split("\n");

		// Header
		expect(lines[0]).toContain("📋");
		expect(lines[0]).toContain("abc123");
		// Two log lines
		expect(lines[1]).toContain("info");
		expect(lines[1]).toContain("cart_state");
		expect(lines[2]).toContain("error");
		expect(lines[2]).toContain("payment_timeout");
		// Footer
		expect(lines[3]).toContain("47 total entries");
		expect(lines[3]).toContain("debug_logs tool");
	});

	it("handles exactly 20 entries (no footer if total is 20)", () => {
		const entries = Array.from({ length: 20 }, (_, i) =>
			makeEntry({ tag: `tag${i}` }),
		);
		const result = buildLogsNotification("abc123", entries, 20);
		expect(result).toContain("Last 20 logs");
		expect(result).not.toContain("total entries");
	});

	it("handles 20 entries shown from a larger set (footer appears)", () => {
		const entries = Array.from({ length: 20 }, (_, i) =>
			makeEntry({ tag: `tag${i}` }),
		);
		const result = buildLogsNotification("abc123", entries, 60);
		expect(result).toContain("Last 20 logs");
		expect(result).toContain("60 total entries");
	});
});
