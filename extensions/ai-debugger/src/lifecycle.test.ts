/**
 * Tests for the session lifecycle hooks.
 *
 * Strategy:
 * - Each test uses a real SessionStore + LogCollector against an isolated temp dir.
 * - The lifecycle functions are pure — they take deps and return results (notifications,
 *   injected messages) without touching the pi API directly. This makes them testable
 *   without mocking pi.
 * - Tests cover every verification criterion from the TODO:
 *   - Start pi with an active session on disk → session restored (onSessionStart)
 *   - Exit pi mid-session → warning shown, state persisted (onSessionShutdown)
 *   - before_agent_start → context message injected with session details
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SessionStore } from "./session-store.js";
import { LogCollector } from "./log-collector.js";
import {
	onSessionStart,
	onSessionShutdown,
	onBeforeAgentStart,
	buildDebugContextMessage,
} from "./lifecycle.js";
import type { LifecycleDeps } from "./lifecycle.js";
import type { DebugSession, InstrumentedFile } from "./types.js";

// ── Test isolation ─────────────────────────────────────────────────────────

let tmpDir: string;
let store: SessionStore;
let collector: LogCollector;
let deps: LifecycleDeps;

beforeEach(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-debugger-lifecycle-test-"));
	store = new SessionStore(tmpDir);
	collector = new LogCollector(tmpDir, 100);
	await collector.start(0);
	deps = { store, collector, showDebugContextMessage: true };
});

afterEach(async () => {
	await collector.stop();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build an instrumented file with defaults for shutdown tests. */
