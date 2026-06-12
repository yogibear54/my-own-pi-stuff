/**
 * Tests for SessionStore.
 *
 * Strategy:
 * - Each test gets an isolated temp directory (created in beforeEach, cleaned in afterEach).
 *   This prevents tests from polluting each other or the developer's project.
 * - Factory functions (`makeHypothesis`, `makeInstrumentedFile`, `makeFix`) provide sensible
 *   defaults with spread overrides, keeping test data DRY.
 * - "Cross-instance" tests create a second SessionStore pointing at the same tmpDir to
 *   verify that data persisted to disk can be loaded by a fresh store (simulates a
 *   process restart).
 * - `while (Date.now() === start) {}` spin-loops guarantee distinct timestamps
 *   when tests depend on creation ordering. Cheaper than fake timers for 1ms gaps.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SessionStore } from "./session-store.js";
import type { Hypothesis, InstrumentedFile, AppliedFix } from "./types.js";

// ── Test isolation ─────────────────────────────────────────────────────────
// Each test writes to its own temp directory under /tmp/ai-debugger-test-XXXXXX/.
// This directory is removed after every test, so no state leaks between tests.

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-debugger-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Factory helpers ────────────────────────────────────────────────────────
// Each factory returns a valid object with sensible defaults.
// Pass `overrides` to customize specific fields without repeating the full object.

/** Create a SessionStore rooted at the test's temp directory. */
function createStore(): SessionStore {
	return new SessionStore(tmpDir);
}

/** Build a Hypothesis with defaults. Override any field via `overrides`. */
function makeHypothesis(overrides: Partial<Hypothesis> = {}): Hypothesis {
	return {
		id: 1,
		description: "Race condition in cart.update()",
		confidence: "high",
		files: ["src/cart.ts"],
		instrumentationPlan: [
			{
				file: "src/cart.ts",
				locations: [{ line: 45, whatToLog: "cart state" }],
			},
		],
		status: "pending",
		...overrides,
	};
}

/** Build an InstrumentedFile with defaults. Override any field via `overrides`. */
function makeInstrumentedFile(overrides: Partial<InstrumentedFile> = {}): InstrumentedFile {
	return {
		path: path.join(tmpDir, "src/cart.ts"),
		originalContent: "function update() {}",
		changes: [
			{
				lineStart: 2,
				lineEnd: 5,
				hypothesisId: 1,
				marker: "// __AI_DEBUG_START__ session=abc123",
			},
		],
		...overrides,
	};
}

/** Build an AppliedFix with defaults. Override any field via `overrides`. */
function makeFix(overrides: Partial<AppliedFix> = {}): AppliedFix {
	return {
		iteration: 1,
		hypothesisId: 1,
		files: [{ path: "src/cart.ts", description: "Added mutex lock" }],
		verified: false,
		...overrides,
	};
}

// ── Tests ──────────────────────────────────────────────────────────────────
// Organized by method. Each describe block tests one SessionStore method.
// Tests are ordered: happy path → edge cases → error cases.

