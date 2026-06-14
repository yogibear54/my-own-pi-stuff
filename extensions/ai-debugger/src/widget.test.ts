/**
 * Tests for the debug session widget.
 *
 * Strategy:
 * - Pure functions (levelToColor, formatWidgetTime, formatWidgetData,
 *   buildWidgetHeader, formatWidgetLogLine, buildEmptyStateLines, buildFeedLines,
 *   buildSummaryLines) are tested directly
 * - DebugWidgetManager class is tested for state transitions:
 *   attach → onLog → showSummary → clear
 *
 * Per TODO verifies:
 * - Widget shows header + empty state at session start
 * - Logs stream in → widget updates in real-time
 * - Session completes → summary shown → widget cleared
 */

import { describe, it, expect } from "vitest";
import {
	DebugWidgetManager,
	MAX_FEED_ENTRIES,
	levelToColor,
	formatWidgetTime,
	formatWidgetData,
	buildWidgetHeader,
	formatWidgetLogLine,
	buildEmptyStateLines,
	buildFeedLines,
	buildSummaryLines,
} from "./widget.js";
import type { RenderLine, CompletionSummary } from "./widget.js";
import type { DebugLogEntry, DebugSession } from "./types.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<DebugSession> = {}): DebugSession {
	return {
		id: "abc12345",
		description: "checkout crash",
		status: "active",
		phase: "observe",
		iteration: 2,
		maxIterations: 5,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		hypotheses: [],
		instrumentedFiles: [],
		fixes: [],
		logCount: 0,
		...overrides,
	};
}

function makeEntry(overrides: Partial<DebugLogEntry> = {}): DebugLogEntry {
	return {
		timestamp: "2026-06-14T12:04:32.123Z",
		session: "abc12345",
		hypothesis: 1,
		file: "src/cart.ts",
		line: 42,
		level: "info",
		tag: "cart_state",
		data: { items: 3, total: 49.99 },
		...overrides,
	};
}

function makeSummary(overrides: Partial<CompletionSummary> = {}): CompletionSummary {
	return {
		sessionId: "abc12345",
		status: "completed",
		filesCleaned: 3,
		logsCollected: 47,
		fixCount: 1,
		...overrides,
	};
}

// ── levelToColor ──────────────────────────────────────────────────────────

describe("levelToColor", () => {
	it("returns undefined for info (default color)", () => {
		expect(levelToColor("info")).toBeUndefined();
	});

	it("returns 'warning' for warn", () => {
		expect(levelToColor("warn")).toBe("warning");
	});

	it("returns 'error' for error", () => {
		expect(levelToColor("error")).toBe("error");
	});

	it("returns 'dim' for debug", () => {
		expect(levelToColor("debug")).toBe("dim");
	});
});

// ── formatWidgetTime ───────────────────────────────────────────────────────

describe("formatWidgetTime", () => {
	it("formats as HH:MM:SS.mmm", () => {
		const result = formatWidgetTime("2026-06-14T12:04:32.123Z");
		expect(result).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
	});

	it("includes milliseconds", () => {
		const result = formatWidgetTime("2026-06-14T12:04:32.999Z");
		expect(result).toContain(".999");
	});

	it("returns placeholder for invalid timestamp", () => {
		expect(formatWidgetTime("not-a-date")).toBe("??:??:??.???");
	});
});

// ── formatWidgetData ───────────────────────────────────────────────────────

describe("formatWidgetData", () => {
	it("formats key=value pairs", () => {
		expect(formatWidgetData({ items: 3, total: 49.99 })).toBe("items=3 total=49.99");
	});

	it("JSON-stringifies nested objects", () => {
		expect(formatWidgetData({ user: { name: "alice" } })).toBe('user={"name":"alice"}');
	});

	it("returns empty string for no data", () => {
		expect(formatWidgetData({})).toBe("");
	});
});

// ── buildWidgetHeader ──────────────────────────────────────────────────────