function makeInstrumentedFile(overrides: Partial<InstrumentedFile> = {}): InstrumentedFile {
	return {
		path: path.join(tmpDir, "src/cart.ts"),
		originalContent: "function update() {}",
		changes: [
			{ lineStart: 2, lineEnd: 5, hypothesisId: 1, marker: "// __AI_DEBUG_START__" },
		],
		...overrides,
	};
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("onSessionStart", () => {
	it("returns no notification when no session exists on disk", () => {
		// Fresh project — nothing to restore
		const result = onSessionStart(deps);
		expect(result.notification).toBeUndefined();
	});

	it("restores an active session from disk and notifies", () => {
		// Simulate a previous process that created a session, then closed
		const store1 = new SessionStore(tmpDir);
		const session = store1.create("Checkout crash");
		store1.persist(session);
		// store1 is discarded (simulates process exit) — store has nothing in memory

		const result = onSessionStart(deps);

		expect(result.notification).toBeDefined();
		expect(result.notification!.message).toContain(session.id);
		expect(result.notification!.message).toContain("understand");
		expect(result.notification!.level).toBe("info");

		// The session is now restored into the active store
		expect(store.getActive()?.id).toBe(session.id);
	});

	it("does not restore completed sessions", () => {
		// A completed session was already cleaned up — no recovery needed
		const store1 = new SessionStore(tmpDir);
		const session = store1.create("Done bug");
		store1.update(session.id, { status: "completed" });
		store1.clearActive();

		const result = onSessionStart(deps);
		expect(result.notification).toBeUndefined();
		expect(store.getActive()).toBeUndefined();
	});

	it("does not restore aborted sessions", () => {
		const store1 = new SessionStore(tmpDir);
		const session = store1.create("Aborted bug");
		store1.update(session.id, { status: "aborted" });
		store1.clearActive();

		const result = onSessionStart(deps);
		expect(result.notification).toBeUndefined();
		expect(store.getActive()).toBeUndefined();
	});
});

describe("onSessionShutdown", () => {
	it("stops the collector", async () => {
		expect(collector.isRunning).toBe(true);
		await onSessionShutdown(deps);
		expect(collector.isRunning).toBe(false);
	});

	it("stops the collector even when no active session", async () => {
		expect(store.getActive()).toBeUndefined();
		await onSessionShutdown(deps);
		expect(collector.isRunning).toBe(false);
	});

	it("persists the active session to disk", async () => {
		const session = store.create("Persist me");
		// Clear in-memory only (simulate crash); disk should still have it via create()
		// Now shutdown should persist current state

		await onSessionShutdown(deps);

		// A fresh store should be able to load the session from disk
		const store2 = new SessionStore(tmpDir);
		const loaded = store2.get(session.id);
		expect(loaded).toBeDefined();
		expect(loaded!.description).toBe("Persist me");
	});

	it("returns no notification when no instrumentation is in place", async () => {
		store.create("Clean session");
		const result = await onSessionShutdown(deps);
		expect(result.notification).toBeUndefined();
	});

	it("warns when instrumentation is still in place", async () => {
		const session = store.create("Instrumented session");
		store.addInstrumentedFile(session.id, makeInstrumentedFile());

		const result = await onSessionShutdown(deps);

		expect(result.notification).toBeDefined();
		expect(result.notification!.level).toBe("warning");
		expect(result.notification!.message).toContain(session.id);
		expect(result.notification!.message).toContain("1 file");
		expect(result.notification!.message).toContain("/debug cleanup");
	});

	it("reports the correct file count in the warning", async () => {
		const session = store.create("Multi-file");
		store.addInstrumentedFile(session.id, makeInstrumentedFile({ path: path.join(tmpDir, "a.ts") }));
		store.addInstrumentedFile(session.id, makeInstrumentedFile({ path: path.join(tmpDir, "b.ts") }));
		store.addInstrumentedFile(session.id, makeInstrumentedFile({ path: path.join(tmpDir, "c.ts") }));

		const result = await onSessionShutdown(deps);
		expect(result.notification!.message).toContain("3 file");
	});

	it("does not warn for completed sessions", async () => {
		const session = store.create("Completed");
		store.addInstrumentedFile(session.id, makeInstrumentedFile());
		store.update(session.id, { status: "completed" });

		const result = await onSessionShutdown(deps);
		expect(result.notification).toBeUndefined();
	});

	it("does not warn for aborted sessions", async () => {
		const session = store.create("Aborted");
		store.addInstrumentedFile(session.id, makeInstrumentedFile());
		store.update(session.id, { status: "aborted" });

		const result = await onSessionShutdown(deps);
		expect(result.notification).toBeUndefined();
	});
});

describe("onBeforeAgentStart", () => {
	it("returns undefined when no active session", () => {
		expect(onBeforeAgentStart(deps)).toBeUndefined();
	});

	it("returns undefined for a completed session", () => {
		const session = store.create("Done");
		store.update(session.id, { status: "completed" });
		expect(onBeforeAgentStart(deps)).toBeUndefined();
	});

	it("injects a message with session ID and phase", () => {
		const session = store.create("Checkout crash");
		store.update(session.id, { phase: "observe" });

		const result = onBeforeAgentStart(deps);

		expect(result).toBeDefined();
		expect(result!.message.customType).toBe("ai-debugger");
		expect(result!.message.content).toContain(session.id);
		expect(result!.message.content).toContain("observe");
	});

	it("includes the bug description in the message", () => {
		store.create("Cart total is wrong");
		const result = onBeforeAgentStart(deps);
		expect(result!.message.content).toContain("Cart total is wrong");
	});

	it("includes iteration count", () => {
		const session = store.create("Test");
		store.update(session.id, { iteration: 3 });
		const result = onBeforeAgentStart(deps);
		expect(result!.message.content).toContain("Iteration: 3/5");
	});

	it("includes hypothesis and file counts", () => {
		const session = store.create("Test");
		store.update(session.id, { phase: "fix" });
		store.addInstrumentedFile(session.id, makeInstrumentedFile());

		const result = onBeforeAgentStart(deps);
		expect(result!.message.content).toContain("Instrumented files: 1");
		expect(result!.message.content).toContain("Hypotheses: 0");
	});

	it("includes confirmed hypothesis when set", () => {
		const session = store.create("Test");
		store.update(session.id, { confirmedHypothesis: 2 });
		const result = onBeforeAgentStart(deps);
		expect(result!.message.content).toContain("Confirmed hypothesis: #2");
	});

	it("respects showDebugContextMessage: true (display)", () => {
		store.create("Test");
		const result = onBeforeAgentStart(deps);
		expect(result!.message.display).toBe(true);
	});

	it("respects showDebugContextMessage: false (hidden)", () => {
		store.create("Test");
		const hiddenDeps = { ...deps, showDebugContextMessage: false };
		const result = onBeforeAgentStart(hiddenDeps);
		expect(result!.message.display).toBe(false);
	});

	it("still injects the message to LLM even when display is false", () => {
		// The message is always returned (LLM gets context); only display flag changes
		store.create("Test");
		const hiddenDeps = { ...deps, showDebugContextMessage: false };
		expect(onBeforeAgentStart(hiddenDeps)).toBeDefined();
	});
});

describe("buildDebugContextMessage", () => {
	function makeSession(overrides: Partial<DebugSession> = {}): DebugSession {
		return {
			id: "abc12345",
			description: "Checkout crash",
			status: "active",
			phase: "observe",
			iteration: 1,
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

	it("includes all core fields", () => {
		const msg = buildDebugContextMessage(makeSession());
		expect(msg).toContain("Bug: Checkout crash");
		expect(msg).toContain("abc12345");
		expect(msg).toContain("Phase: observe");
		expect(msg).toContain("Iteration: 1/5");
		expect(msg).toContain("Hypotheses: 0");
		expect(msg).toContain("Instrumented files: 0");
		expect(msg).toContain("Logs collected: 0");
	});

	it("omits confirmedHypothesis when not set", () => {
		const msg = buildDebugContextMessage(makeSession());
		expect(msg).not.toContain("Confirmed hypothesis");
	});

	it("includes confirmedHypothesis when set", () => {
		const msg = buildDebugContextMessage(makeSession({ confirmedHypothesis: 1 }));
		expect(msg).toContain("Confirmed hypothesis: #1");
	});

	it("omits description line when description is empty", () => {
		const msg = buildDebugContextMessage(makeSession({ description: "" }));
		expect(msg).not.toContain("Bug:");
	});
});
