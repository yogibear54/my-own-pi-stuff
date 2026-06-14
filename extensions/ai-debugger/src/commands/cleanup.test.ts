/**
 * Tests for the /debug cleanup command formatting functions.
 *
 * Strategy:
 * - Pure functions (buildCleanupConfirmationTitle, buildCleanupConfirmationMessage,
 *   buildCleanupNotification) are tested directly
 * - The command handler flow (confirm, cleanup, notify, clear widget) is tested
 *   via performCleanup's existing 41 tests in tools/cleanup.test.ts
 *
 * Per TODO verifies:
 * - No session → "no active session" message (handler logic)
 * - Confirm yes → files cleaned, collector stopped, widget cleared (handler logic)
 * - Confirm no → no-op (handler logic)
 */

import { describe, it, expect } from "vitest";
import {
	buildCleanupConfirmationTitle,
	buildCleanupConfirmationMessage,
	buildCleanupNotification,
} from "./cleanup.js";
import type { CleanupSummary } from "../tools/cleanup.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSummary(overrides: Partial<CleanupSummary> = {}): CleanupSummary {
	return {
		sessionId: "abc12345",
		files: [
			{ file: "src/cart.ts", cleaned: true, blocksRemoved: 2 },
			{ file: "src/checkout.ts", cleaned: true, blocksRemoved: 1 },
		],
		totalBlocksRemoved: 3,
		logsCollected: 47,
		fixCount: 1,
		fixFiles: ["src/cart.ts"],
		durationMs: 95000,
		...overrides,
	};
}

// ── buildCleanupConfirmationTitle ──────────────────────────────────────────

describe("buildCleanupConfirmationTitle", () => {
	it("includes the session ID", () => {
		expect(buildCleanupConfirmationTitle("abc123")).toBe("Clean up instrumentation from session abc123?");
	});

	it("includes a question mark", () => {
		expect(buildCleanupConfirmationTitle("xyz")).toContain("?");
	});
});

// ── buildCleanupConfirmationMessage ────────────────────────────────────────

describe("buildCleanupConfirmationMessage", () => {
	it("explains that debug logging is removed", () => {
		expect(buildCleanupConfirmationMessage()).toContain("removes all debug logging");
	});

	it("explains that fixes are kept", () => {
		expect(buildCleanupConfirmationMessage()).toContain("keeps any applied fixes");
	});
});

// ── buildCleanupNotification ───────────────────────────────────────────────

describe("buildCleanupNotification", () => {
	it("includes ✅ emoji", () => {
		const result = buildCleanupNotification(makeSummary());
		expect(result).toContain("✅");
	});

	it("includes file count", () => {
		const result = buildCleanupNotification(makeSummary());
		expect(result).toContain("Cleaned up 2 files");
	});

	it("includes session ID", () => {
		const result = buildCleanupNotification(makeSummary());
		expect(result).toContain("abc12345");
	});

	it("says 'completed'", () => {
		const result = buildCleanupNotification(makeSummary());
		expect(result).toContain("completed");
	});

	it("uses singular 'file' for one cleaned file", () => {
		const result = buildCleanupNotification(makeSummary({
			files: [{ file: "src/cart.ts", cleaned: true, blocksRemoved: 1 }],
			totalBlocksRemoved: 1,
		}));
		expect(result).toContain("Cleaned up 1 file");
		expect(result).not.toContain("1 files");
	});

	it("includes blocks removed count", () => {
		const result = buildCleanupNotification(makeSummary({ totalBlocksRemoved: 5 }));
		expect(result).toContain("Removed 5 instrumentation blocks");
	});

	it("uses singular 'block' for one block removed", () => {
		const result = buildCleanupNotification(makeSummary({
			files: [{ file: "src/cart.ts", cleaned: true, blocksRemoved: 1 }],
			totalBlocksRemoved: 1,
		}));
		expect(result).toContain("1 instrumentation block");
		expect(result).not.toContain("1 instrumentation blocks");
	});

	it("includes fixes retained count when fixes exist", () => {
		const result = buildCleanupNotification(makeSummary({ fixCount: 2 }));
		expect(result).toContain("Fixes retained: 2");
	});

	it("omits fixes line when no fixes", () => {
		const result = buildCleanupNotification(makeSummary({ fixCount: 0 }));
		expect(result).not.toContain("Fixes retained");
	});

	it("warns about skipped files", () => {
		const result = buildCleanupNotification(makeSummary({
			files: [
				{ file: "a.ts", cleaned: true, blocksRemoved: 1 },
				{ file: "b.ts", cleaned: false, blocksRemoved: 0, skipped: "not found" },
			],
		}));
		expect(result).toContain("⚠");
		expect(result).toContain("1 file skipped");
	});

	it("uses singular 'file skipped' for one skipped", () => {
		const result = buildCleanupNotification(makeSummary({
			files: [
				{ file: "a.ts", cleaned: true, blocksRemoved: 1 },
				{ file: "b.ts", cleaned: false, blocksRemoved: 0, skipped: "not found" },
			],
		}));
		expect(result).toContain("1 file skipped");
		expect(result).not.toContain("1 files skipped");
	});

	it("uses plural 'files skipped' for multiple skipped", () => {
		const result = buildCleanupNotification(makeSummary({
			files: [
				{ file: "a.ts", cleaned: true, blocksRemoved: 1 },
				{ file: "b.ts", cleaned: false, blocksRemoved: 0, skipped: "not found" },
				{ file: "c.ts", cleaned: false, blocksRemoved: 0, skipped: "already clean" },
			],
		}));
		expect(result).toContain("2 files skipped");
	});

	it("omits skipped warning when all files cleaned", () => {
		const result = buildCleanupNotification(makeSummary());
		expect(result).not.toContain("⚠");
		expect(result).not.toContain("skipped");
	});

	it("matches TODO example format for a clean run", () => {
		const result = buildCleanupNotification(makeSummary({
			files: [{ file: "src/cart.ts", cleaned: true, blocksRemoved: 2 }],
			totalBlocksRemoved: 2,
			fixCount: 1,
		}));
		// First line matches: "✅ Cleaned up {N} files. Session {id} completed."
		const firstLine = result.split("\n")[0];
		expect(firstLine).toBe("✅ Cleaned up 1 file. Session abc12345 completed.");
	});

	it("handles no-instrumentation cleanup (0 files, 0 blocks)", () => {
		const result = buildCleanupNotification(makeSummary({
			files: [],
			totalBlocksRemoved: 0,
			fixCount: 0,
		}));
		expect(result).toContain("Cleaned up 0 files");
		expect(result).not.toContain("Removed");
		expect(result).not.toContain("Fixes retained");
	});
});