describe("buildWidgetHeader", () => {
	it("includes session ID, phase, iteration, and log count", () => {
		const header = buildWidgetHeader(makeSession({ logCount: 47 }));
		expect(header).toContain("abc12345");
		expect(header).toContain("observe");
		expect(header).toContain("iteration 2/5");
		expect(header).toContain("47 logs");
	});

	it("includes the bug emoji", () => {
		expect(buildWidgetHeader(makeSession())).toContain("🐛");
	});

	it("updates with different phases", () => {
		expect(buildWidgetHeader(makeSession({ phase: "fix" }))).toContain("fix");
		expect(buildWidgetHeader(makeSession({ phase: "verify" }))).toContain("verify");
	});
});

// ── formatWidgetLogLine ────────────────────────────────────────────────────

describe("formatWidgetLogLine", () => {
	it("formats time, level, hypothesis, tag, and data", () => {
		const result = formatWidgetLogLine(makeEntry());
		expect(result).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3} /);
		expect(result).toContain("info");
		expect(result).toContain("[h1]");
		expect(result).toContain("cart_state");
		expect(result).toContain("items=3");
		expect(result).toContain("total=49.99");
	});

	it("includes milliseconds in time", () => {
		const result = formatWidgetLogLine(makeEntry({ timestamp: "2026-06-14T12:04:32.456Z" }));
		expect(result).toContain(".456");
	});
});

// ── buildEmptyStateLines ───────────────────────────────────────────────────

describe("buildEmptyStateLines", () => {
	it("includes header, separator, and waiting message", () => {
		const lines = buildEmptyStateLines(makeSession());
		expect(lines).toHaveLength(3);
		expect(lines[0].text).toContain("🐛");
		expect(lines[1].text).toContain("─");
		expect(lines[2].text).toContain("⏳");
		expect(lines[2].text).toContain("Waiting for logs");
	});

	it("waiting message mentions reproducing the bug", () => {
		const lines = buildEmptyStateLines(makeSession());
		expect(lines[2].text).toContain("reproduce");
	});

	it("separator has borderMuted color", () => {
		const lines = buildEmptyStateLines(makeSession());
		expect(lines[1].color).toBe("borderMuted");
	});

	it("waiting message has dim color", () => {
		const lines = buildEmptyStateLines(makeSession());
		expect(lines[2].color).toBe("dim");
	});
});

// ── buildFeedLines ─────────────────────────────────────────────────────────

describe("buildFeedLines", () => {
	it("includes header, separator, and log lines", () => {
		const entries = [makeEntry(), makeEntry({ tag: "second" })];
		const lines = buildFeedLines(makeSession(), entries);
		expect(lines).toHaveLength(4); // header + separator + 2 logs
		expect(lines[0].text).toContain("🐛");
		expect(lines[2].text).toContain("cart_state");
		expect(lines[3].text).toContain("second");
	});

	it("applies level-based colors to log lines", () => {
		const entries = [
			makeEntry({ level: "info" }),
			makeEntry({ level: "warn" }),
			makeEntry({ level: "error" }),
			makeEntry({ level: "debug" }),
		];
		const lines = buildFeedLines(makeSession(), entries);
		// lines[2..5] are log lines (after header + separator)
		expect(lines[2].color).toBeUndefined(); // info = default
		expect(lines[3].color).toBe("warning");
		expect(lines[4].color).toBe("error");
		expect(lines[5].color).toBe("dim");
	});

	it("header has no color (default)", () => {
		const lines = buildFeedLines(makeSession(), [makeEntry()]);
		expect(lines[0].color).toBeUndefined();
	});
});

// ── buildSummaryLines ──────────────────────────────────────────────────────

