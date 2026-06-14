/**
 * Tests for the /debug status command.
 *
 * Strategy:
 * - Pure functions (formatPhase, summarizeHypotheses, buildStatusNotification)
 *   are tested directly
 * - The command handler is trivial (get session, call function, notify), so
 *   testing the pure functions covers the core logic
 *
 * Per TODO verifies:
 * - No session → "no active session" message (verified via handler logic)
 * - Active session → readable status output
 */

import { describe, it, expect } from "vitest";
import { formatPhase, summarizeHypotheses, buildStatusNotification } from "./status.js";
import type { DebugSession, Hypothesis } from "../types.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<DebugSession> = {}): DebugSession {
	return {
		id: "abc12345",
		description: "Checkout crashes with 3 items",
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

function makeHypothesis(overrides: Partial<Hypothesis> = {}): Hypothesis {
	return {
		id: 1,
		description: "Test hypothesis",
		confidence: "high",
		files: ["src/cart.ts"],
		instrumentationPlan: [],
		status: "pending",
		...overrides,
	};
}

// ── formatPhase ────────────────────────────────────────────────────────────

describe("formatPhase", () => {
	it("returns emoji + label for understand", () => {
		expect(formatPhase("understand")).toBe("🔍 Understanding");
	});

	it("returns emoji + label for hypothesize", () => {
		expect(formatPhase("hypothesize")).toBe("💡 Hypothesizing");
	});

	it("returns emoji + label for instrument", () => {
		expect(formatPhase("instrument")).toBe("🔧 Instrumenting");
	});

	it("returns emoji + label for observe", () => {
		expect(formatPhase("observe")).toBe("⚡ Observing");
	});

	it("returns emoji + label for fix", () => {
		expect(formatPhase("fix")).toBe("🛠 Fixing");
	});

	it("returns emoji + label for verify", () => {
		expect(formatPhase("verify")).toBe("✅ Verifying");
	});

	it("returns emoji + label for cleanup", () => {
		expect(formatPhase("cleanup")).toBe("🧹 Cleaning up");
	});

	it("every phase has a non-empty emoji and label", () => {
		const phases: DebugSession["phase"][] = [
			"understand", "hypothesize", "instrument", "observe", "fix", "verify", "cleanup",
		];
		for (const phase of phases) {
			const result = formatPhase(phase);
			expect(result.length).toBeGreaterThan(2); // emoji + space + at least 1 char
			expect(result).toContain(" ");
		}
	});
});

// ── summarizeHypotheses ───────────────────────────────────────────────────

describe("summarizeHypotheses", () => {
	it("returns 'none yet' message when no hypotheses", () => {
		const session = makeSession({ hypotheses: [] });
		expect(summarizeHypotheses(session)).toBe("0 (none yet — call debug_hypothesize)");
	});

	it("shows total with no breakdown when all pending", () => {
		const session = makeSession({
			hypotheses: [
				makeHypothesis({ id: 1, status: "pending" }),
				makeHypothesis({ id: 2, status: "pending" }),
			],
		});
		expect(summarizeHypotheses(session)).toBe("2");
	});

	it("lists instrumented count in breakdown", () => {
		const session = makeSession({
			hypotheses: [
				makeHypothesis({ id: 1, status: "instrumented" }),
				makeHypothesis({ id: 2, status: "pending" }),
			],
		});
		expect(summarizeHypotheses(session)).toBe("2 (1 instrumented)");
	});

	it("lists confirmed count in breakdown", () => {
		const session = makeSession({
			hypotheses: [
				makeHypothesis({ id: 1, status: "confirmed" }),
			],
		});
		expect(summarizeHypotheses(session)).toBe("1 (1 confirmed)");
	});

	it("lists ruled_out count in breakdown", () => {
		const session = makeSession({
			hypotheses: [
				makeHypothesis({ id: 1, status: "ruled_out" }),
			],
		});
		expect(summarizeHypotheses(session)).toBe("1 (1 ruled_out)");
	});

	it("lists multiple statuses in canonical order (instrumented, confirmed, ruled_out)", () => {
		const session = makeSession({
			hypotheses: [
				makeHypothesis({ id: 1, status: "ruled_out" }),
				makeHypothesis({ id: 2, status: "confirmed" }),
				makeHypothesis({ id: 3, status: "instrumented" }),
				makeHypothesis({ id: 4, status: "pending" }),
			],
		});
		expect(summarizeHypotheses(session)).toBe("4 (1 instrumented, 1 confirmed, 1 ruled_out)");
	});

	it("matches the TODO example format", () => {
		// TODO example: "3 (1 instrumented, 1 confirmed, 1 ruled_out)"
		const session = makeSession({
			hypotheses: [
				makeHypothesis({ id: 1, status: "instrumented" }),
				makeHypothesis({ id: 2, status: "confirmed" }),
				makeHypothesis({ id: 3, status: "ruled_out" }),
			],
		});
		expect(summarizeHypotheses(session)).toBe("3 (1 instrumented, 1 confirmed, 1 ruled_out)");
	});
});

// ── buildStatusNotification ────────────────────────────────────────────────

describe("buildStatusNotification", () => {
	it("includes session ID, phase emoji, and iteration on line 1", () => {
		const session = makeSession({ phase: "observe", iteration: 2 });
		const result = buildStatusNotification(session);
		const lines = result.split("\n");
		expect(lines[0]).toContain("abc12345");
		expect(lines[0]).toContain("⚡ Observing");
		expect(lines[0]).toContain("iteration 2/5");
	});

	it("includes hypotheses summary on line 2", () => {
		const session = makeSession({
			hypotheses: [makeHypothesis({ status: "instrumented" })],
		});
		const result = buildStatusNotification(session);
		const lines = result.split("\n");
		expect(lines[1]).toContain("Hypotheses:");
		expect(lines[1]).toContain("1 instrumented");
	});

	it("includes files instrumented and logs received on line 3", () => {
		const session = makeSession({
			instrumentedFiles: [
				{ path: "a.ts", originalContent: "", changes: [] },
				{ path: "b.ts", originalContent: "", changes: [] },
			],
			logCount: 47,
		});
		const result = buildStatusNotification(session);
		const lines = result.split("\n");
		expect(lines[2]).toContain("Files: 2 instrumented");
		expect(lines[2]).toContain("Logs: 47 received");
	});

	it("includes fixes count when fixes exist", () => {
		const session = makeSession({
			fixes: [
				{ iteration: 1, hypothesisId: 1, files: [], verified: false },
			],
		});
		const result = buildStatusNotification(session);
		expect(result).toContain("Fixes: 1 applied");
	});

	it("omits fixes line when no fixes applied", () => {
		const session = makeSession({ fixes: [] });
		const result = buildStatusNotification(session);
		expect(result).not.toContain("Fixes:");
	});

	it("matches the TODO example output format", () => {
		const session = makeSession({
			id: "abc123",
			phase: "observe",
			iteration: 2,
			maxIterations: 5,
			hypotheses: [
				makeHypothesis({ id: 1, status: "instrumented" }),
				makeHypothesis({ id: 2, status: "confirmed" }),
				makeHypothesis({ id: 3, status: "ruled_out" }),
			],
			instrumentedFiles: [
				{ path: "a", originalContent: "", changes: [] },
				{ path: "b", originalContent: "", changes: [] },
				{ path: "c", originalContent: "", changes: [] },
				{ path: "d", originalContent: "", changes: [] },
			],
			logCount: 47,
		});
		const result = buildStatusNotification(session);
		// Should match the structure of the TODO example
		expect(result).toContain("🐛 debug:abc123");
		expect(result).toContain("⚡ Observing");
		expect(result).toContain("iteration 2/5");
		expect(result).toContain("Hypotheses: 3 (1 instrumented, 1 confirmed, 1 ruled_out)");
		expect(result).toContain("Files: 4 instrumented");
		expect(result).toContain("Logs: 47 received");
	});

	it("produces exactly 3 lines", () => {
		const session = makeSession();
		const lines = buildStatusNotification(session).split("\n");
		expect(lines).toHaveLength(3);
	});

	it("handles fresh session (no hypotheses, files, logs, fixes)", () => {
		const session = makeSession({
			phase: "understand",
			iteration: 1,
			hypotheses: [],
			instrumentedFiles: [],
			fixes: [],
			logCount: 0,
		});
		const result = buildStatusNotification(session);
		expect(result).toContain("🔍 Understanding");
		expect(result).toContain("iteration 1/5");
		expect(result).toContain("Hypotheses: 0 (none yet");
		expect(result).toContain("Files: 0 instrumented");
		expect(result).toContain("Logs: 0 received");
		expect(result).not.toContain("Fixes:");
	});

	it("reflects different phases correctly", () => {
		for (const phase of ["hypothesize", "instrument", "fix", "verify"] as DebugSession["phase"][]) {
			const session = makeSession({ phase });
			const result = buildStatusNotification(session);
			expect(result).toContain(formatPhase(phase));
		}
	});
});
