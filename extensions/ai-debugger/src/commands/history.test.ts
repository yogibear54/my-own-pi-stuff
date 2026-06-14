/**
 * Tests for the /debug history command.
 *
 * Strategy:
 * - Pure functions (formatStatus, formatDate, formatIterations, truncateDescription,
 *   filterPastSessions, formatHistoryRow, buildHistoryNotification) are tested directly
 * - The command handler is trivial (list → notify), so testing the pure functions
 *   covers the core logic
 *
 * Per TODO verifies:
 * - No sessions → "No debug sessions found."
 * - Multiple sessions → formatted list with correct statuses
 */

import { describe, it, expect } from "vitest";
import {
	formatStatus,
	formatDate,
	formatIterations,
	truncateDescription,
	filterPastSessions,
	formatHistoryRow,
	buildHistoryNotification,
} from "./history.js";
import type { DebugSession } from "../types.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<DebugSession> = {}): DebugSession {
	return {
		id: "abc12345",
		description: "checkout crash",
		status: "completed",
		phase: "cleanup",
		iteration: 2,
		maxIterations: 5,
		createdAt: new Date("2026-06-11T14:32:00").getTime(),
		updatedAt: Date.now(),
		hypotheses: [],
		instrumentedFiles: [],
		fixes: [],
		logCount: 0,
		...overrides,
	};
}

// ── formatStatus ───────────────────────────────────────────────────────────

describe("formatStatus", () => {
	it("formats completed with ✅", () => {
		expect(formatStatus("completed")).toBe("✅ completed");
	});

	it("formats aborted with ❌", () => {
		expect(formatStatus("aborted")).toBe("❌ aborted");
	});

	it("formats active with 🔵", () => {
		expect(formatStatus("active")).toBe("🔵 active");
	});
});

// ── formatDate ─────────────────────────────────────────────────────────────

describe("formatDate", () => {
	it("formats as Mon DD HH:MM", () => {
		const ts = new Date("2026-06-11T14:32:00").getTime();
		const result = formatDate(ts);
		expect(result).toBe("Jun 11 14:32");
	});

	it("formats different months", () => {
		const ts = new Date("2026-01-05T09:15:00").getTime();
		expect(formatDate(ts)).toBe("Jan 05 09:15");
	});

	it("pads day and time with leading zeros", () => {
		const ts = new Date("2026-06-01T09:05:00").getTime();
		expect(formatDate(ts)).toBe("Jun 01 09:05");
	});

	it("returns '?' for invalid timestamp", () => {
		expect(formatDate(NaN)).toBe("?");
		expect(formatDate(0)).toBe("?");
	});
});

// ── formatIterations ───────────────────────────────────────────────────────

describe("formatIterations", () => {
	it("uses singular for 1", () => {
		expect(formatIterations(1)).toBe("1 iteration");
	});

	it("uses plural for 2", () => {
		expect(formatIterations(2)).toBe("2 iterations");
	});

	it("uses plural for 0", () => {
		expect(formatIterations(0)).toBe("0 iterations");
	});
});

// ── truncateDescription ────────────────────────────────────────────────────

describe("truncateDescription", () => {
	it("returns short strings unchanged", () => {
		expect(truncateDescription("short")).toBe("short");
	});

	it("returns exactly max-length strings unchanged", () => {
		const exact = "a".repeat(30);
		expect(truncateDescription(exact)).toBe(exact);
	});

	it("truncates long strings with ellipsis", () => {
		const long = "a".repeat(40);
		const result = truncateDescription(long);
		expect(result).toHaveLength(30);
		expect(result).toBe("a".repeat(29) + "…");
	});

	it("respects custom max length", () => {
		expect(truncateDescription("abcdefghij", 5)).toBe("abcd…");
	});
});

// ── filterPastSessions ─────────────────────────────────────────────────────

describe("filterPastSessions", () => {
	it("includes completed sessions", () => {
		const sessions = [makeSession({ status: "completed" })];
		expect(filterPastSessions(sessions)).toHaveLength(1);
	});

	it("includes aborted sessions", () => {
		const sessions = [makeSession({ status: "aborted" })];
		expect(filterPastSessions(sessions)).toHaveLength(1);
	});

	it("excludes active sessions", () => {
		const sessions = [
			makeSession({ id: "1", status: "completed" }),
			makeSession({ id: "2", status: "active" }),
			makeSession({ id: "3", status: "aborted" }),
		];
		const past = filterPastSessions(sessions);
		expect(past).toHaveLength(2);
		expect(past.map((s) => s.id)).toEqual(["1", "3"]);
	});

	it("returns empty array when only active sessions", () => {
		const sessions = [makeSession({ status: "active" })];
		expect(filterPastSessions(sessions)).toEqual([]);
	});

	it("returns empty array for no sessions", () => {
		expect(filterPastSessions([])).toEqual([]);
	});
});

// ── formatHistoryRow ───────────────────────────────────────────────────────