describe("buildSummaryLines", () => {
	it("shows ✅ for completed sessions", () => {
		const lines = buildSummaryLines(makeSummary({ status: "completed" }));
		expect(lines[0].text).toContain("✅");
		expect(lines[0].text).toContain("completed");
	});

	it("shows ❌ for aborted sessions", () => {
		const lines = buildSummaryLines(makeSummary({ status: "aborted" }));
		expect(lines[0].text).toContain("❌");
		expect(lines[0].text).toContain("aborted");
	});

	it("includes session ID", () => {
		const lines = buildSummaryLines(makeSummary());
		expect(lines[0].text).toContain("abc12345");
	});

	it("includes files cleaned, logs collected, and fix count", () => {
		const lines = buildSummaryLines(makeSummary());
		expect(lines[1].text).toContain("3 file(s)");
		expect(lines[1].text).toContain("47 logs");
		expect(lines[1].text).toContain("1 fix");
	});

	it("uses success color for completed", () => {
		const lines = buildSummaryLines(makeSummary({ status: "completed" }));
		expect(lines[0].color).toBe("success");
	});

	it("uses error color for aborted", () => {
		const lines = buildSummaryLines(makeSummary({ status: "aborted" }));
		expect(lines[0].color).toBe("error");
	});
});

// ── DebugWidgetManager ─────────────────────────────────────────────────────

