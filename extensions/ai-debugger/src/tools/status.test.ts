/**
 * Tests for the debug_status tool.
 *
 * Strategy:
 * - Pure functions (formatHypothesisStatus, buildStatusResult, buildPhaseHint)
 *   are tested directly
 * - The execute function is tested with a real SessionStore in an isolated temp dir
 * - Tests verify: no session message, full state for active session across phases,
 *   structured details, hypotheses with statuses, fixes, confirmed hypothesis
 *
 * Per TODO verifies:
 * - No session → clear message
 * - Active session in `observe` phase → returns full state with all fields populated
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SessionStore } from "../session-store.js";
import { DEFAULTS } from "../config.js";
import {
	createStatusTool,
	formatHypothesisStatus,
	buildStatusResult,
	buildPhaseHint,
} from "./status.js";
import type { StatusToolDeps } from "./status.js";
import type { DebugSession, Hypothesis, SessionPhase } from "../types.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// ── Test isolation ─────────────────────────────────────────────────────────

let tmpDir: string;
let store: SessionStore;
let deps: StatusToolDeps;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-debugger-status-test-"));
	store = new SessionStore(tmpDir);
	deps = { store };
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────────────────────────────

function makeHypothesis(overrides: Partial<Hypothesis> = {}): Hypothesis {
	return {
		id: 1,
		description: "Race condition in cart.update()",
		confidence: "high",
		files: ["src/cart.ts"],
		instrumentationPlan: [],
		status: "pending",
		...overrides,
	};
}

/** Create an active session with realistic state and return it. */
function setupSession(opts: {
	phase?: SessionPhase;
	hypotheses?: Hypothesis[];
	addInstrumentation?: boolean;
	addFix?: boolean;
	logCount?: number;
	confirmedHypothesis?: number;
	iteration?: number;
} = {}): DebugSession {
	const session = store.create("Checkout crashes with 3 items", DEFAULTS.maxIterations);

	const updates: Partial<DebugSession> = {
		phase: opts.phase ?? "observe",
		iteration: opts.iteration ?? 2,
	};
	if (opts.hypotheses) updates.hypotheses = opts.hypotheses;
	if (opts.logCount !== undefined) updates.logCount = opts.logCount;
	if (opts.confirmedHypothesis !== undefined) updates.confirmedHypothesis = opts.confirmedHypothesis;
	store.update(session.id, updates);

	if (opts.addInstrumentation) {
		store.addInstrumentedFile(session.id, {
			path: "src/cart.ts",
			originalContent: "old",
			changes: [{ lineStart: 1, lineEnd: 3, hypothesisId: 1, marker: "// start" }],
		});
	}
	if (opts.addFix) {
		store.addFix(session.id, {
			iteration: 1,
			hypothesisId: 1,
			files: [{ path: "src/cart.ts", description: "Added null check" }],
			verified: false,
		});
	}

	return store.getActive()!;
}

/** A minimal mock ctx (status doesn't use UI). */
function makeCtx(): ExtensionContext {
	return {} as ExtensionContext;
}

// ── formatHypothesisStatus ────────────────────────────────────────────────

describe("formatHypothesisStatus", () => {
	it("includes id, confidence, description, and status", () => {
		const result = formatHypothesisStatus(makeHypothesis());
		expect(result).toBe("  #1 [high] Race condition in cart.update() — pending");
	});

	it("reflects different statuses", () => {
		expect(formatHypothesisStatus(makeHypothesis({ status: "instrumented" }))).toContain("instrumented");
		expect(formatHypothesisStatus(makeHypothesis({ status: "confirmed" }))).toContain("confirmed");
		expect(formatHypothesisStatus(makeHypothesis({ status: "ruled_out" }))).toContain("ruled_out");
	});

	it("reflects different confidence levels", () => {
		expect(formatHypothesisStatus(makeHypothesis({ confidence: "low" }))).toContain("[low]");
		expect(formatHypothesisStatus(makeHypothesis({ confidence: "medium" }))).toContain("[medium]");
	});
});

// ── buildPhaseHint ─────────────────────────────────────────────────────────