describe("formatHistoryRow", () => {
	it("formats a complete row with all fields", () => {
		const session = makeSession();
		const result = formatHistoryRow(session);
		// Format: id │ status │ description │ iterations │ date
		expect(result).toContain("abc12345");
		expect(result).toContain("✅ completed");
		expect(result).toContain("checkout crash");
		expect(result).toContain("2 iterations");
		expect(result).toContain("Jun 11 14:32");
	});

	it("uses │ as field separator", () => {
		const result = formatHistoryRow(makeSession());
		const separators = (result.match(/│/g) ?? []).length;
		expect(separators).toBe(4); // 5 fields = 4 separators
	});

	it("handles empty description", () => {
		const result = formatHistoryRow(makeSession({ description: "" }));
		expect(result).toContain("(no description)");
	});

	it("shows ❌ for aborted sessions", () => {
		const result = formatHistoryRow(makeSession({ status: "aborted" }));
		expect(result).toContain("❌ aborted");
	});

	it("matches the TODO example structure", () => {
		const session1 = makeSession({
			id: "abc123",
			description: "checkout crash",
			status: "completed",
			iteration: 2,
			createdAt: new Date("2026-06-11T14:32:00").getTime(),
		});
		const session2 = makeSession({
			id: "def456",
			description: "login redirect loop",
			status: "aborted",
			iteration: 1,
			createdAt: new Date("2026-06-10T09:15:00").getTime(),
		});
		const line1 = formatHistoryRow(session1);
		const line2 = formatHistoryRow(session2);

		expect(line1).toContain("abc123");
		expect(line1).toContain("✅ completed");
		expect(line1).toContain("checkout crash");
		expect(line1).toContain("2 iterations");
		expect(line1).toContain("Jun 11 14:32");

		expect(line2).toContain("def456");
		expect(line2).toContain("❌ aborted");
		expect(line2).toContain("login redirect loop");
		expect(line2).toContain("1 iteration");
		expect(line2).toContain("Jun 10 09:15");
	});
});

// ── buildHistoryNotification ───────────────────────────────────────────────

describe("buildHistoryNotification", () => {
	it("returns 'No debug sessions found.' for no sessions", () => {
		expect(buildHistoryNotification([])).toBe("No debug sessions found.");
	});

	it("returns 'No debug sessions found.' when only active session exists", () => {
		const sessions = [makeSession({ status: "active" })];
		expect(buildHistoryNotification(sessions)).toBe("No debug sessions found.");
	});

	it("includes header with count", () => {
		const sessions = [
			makeSession({ id: "1", status: "completed" }),
			makeSession({ id: "2", status: "aborted" }),
		];
		const result = buildHistoryNotification(sessions);
		expect(result).toContain("📋");
		expect(result).toContain("2 sessions");
	});

	it("uses singular 'session' for one past session", () => {
		const result = buildHistoryNotification([makeSession({ status: "completed" })]);
		expect(result).toContain("1 session");
	});

	it("includes each past session as a row", () => {
		const sessions = [
			makeSession({ id: "abc123", status: "completed", description: "bug one" }),
			makeSession({ id: "def456", status: "aborted", description: "bug two" }),
		];
		const result = buildHistoryNotification(sessions);
		expect(result).toContain("abc123");
		expect(result).toContain("bug one");
		expect(result).toContain("def456");
		expect(result).toContain("bug two");
	});

	it("excludes active session from output", () => {
		const sessions = [
			makeSession({ id: "past", status: "completed", description: "done" }),
			makeSession({ id: "current", status: "active", description: "ongoing" }),
		];
		const result = buildHistoryNotification(sessions);
		expect(result).toContain("past");
		expect(result).toContain("done");
		expect(result).not.toContain("current");
		expect(result).not.toContain("ongoing");
	});

	it("shows correct count excluding active session", () => {
		const sessions = [
			makeSession({ id: "1", status: "completed" }),
			makeSession({ id: "2", status: "aborted" }),
			makeSession({ id: "3", status: "active" }),
		];
		const result = buildHistoryNotification(sessions);
		expect(result).toContain("2 sessions"); // not 3
	});

	it("matches the TODO example format", () => {
		const sessions = [
			makeSession({
				id: "abc123",
				description: "checkout crash",
				status: "completed",
				iteration: 2,
				createdAt: new Date("2026-06-11T14:32:00").getTime(),
			}),
			makeSession({
				id: "def456",
				description: "login redirect loop",
				status: "aborted",
				iteration: 1,
				createdAt: new Date("2026-06-10T09:15:00").getTime(),
			}),
		];
		const result = buildHistoryNotification(sessions);
		const lines = result.split("\n");
		expect(lines[0]).toContain("📋");
		expect(lines[1]).toContain("abc123");
		expect(lines[1]).toContain("✅ completed");
		expect(lines[2]).toContain("def456");
		expect(lines[2]).toContain("❌ aborted");
	});
});