describe("DebugWidgetManager", () => {
	describe("attach", () => {
		it("shows empty state when no logs", () => {
			const mgr = new DebugWidgetManager();
			mgr.attach(makeSession());
			const lines = mgr.getLines();
			expect(lines.some((l) => l.text.includes("Waiting for logs"))).toBe(true);
		});

		it("includes header with session info", () => {
			const mgr = new DebugWidgetManager();
			mgr.attach(makeSession({ id: "test123", phase: "observe" }));
			const lines = mgr.getLines();
			expect(lines[0].text).toContain("test123");
			expect(lines[0].text).toContain("observe");
		});

		it("resets logs on attach", () => {
			const mgr = new DebugWidgetManager();
			mgr.attach(makeSession());
			mgr.onLog(makeEntry());
			expect(mgr.getLines()).toHaveLength(3); // header + sep + 1 log

			mgr.attach(makeSession());
			expect(mgr.getLines()).toHaveLength(3); // back to empty state
		});
	});

	describe("onLog", () => {
		it("adds logs to the feed", () => {
			const mgr = new DebugWidgetManager();
			mgr.attach(makeSession());
			mgr.onLog(makeEntry({ tag: "first" }));
			mgr.onLog(makeEntry({ tag: "second" }));
			const lines = mgr.getLines();
			expect(lines).toHaveLength(4); // header + sep + 2 logs
			expect(lines[2].text).toContain("first");
			expect(lines[3].text).toContain("second");
		});

		it(`caps feed at ${MAX_FEED_ENTRIES} entries`, () => {
			const mgr = new DebugWidgetManager();
			mgr.attach(makeSession());
			for (let i = 0; i < 20; i++) {
				mgr.onLog(makeEntry({ tag: `tag${i}` }));
			}
			const lines = mgr.getLines();
			// header + separator + MAX_FEED_ENTRIES
			expect(lines).toHaveLength(2 + MAX_FEED_ENTRIES);
			// Should show the most recent entries (tag12..tag19)
			expect(lines[lines.length - 1].text).toContain("tag19");
			expect(lines[2].text).toContain(`tag${20 - MAX_FEED_ENTRIES}`);
		});
	});

	describe("updateSession", () => {
		it("updates the header with new session data", () => {
			const mgr = new DebugWidgetManager();
			mgr.attach(makeSession({ logCount: 0 }));
			mgr.updateSession(makeSession({ logCount: 5 }));
			const lines = mgr.getLines();
			expect(lines[0].text).toContain("5 logs");
		});

		it("updates phase in header", () => {
			const mgr = new DebugWidgetManager();
			mgr.attach(makeSession({ phase: "observe" }));
			mgr.updateSession(makeSession({ phase: "fix" }));
			const lines = mgr.getLines();
			expect(lines[0].text).toContain("fix");
		});
	});

	describe("showSummary", () => {
		it("replaces feed with summary", () => {
			const mgr = new DebugWidgetManager();
			mgr.attach(makeSession());
			mgr.onLog(makeEntry());
			mgr.showSummary(makeSummary());
			const lines = mgr.getLines();
			expect(lines).toHaveLength(2); // summary lines
			expect(lines[0].text).toContain("✅");
		});

		it("shows aborted summary", () => {
			const mgr = new DebugWidgetManager();
			mgr.attach(makeSession());
			mgr.showSummary(makeSummary({ status: "aborted" }));
			const lines = mgr.getLines();
			expect(lines[0].text).toContain("❌");
		});
	});

	describe("clear", () => {
		it("returns empty lines after clear", () => {
			const mgr = new DebugWidgetManager();
			mgr.attach(makeSession());
			mgr.onLog(makeEntry());
			mgr.clear();
			expect(mgr.getLines()).toEqual([]);
		});

		it("hasSession is false after clear", () => {
			const mgr = new DebugWidgetManager();
			mgr.attach(makeSession());
			expect(mgr.hasSession).toBe(true);
			mgr.clear();
			expect(mgr.hasSession).toBe(false);
		});
	});

	describe("getLines", () => {
		it("returns empty array when no session attached", () => {
			const mgr = new DebugWidgetManager();
			expect(mgr.getLines()).toEqual([]);
		});

		it("returns empty state lines when session has no logs", () => {
			const mgr = new DebugWidgetManager();
			mgr.attach(makeSession());
			const lines = mgr.getLines();
			expect(lines).toHaveLength(3); // header + sep + waiting
		});

		it("returns feed lines when session has logs", () => {
			const mgr = new DebugWidgetManager();
			mgr.attach(makeSession());
			mgr.onLog(makeEntry());
			const lines = mgr.getLines();
			expect(lines).toHaveLength(3); // header + sep + 1 log
		});

		it("returns summary lines when summary is shown", () => {
			const mgr = new DebugWidgetManager();
			mgr.attach(makeSession());
			mgr.showSummary(makeSummary());
			const lines = mgr.getLines();
			expect(lines).toHaveLength(2); // summary
		});
	});

	describe("hasSession", () => {
		it("is false before attach", () => {
			const mgr = new DebugWidgetManager();
			expect(mgr.hasSession).toBe(false);
		});

		it("is true after attach", () => {
			const mgr = new DebugWidgetManager();
			mgr.attach(makeSession());
			expect(mgr.hasSession).toBe(true);
		});

		it("is false after clear", () => {
			const mgr = new DebugWidgetManager();
			mgr.attach(makeSession());
			mgr.clear();
			expect(mgr.hasSession).toBe(false);
		});
	});

	describe("full lifecycle", () => {
		it("attach → logs stream → summary → clear", () => {
			const mgr = new DebugWidgetManager();

			// 1. Start: empty state
			mgr.attach(makeSession({ logCount: 0 }));
			expect(mgr.getLines().some((l) => l.text.includes("Waiting"))).toBe(true);

			// 2. Logs stream in
			mgr.onLog(makeEntry({ tag: "log1" }));
			mgr.onLog(makeEntry({ tag: "log2" }));
			let lines = mgr.getLines();
			expect(lines.some((l) => l.text.includes("log1"))).toBe(true);
			expect(lines.some((l) => l.text.includes("log2"))).toBe(true);
			expect(lines.some((l) => l.text.includes("Waiting"))).toBe(false);

			// 3. Session completes → summary
			mgr.showSummary(makeSummary({ logsCollected: 2 }));
			lines = mgr.getLines();
			expect(lines.some((l) => l.text.includes("✅"))).toBe(true);
			expect(lines.some((l) => l.text.includes("2 logs"))).toBe(true);
			expect(lines.some((l) => l.text.includes("log1"))).toBe(false); // feed gone

			// 4. Clear
			mgr.clear();
			expect(mgr.getLines()).toEqual([]);
		});
	});
});
