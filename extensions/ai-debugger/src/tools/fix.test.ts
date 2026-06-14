/**
 * Tests for the debug_fix tool.
 *
 * Strategy:
 * - Pure functions (toAppliedFix, formatFixFiles, buildFixResult) are tested directly
 * - The execute function is tested with a real SessionStore in an isolated temp dir
 * - Tests verify: AppliedFix recorded, iteration incremented, phase = verify,
 *   fix persists to disk, error handling
 *
 * Per TODO verifies:
 * - Call debug_fix → AppliedFix recorded, iteration incremented, phase = verify
 * - Fix appears in session state
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SessionStore } from "../session-store.js";
import { DEFAULTS } from "../config.js";
import {
	createFixTool,
	toAppliedFix,
	formatFixFiles,
	buildFixResult,
} from "./fix.js";
import type { FixParams, FixToolDeps } from "./fix.js";
import type { AppliedFixFile } from "../types.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// ── Test isolation ─────────────────────────────────────────────────────────

let tmpDir: string;
let store: SessionStore;
let deps: FixToolDeps;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-debugger-fix-test-"));
	store = new SessionStore(tmpDir);
	deps = { store };
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Create an active session with hypotheses and return its ID. */
function setupSession(opts: { iteration?: number; hypothesisId?: number } = {}): string {
	const session = store.create("Test bug", DEFAULTS.maxIterations);
	store.update(session.id, {
		phase: "observe",
		iteration: opts.iteration ?? 1,
		hypotheses: [
			{
				id: opts.hypothesisId ?? 1,
				description: "Test hypothesis",
				confidence: "high",
				files: ["src/cart.ts"],
				instrumentationPlan: [],
				status: "instrumented",
			},
		],
	});
	return session.id;
}

function makeFiles(overrides: AppliedFixFile[] = []): AppliedFixFile[] {
	if (overrides.length > 0) return overrides;
	return [
		{ path: "src/cart.ts", changes: "Added null check before accessing cart.items" },
		{ path: "src/checkout.ts", changes: "Guard against undefined total" },
	];
}

function makeParams(overrides: Partial<FixParams> = {}): FixParams {
	return {
		hypothesisId: 1,
		description: "Added null checks to prevent the crash",
		files: makeFiles(),
		...overrides,
	};
}

/** A minimal mock ctx (fix doesn't use UI). */
function makeCtx(): ExtensionContext {
	return {} as ExtensionContext;
}

// ── toAppliedFix ───────────────────────────────────────────────────────────

describe("toAppliedFix", () => {
	it("tags the fix with the given iteration", () => {
		const fix = toAppliedFix(3, 1, makeFiles());
		expect(fix.iteration).toBe(3);
	});

	it("tags the fix with the given hypothesis ID", () => {
		const fix = toAppliedFix(1, 5, makeFiles());
		expect(fix.hypothesisId).toBe(5);
	});

	it("marks the fix as unverified", () => {
		const fix = toAppliedFix(1, 1, makeFiles());
		expect(fix.verified).toBe(false);
	});

	it("preserves the files array", () => {
		const files = makeFiles([{ path: "a.ts", changes: "fix" }]);
		const fix = toAppliedFix(1, 1, files);
		expect(fix.files).toEqual(files);
		expect(fix.files).toHaveLength(1);
	});

	it("does not set userFeedback or feedbackDetail (set during verify)", () => {
		const fix = toAppliedFix(1, 1, makeFiles());
		expect(fix.userFeedback).toBeUndefined();
		expect(fix.feedbackDetail).toBeUndefined();
	});
});

// ── formatFixFiles ─────────────────────────────────────────────────────────

describe("formatFixFiles", () => {
	it("formats each file as a bullet with path and changes", () => {
		const result = formatFixFiles([
			{ path: "src/cart.ts", changes: "Added null check" },
		]);
		expect(result).toEqual(["  • src/cart.ts: Added null check"]);
	});

	it("formats multiple files", () => {
		const result = formatFixFiles([
			{ path: "a.ts", changes: "change a" },
			{ path: "b.ts", changes: "change b" },
		]);
		expect(result).toHaveLength(2);
		expect(result[0]).toContain("a.ts");
		expect(result[1]).toContain("b.ts");
	});

	it("returns empty array for no files", () => {
		expect(formatFixFiles([])).toEqual([]);
	});
});

// ── buildFixResult ─────────────────────────────────────────────────────────

describe("buildFixResult", () => {
	const fix = {
		iteration: 1,
		hypothesisId: 2,
		files: [
			{ path: "src/cart.ts", changes: "Added null check" },
			{ path: "src/checkout.ts", changes: "Guard total" },
		],
		verified: false,
	};

	it("includes session ID and iteration", () => {
		const result = buildFixResult("abc123", fix, 2);
		expect(result).toContain("abc123");
		expect(result).toContain("iteration 1");
	});

	it("includes hypothesis ID", () => {
		const result = buildFixResult("abc123", fix, 2);
		expect(result).toContain("#2");
	});

	it("includes each changed file", () => {
		const result = buildFixResult("abc123", fix, 2);
		expect(result).toContain("src/cart.ts");
		expect(result).toContain("Added null check");
		expect(result).toContain("src/checkout.ts");
		expect(result).toContain("Guard total");
	});

	it("includes the change count", () => {
		const result = buildFixResult("abc123", fix, 2);
		expect(result).toContain("2 change(s)");
	});

	it("sets phase to verify", () => {
		const result = buildFixResult("abc123", fix, 2);
		expect(result).toContain("verify");
	});

	it("prompts user to retest", () => {
		const result = buildFixResult("abc123", fix, 2);
		expect(result).toContain("retest");
	});

	it("includes next-step guidance (cleanup or retry)", () => {
		const result = buildFixResult("abc123", fix, 2);
		expect(result).toContain("debug_cleanup");
	});
});