describe("buildPhaseHint", () => {
	it("returns a hint for each phase", () => {
		for (const phase of ["understand", "hypothesize", "instrument", "observe", "fix", "verify", "cleanup"] as SessionPhase[]) {
			const hint = buildPhaseHint(phase);
			expect(hint).toBeTruthy();
			expect(hint.length).toBeGreaterThan(0);
		}
	});

	it("understand hint mentions hypothesize", () => {
		expect(buildPhaseHint("understand")).toContain("debug_hypothesize");
	});

	it("hypothesize hint mentions instrument", () => {
		expect(buildPhaseHint("hypothesize")).toContain("debug_instrument");
	});

	it("observe hint mentions reproduce and logs", () => {
		const hint = buildPhaseHint("observe");
		expect(hint).toContain("reproduce");
		expect(hint).toContain("debug_logs");
	});

	it("fix hint mentions edit and debug_fix", () => {
		const hint = buildPhaseHint("fix");
		expect(hint).toContain("edit");
		expect(hint).toContain("debug_fix");
	});

	it("verify hint mentions retest and cleanup", () => {
		const hint = buildPhaseHint("verify");
		expect(hint).toContain("retest");
		expect(hint).toContain("debug_cleanup");
	});
});

// ── buildStatusResult ─────────────────────────────────────────────────────

describe("buildStatusResult", () => {
	it("includes session ID and phase", () => {
		const session = setupSession();
		const result = buildStatusResult(session);
		expect(result).toContain(session.id);
		expect(result).toContain(`phase: ${session.phase}`);
	});

	it("includes iteration and maxIterations", () => {
		const session = setupSession({ iteration: 3 });
		const result = buildStatusResult(session);
		expect(result).toContain("Iteration 3/5");
	});

	it("includes the bug description", () => {
		const session = setupSession();
		const result = buildStatusResult(session);
		expect(result).toContain("Bug: Checkout crashes with 3 items");
	});

	it("lists hypotheses with statuses", () => {
		const session = setupSession({
			hypotheses: [
				makeHypothesis({ id: 1, status: "instrumented" }),
				makeHypothesis({ id: 2, description: "Null pointer", status: "pending" }),
			],
		});
		const result = buildStatusResult(session);
		expect(result).toContain("#1 [high] Race condition in cart.update() — instrumented");
		expect(result).toContain("#2 [high] Null pointer — pending");
		expect(result).toContain("Hypotheses (2):");
	});

	it("shows placeholder when no hypotheses", () => {
		const session = setupSession();
		const result = buildStatusResult(session);
		expect(result).toContain("(none yet");
		expect(result).toContain("debug_hypothesize");
	});

	it("includes instrumented files count and log count", () => {
		const session = setupSession({ addInstrumentation: true, logCount: 42 });
		const result = buildStatusResult(session);
		expect(result).toContain("Instrumented files: 1");
		expect(result).toContain("Logs collected: 42");
	});

	it("includes fixes applied with iteration and hypothesis", () => {
		const session = setupSession({ addFix: true });
		const result = buildStatusResult(session);
		expect(result).toContain("Fixes applied: 1");
		expect(result).toContain("iteration 1");
		expect(result).toContain("hypothesis #1");
	});

	it("includes confirmed hypothesis when set", () => {
		const session = setupSession({ confirmedHypothesis: 2 });
		const result = buildStatusResult(session);
		expect(result).toContain("Confirmed hypothesis: #2");
	});

	it("includes phase hint at the end", () => {
		const session = setupSession({ phase: "observe" });
		const result = buildStatusResult(session);
		expect(result).toContain("reproduce");
	});

	it("handles empty fixes gracefully", () => {
		const session = setupSession();
		const result = buildStatusResult(session);
		expect(result).toContain("Fixes applied: 0");
	});
});

// ── createStatusTool — execute ─────────────────────────────────────────────