describe("SessionStore", () => {
	// ── create ──────────────────────────────────────────────────────────
	// Verifies that sessions are created with correct defaults, persisted to
	// disk, and that the one-at-a-time constraint is enforced.
	describe("create", () => {
		it("creates a session with correct defaults", () => {
			// Smoke test: verify every field on a freshly created session
			// matches the spec in Section 9.1 of REQUIREMENTS.md
			const store = createStore();
			const session = store.create("Checkout crashes");

			expect(session.id).toBeDefined();
			expect(session.id).toHaveLength(8); // 4 bytes hex
			expect(session.description).toBe("Checkout crashes");
			expect(session.status).toBe("active");
			expect(session.phase).toBe("understand");
			expect(session.iteration).toBe(1);
			expect(session.maxIterations).toBe(5);
			expect(session.hypotheses).toEqual([]);
			expect(session.instrumentedFiles).toEqual([]);
			expect(session.fixes).toEqual([]);
			expect(session.logCount).toBe(0);
			expect(session.createdAt).toBeGreaterThan(0);
			expect(session.updatedAt).toBe(session.createdAt);
		});

		it("accepts custom maxIterations", () => {
			// The default is 5, but /debug start can pass a custom value from config
			const store = createStore();
			const session = store.create("Bug", 10);
			expect(session.maxIterations).toBe(10);
		});

		it("persists to disk", () => {
			// Verify session.json is written immediately on create.
			// Critical for crash recovery — if pi dies, the session must already be on disk.

			const store = createStore();
			const session = store.create("Disk test");

			const file = path.join(tmpDir, ".pi", "debug", session.id, "session.json");
			expect(fs.existsSync(file)).toBe(true);

			const loaded = JSON.parse(fs.readFileSync(file, "utf-8"));
			expect(loaded.id).toBe(session.id);
			expect(loaded.description).toBe("Disk test");
		});

		it("throws if an active session already exists", () => {
			// The one-at-a-time constraint (Section 13, decision #6).
			// User must /debug cleanup or /debug abort before starting a new session.
			const store = createStore();
			store.create("First");
			expect(() => store.create("Second")).toThrow(/already active/);
		});
	});

	// ── getActive ───────────────────────────────────────────────────────
	// The hot path used by every tool and command to check session state.
	describe("getActive", () => {
		it("returns undefined when no active session", () => {
			// Before /debug start is called
			const store = createStore();
			expect(store.getActive()).toBeUndefined();
		});

		it("returns the active session after create", () => {
			// Basic contract: create → getActive returns the same session
			const store = createStore();
			const session = store.create("Test");
			expect(store.getActive()?.id).toBe(session.id);
		});
	});

	// ── get ─────────────────────────────────────────────────────────────
	// Tests the memory-first, disk-fallback lookup strategy.
	describe("get", () => {
		it("returns active session by id (from memory)", () => {
			// Fast path: session is in the in-memory cache
			const store = createStore();
			const session = store.create("Test");
			expect(store.get(session.id)).toBeDefined();
			expect(store.get(session.id)!.description).toBe("Test");
		});

		it("loads from disk if not in memory", () => {
			// Slow path: simulates a fresh process that didn't create the session.
			// A second SessionStore instance reads from the same temp dir.
			const store = createStore();
			const session = store.create("Disk load test");

			const store2 = createStore();
			const loaded = store2.get(session.id);
			expect(loaded).toBeDefined();
			expect(loaded!.description).toBe("Disk load test");
		});

		it("returns undefined for unknown id", () => {
			// Defensive: should not throw, just return undefined
			const store = createStore();
			expect(store.get("nonexistent")).toBeUndefined();
		});
	});

	// ── update ──────────────────────────────────────────────────────────
	// Tests the generic mutator used for phase transitions and status changes.
	describe("update", () => {
		it("updates fields on the session", () => {
			// Typical use: phase transitions like observe → fix
			const store = createStore();
			const session = store.create("Test");
			store.update(session.id, { phase: "observe" });
			expect(store.getActive()?.phase).toBe("observe");
		});

		it("bumps updatedAt", () => {
			// Every mutation must auto-update the timestamp so findActiveOnDisk
			// returns the most recent session after a crash.
			const store = createStore();
			const session = store.create("Test");
			const before = session.updatedAt;
			// tiny delay to ensure timestamp changes
			const start = Date.now();
			while (Date.now() === start) {}
			store.update(session.id, { phase: "instrument" });
			expect(store.getActive()!.updatedAt).toBeGreaterThan(before);
		});

		it("persists changes to disk", () => {
			// Verify that updates survive a store re-instantiation (process restart)
			const store = createStore();
			const session = store.create("Test");
			store.update(session.id, { phase: "cleanup", status: "completed" });

			const store2 = createStore();
			const loaded = store2.get(session.id);
			expect(loaded!.phase).toBe("cleanup");
			expect(loaded!.status).toBe("completed");
		});

		it("throws for unknown session id", () => {
			// Programmer error guard — tools should never hit this in practice
			const store = createStore();
			expect(() => store.update("nope", { phase: "observe" })).toThrow(/not found/);
		});
	});

	// ── addHypothesis ───────────────────────────────────────────────────
	// Tests the debug_hypothesize tool's storage path.
	describe("addHypothesis", () => {
		it("adds a hypothesis to the session", () => {
			// Verify the hypothesis is stored with all its fields intact
			const store = createStore();
			const session = store.create("Test");
			store.addHypothesis(session.id, makeHypothesis());

			const h = store.getActive()?.hypotheses[0];
			expect(h).toBeDefined();
			expect(h!.description).toBe("Race condition in cart.update()");
			expect(h!.confidence).toBe("high");
			expect(h!.status).toBe("pending");
		});

		it("persists to disk", () => {
			// Cross-instance check: hypothesis survives process restart

			const store = createStore();
			const session = store.create("Test");
			store.addHypothesis(session.id, makeHypothesis({ id: 2, description: "Null pointer" }));

			const store2 = createStore();
			const loaded = store2.get(session.id);
			expect(loaded!.hypotheses).toHaveLength(1);
			expect(loaded!.hypotheses[0].description).toBe("Null pointer");
		});
	});

	// ── addInstrumentedFile ─────────────────────────────────────────────
	// Tests the debug_instrument tool's storage path, including the
	// important merge behavior when the same file is instrumented twice.
	describe("addInstrumentedFile", () => {
		it("adds an instrumented file to the session", () => {
			// Basic contract: file is tracked with path and changes
			const store = createStore();
			const session = store.create("Test");
			store.addInstrumentedFile(session.id, makeInstrumentedFile());

			expect(store.getActive()?.instrumentedFiles).toHaveLength(1);
			expect(store.getActive()?.instrumentedFiles[0].path).toContain("cart.ts");
		});

		it("merges changes when the same file is added twice", () => {
			// Key behavior: if the LLM instruments src/app.ts for hypothesis 1
			// and then adds more instrumentation to the same file for hypothesis 2,
			// the changes are merged into a single entry. This keeps cleanup simple
			// (one entry per file) and preserves the original content for abort.
			const store = createStore();
			const session = store.create("Test");
			const filePath = path.join(tmpDir, "src/app.ts");

			store.addInstrumentedFile(session.id, makeInstrumentedFile({
				path: filePath,
				changes: [{ lineStart: 10, lineEnd: 13, hypothesisId: 1, marker: "// __AI_DEBUG_START__" }],
			}));
			store.addInstrumentedFile(session.id, makeInstrumentedFile({
				path: filePath,
				changes: [{ lineStart: 20, lineEnd: 23, hypothesisId: 2, marker: "// __AI_DEBUG_START__" }],
			}));

			expect(store.getActive()?.instrumentedFiles).toHaveLength(1);
			expect(store.getActive()?.instrumentedFiles[0].changes).toHaveLength(2);
		});
	});

	// ── addFix ──────────────────────────────────────────────────────────
	// Tests the debug_fix tool's storage path.
	describe("addFix", () => {
		it("adds a fix to the session", () => {
			// Fix is tracked with iteration, hypothesis, files, and verified flag
			const store = createStore();
			const session = store.create("Test");
			store.addFix(session.id, makeFix());

			expect(store.getActive()?.fixes).toHaveLength(1);
			expect(store.getActive()?.fixes[0].hypothesisId).toBe(1);
			expect(store.getActive()?.fixes[0].verified).toBe(false);
		});
	});

	// ── incrementLogCount ───────────────────────────────────────────────
	// Tests the counter used by the LogCollector and displayed in the widget.
	describe("incrementLogCount", () => {
		it("increments the log count", () => {
			// Simulate the collector receiving 3 logs
			const store = createStore();
			const session = store.create("Test");

			store.incrementLogCount(session.id);
			store.incrementLogCount(session.id);
			store.incrementLogCount(session.id);

			expect(store.getActive()?.logCount).toBe(3);
		});

		it("does nothing for unknown session", () => {
			// The collector may receive stale POSTs after a session ends.
			// incrementLogCount must not throw in that case.
			const store = createStore();
			expect(() => store.incrementLogCount("nope")).not.toThrow();
		});
	});

	// ── clearActive ─────────────────────────────────────────────────────
	// Tests the lifecycle method called after cleanup/abort.
	describe("clearActive", () => {
		it("clears the active session reference", () => {
			// After clearActive, getActive returns undefined
			const store = createStore();
			store.create("Test");
			expect(store.getActive()).toBeDefined();

			store.clearActive();
			expect(store.getActive()).toBeUndefined();
		});

		it("allows creating a new session after clearing", () => {
			// The one-at-a-time constraint is lifted after clearActive
			const store = createStore();
			const s1 = store.create("First");
			store.clearActive();
			const s2 = store.create("Second");

			expect(s2.id).not.toBe(s1.id);
		});

		it("does not delete the previous session from disk", () => {
			// clearActive only removes the in-memory reference. The session
			// remains on disk for history and crash recovery.
			const store = createStore();
			const s1 = store.create("First");
			store.clearActive();

			expect(store.get(s1.id)).toBeDefined();
		});
	});

	// ── findActiveOnDisk ────────────────────────────────────────────────
	// Tests the crash recovery path used on pi startup.
	describe("findActiveOnDisk", () => {
		it("returns undefined when no sessions exist", () => {
			// Clean project, first time running /debug start
			const store = createStore();
			expect(store.findActiveOnDisk()).toBeUndefined();
		});

		it("finds the most recently updated active session", () => {
			// When multiple active sessions exist on disk (e.g., the user started
			// a session, pi crashed, started another), findActiveOnDisk returns
			// the one with the most recent updatedAt timestamp.
			const store = createStore();
			store.create("Older");
			store.clearActive();
			// tiny delay to ensure different timestamp
			const start = Date.now();
			while (Date.now() === start) {}
			const s2 = store.create("Newer");

			// Both are active on disk — findActiveOnDisk returns the most recently updated
			const store2 = createStore();
			const found = store2.findActiveOnDisk();
			expect(found).toBeDefined();
			expect(found!.id).toBe(s2.id); // s2 was created last → most recent updatedAt
		});

		it("ignores completed sessions", () => {
			// Completed sessions don't need recovery — instrumentation is already cleaned up
			const store = createStore();
			const session = store.create("Completed");
			store.update(session.id, { status: "completed" });
			store.clearActive();

			const store2 = createStore();
			expect(store2.findActiveOnDisk()).toBeUndefined();
		});

		it("ignores aborted sessions", () => {
			// Aborted sessions don't need recovery — changes were reverted
			const store = createStore();
			const session = store.create("Aborted");
			store.update(session.id, { status: "aborted" });
			store.clearActive();

			const store2 = createStore();
			expect(store2.findActiveOnDisk()).toBeUndefined();
		});
	});

	// ── restore ─────────────────────────────────────────────────────────
	// Tests the method that sets a loaded session back as active in memory.
	describe("restore", () => {
		it("sets a session as the active session", () => {
			// Simulates the startup flow: findActiveOnDisk() → restore()
			const store = createStore();
			const session = store.create("Restore test");
			store.clearActive();

			expect(store.getActive()).toBeUndefined();
			store.restore(session);
			expect(store.getActive()?.id).toBe(session.id);
		});
	});

	// ── list ────────────────────────────────────────────────────────────
	// Tests the /debug history command's data source.
	describe("list", () => {
		it("returns empty array when no sessions", () => {
			// Fresh project, no .pi/debug/ directory
			const store = createStore();
			expect(store.list()).toEqual([]);
		});

		it("lists sessions sorted by createdAt descending", () => {
			// Newest first — most relevant to the user
			const store = createStore();
			const s1 = store.create("First");
			store.clearActive();
			const start = Date.now();
			while (Date.now() === start) {}
			const s2 = store.create("Second");
			store.clearActive();
			const start2 = Date.now();
			while (Date.now() === start2) {}
			const s3 = store.create("Third");

			const all = store.list();
			expect(all).toHaveLength(3);
			expect(all[0].id).toBe(s3.id);
			expect(all[1].id).toBe(s2.id);
			expect(all[2].id).toBe(s1.id);
		});

		it("includes both active and completed sessions", () => {
			// History shows all sessions regardless of status
			const store = createStore();
			const s1 = store.create("Active");
			store.clearActive();
			const start = Date.now();
			while (Date.now() === start) {}
			const s2 = store.create("Done");
			store.update(s2.id, { status: "completed" });

			const all = store.list();
			expect(all).toHaveLength(2);
			expect(all.find((s) => s.id === s1.id)?.status).toBe("active");
			expect(all.find((s) => s.id === s2.id)?.status).toBe("completed");
		});
	});

	// ── persistence (integration) ───────────────────────────────────────
	// End-to-end test: create → mutate every field → persist → reload from disk.
	// Catches serialization bugs that per-method tests might miss
	// (e.g., a field that isn't JSON-serializable, or a typo in a property name).
	describe("persistence", () => {
		it("survives a full create → mutate → reload cycle", () => {
			// Push every type of data through the store, then reload from scratch
			const store = createStore();
			const session = store.create("Full cycle");

			store.addHypothesis(session.id, makeHypothesis({ id: 1 }));
			store.addHypothesis(session.id, makeHypothesis({ id: 2, description: "Null pointer", confidence: "low" }));
			store.addInstrumentedFile(session.id, makeInstrumentedFile());
			store.addFix(session.id, makeFix({ verified: true, userFeedback: "fixed" }));
			store.update(session.id, {
				phase: "verify",
				confirmedHypothesis: 1,
				iteration: 2,
			});
			for (let i = 0; i < 47; i++) store.incrementLogCount(session.id);

			// Reload from scratch — simulates a process restart
			const store2 = createStore();
			const loaded = store2.get(session.id)!;

			// Verify every field survived the round-trip through JSON serialization
			expect(loaded.phase).toBe("verify");
			expect(loaded.iteration).toBe(2);
			expect(loaded.confirmedHypothesis).toBe(1);
			expect(loaded.hypotheses).toHaveLength(2);
			expect(loaded.instrumentedFiles).toHaveLength(1);
			expect(loaded.fixes).toHaveLength(1);
			expect(loaded.fixes[0].verified).toBe(true);
			expect(loaded.fixes[0].userFeedback).toBe("fixed");
			expect(loaded.logCount).toBe(47);
		});
	});
});