// ── createFixTool — execute ────────────────────────────────────────────────

describe("createFixTool — execute", () => {
	it("throws when no active session", async () => {
		const tool = createFixTool(deps);
		await expect(
			tool.execute("call-1", makeParams(), undefined, undefined, makeCtx()),
		).rejects.toThrow("No active debug session");
	});

	it("throws when hypothesis ID not found", async () => {
		setupSession({ hypothesisId: 1 });
		const tool = createFixTool(deps);
		await expect(
			tool.execute("call-1", makeParams({ hypothesisId: 99 }), undefined, undefined, makeCtx()),
		).rejects.toThrow("Hypothesis #99 not found");
	});

	it("throws on empty files array", async () => {
		setupSession();
		const tool = createFixTool(deps);
		await expect(
			tool.execute("call-1", makeParams({ files: [] }), undefined, undefined, makeCtx()),
		).rejects.toThrow("At least one changed file");
	});

	it("records the AppliedFix in the session", async () => {
		setupSession();
		const tool = createFixTool(deps);
		await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx());

		const session = store.getActive()!;
		expect(session.fixes).toHaveLength(1);
		expect(session.fixes[0].hypothesisId).toBe(1);
		expect(session.fixes[0].files).toHaveLength(2);
		expect(session.fixes[0].files[0].path).toBe("src/cart.ts");
	});

	it("marks the fix as unverified (verified=false)", async () => {
		setupSession();
		const tool = createFixTool(deps);
		await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx());

		expect(store.getActive()!.fixes[0].verified).toBe(false);
	});

	it("tags the fix with the current iteration", async () => {
		setupSession({ iteration: 3 });
		const tool = createFixTool(deps);
		await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx());

		expect(store.getActive()!.fixes[0].iteration).toBe(3);
	});

	it("increments session.iteration after recording", async () => {
		setupSession({ iteration: 2 });
		const tool = createFixTool(deps);
		await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx());

		expect(store.getActive()!.iteration).toBe(3);
	});

	it("increments from iteration 1 on first fix", async () => {
		setupSession({ iteration: 1 });
		const tool = createFixTool(deps);
		await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx());

		expect(store.getActive()!.iteration).toBe(2);
	});

	it("sets phase to verify", async () => {
		setupSession();
		const tool = createFixTool(deps);
		await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx());

		expect(store.getActive()!.phase).toBe("verify");
	});

	it("does not remove instrumentation (it stays for the verify step)", async () => {
		const sessionId = setupSession();
		store.addInstrumentedFile(sessionId, {
			path: "src/cart.ts",
			originalContent: "old",
			changes: [{ lineStart: 1, lineEnd: 3, hypothesisId: 1, marker: "// start" }],
		});

		const tool = createFixTool(deps);
		await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx());

		expect(store.getActive()!.instrumentedFiles).toHaveLength(1);
	});

	it("returns structured details with fix info", async () => {
		setupSession({ iteration: 1 });
		const tool = createFixTool(deps);
		const result = await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx());

		expect(result.details.sessionId).toBeDefined();
		expect(result.details.hypothesisId).toBe(1);
		expect(result.details.iteration).toBe(1);
		expect(result.details.nextIteration).toBe(2);
		expect(result.details.phase).toBe("verify");
		expect(result.details.fix).toBeDefined();
		expect(result.details.fix.files).toHaveLength(2);
	});

	it("returns text with session, hypothesis, and retest prompt", async () => {
		setupSession();
		const tool = createFixTool(deps);
		const result = await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx());

		const text = result.content[0].text;
		expect(text).toContain("Fix recorded");
		expect(text).toContain("#1");
		expect(text).toContain("retest");
	});

	it("records multiple fixes across iterations (each tagged correctly)", async () => {
		setupSession({ iteration: 1, hypothesisId: 1 });
		const tool = createFixTool(deps);

		// First fix
		await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx());
		// Session now at iteration 2

		// Simulate verify failure → back to observe → second fix attempt
		store.update(store.getActive()!.id, { phase: "observe" });

		await tool.execute("call-2", makeParams({
			files: [{ path: "src/cart.ts", changes: "Different fix: check array bounds" }],
		}), undefined, undefined, makeCtx());

		const session = store.getActive()!;
		expect(session.fixes).toHaveLength(2);
		expect(session.fixes[0].iteration).toBe(1);
		expect(session.fixes[1].iteration).toBe(2);
		expect(session.iteration).toBe(3);
	});
});

// ── Disk persistence ──────────────────────────────────────────────────────

describe("createFixTool — disk persistence", () => {
	it("persists the fix to session on disk", async () => {
		const sessionId = setupSession();
		const tool = createFixTool(deps);
		await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx());

		// Fresh store loads from disk
		const store2 = new SessionStore(tmpDir);
		const loaded = store2.get(sessionId);
		expect(loaded!.fixes).toHaveLength(1);
		expect(loaded!.fixes[0].hypothesisId).toBe(1);
		expect(loaded!.phase).toBe("verify");
		expect(loaded!.iteration).toBe(2);
	});
});