describe("createStatusTool — execute", () => {
	it("returns no-session message when no active session", async () => {
		const tool = createStatusTool(deps);
		const result = await tool.execute("call-1", {}, undefined, undefined, makeCtx());

		expect(result.content[0].text).toContain("No active debug session");
		expect(result.details.active).toBe(false);
	});

	it("includes guidance in the no-session message", async () => {
		const tool = createStatusTool(deps);
		const result = await tool.execute("call-1", {}, undefined, undefined, makeCtx());

		expect(result.content[0].text).toContain("debug_hypothesize");
	});

	it("returns full state for an active session in observe phase", async () => {
		const session = setupSession({
			phase: "observe",
			hypotheses: [
				makeHypothesis({ id: 1, status: "instrumented" }),
				makeHypothesis({ id: 2, status: "pending" }),
			],
			addInstrumentation: true,
			logCount: 15,
		});
		const tool = createStatusTool(deps);

		const result = await tool.execute("call-1", {}, undefined, undefined, makeCtx());

		const text = result.content[0].text;
		expect(text).toContain(session.id);
		expect(text).toContain("phase: observe");
		expect(text).toContain("Iteration 2/5");
		expect(text).toContain("Bug: Checkout crashes with 3 items");
		expect(text).toContain("#1 [high] Race condition in cart.update() — instrumented");
		expect(text).toContain("Instrumented files: 1");
		expect(text).toContain("Logs collected: 15");
	});

	it("returns structured details with all fields", async () => {
		const session = setupSession({
			hypotheses: [makeHypothesis()],
			addInstrumentation: true,
			addFix: true,
			logCount: 10,
		});
		const tool = createStatusTool(deps);

		const result = await tool.execute("call-1", {}, undefined, undefined, makeCtx());

		expect(result.details.active).toBe(true);
		expect(result.details.sessionId).toBe(session.id);
		expect(result.details.phase).toBe("observe");
		expect(result.details.iteration).toBe(2);
		expect(result.details.maxIterations).toBe(5);
		expect(result.details.status).toBe("active");
		expect(result.details.hypothesisCount).toBe(1);
		expect(result.details.hypotheses).toHaveLength(1);
		expect(result.details.hypotheses[0]).toEqual({
			id: 1,
			description: "Race condition in cart.update()",
			confidence: "high",
			status: "pending",
		});
		expect(result.details.instrumentedFileCount).toBe(1);
		expect(result.details.logCount).toBe(10);
		expect(result.details.fixCount).toBe(1);
	});

	it("details do not include full hypothesis objects (only summary)", async () => {
		// Hypotheses in details are lightweight {id, description, confidence, status}
		// — not the full object with instrumentationPlan etc.
		setupSession({
			hypotheses: [makeHypothesis({ instrumentationPlan: [{ file: "x", locations: [] }] })],
		});
		const tool = createStatusTool(deps);

		const result = await tool.execute("call-1", {}, undefined, undefined, makeCtx());

		expect(result.details.hypotheses[0].id).toBe(1);
		expect((result.details.hypotheses[0] as Record<string, unknown>)).not.toHaveProperty("instrumentationPlan");
	});

	it("returns correct counts for a fresh session (no hypotheses/instrumentation/fixes)", async () => {
		const session = store.create("Fresh bug");
		const tool = createStatusTool(deps);

		const result = await tool.execute("call-1", {}, undefined, undefined, makeCtx());

		expect(result.details.active).toBe(true);
		expect(result.details.hypothesisCount).toBe(0);
		expect(result.details.instrumentedFileCount).toBe(0);
		expect(result.details.logCount).toBe(0);
		expect(result.details.fixCount).toBe(0);
		expect(result.details.confirmedHypothesis).toBeUndefined();
	});

	it("includes confirmedHypothesis in details when set", async () => {
		setupSession({ confirmedHypothesis: 3 });
		const tool = createStatusTool(deps);

		const result = await tool.execute("call-1", {}, undefined, undefined, makeCtx());

		expect(result.details.confirmedHypothesis).toBe(3);
	});

	it("text reflects different phases correctly", async () => {
		const phases: SessionPhase[] = ["understand", "hypothesize", "instrument", "observe", "fix", "verify"];
		for (const phase of phases) {
			store.clearActive();
			setupSession({ phase });
			const tool = createStatusTool(deps);
			const result = await tool.execute("call-1", {}, undefined, undefined, makeCtx());
			expect(result.content[0].text).toContain(`phase: ${phase}`);
		}
	});

	it("shows iteration progress (e.g., 3/5)", async () => {
		setupSession({ iteration: 4 });
		const tool = createStatusTool(deps);
		const result = await tool.execute("call-1", {}, undefined, undefined, makeCtx());
		expect(result.content[0].text).toContain("Iteration 4/5");
		expect(result.details.iteration).toBe(4);
	});
});
