/**
 * Tests for the /debug start command.
 *
 * Strategy:
 * - Pure functions (buildStartMessage, buildStartWidget) are tested directly
 * - performStart is tested with a real SessionStore + LogCollector in an
 *   isolated temp directory (ephemeral port 0)
 * - Tests verify: session created, collector started, profiles detected,
 *   rejection when active session exists, description handling, phase=understand
 *
 * Per TODO verifies:
 * - `/debug start checkout crash` → session created, collector listening
 * - `/debug start` again → rejected with clear message
 * - `/debug start` bare → session created with empty description
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SessionStore } from "../session-store.js";
import { LogCollector } from "../log-collector.js";
import { DEFAULTS } from "../config.js";
import {
	performStart,
	buildStartMessage,
	buildStartWidget,
} from "./start.js";
import type { StartCommandDeps, StartSummary } from "./start.js";
import type { DebugSession } from "../types.js";

// ── Test isolation ─────────────────────────────────────────────────────────

let tmpDir: string;
let store: SessionStore;
let collector: LogCollector;
let deps: StartCommandDeps;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-debugger-start-test-"));
	store = new SessionStore(tmpDir);
	collector = new LogCollector(tmpDir, 1000);
	deps = { store, collector, config: { ...DEFAULTS, port: 0 }, cwd: tmpDir };
});

afterEach(async () => {
	await collector.stop();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Write a package.json to make profile detection succeed. */
function writePackageJson(): void {
	fs.writeFileSync(path.join(tmpDir, "package.json"), '{"name":"test"}');
}

function makeSummary(overrides: Partial<StartSummary> = {}): StartSummary {
	return {
		sessionId: "abc12345",
		description: "Checkout crashes with 3 items",
		collectorPort: 19847,
		detectedProfiles: ["typescript"],
		hasProfiles: true,
		...overrides,
	};
}

// ── buildStartMessage ─────────────────────────────────────────────────────

describe("buildStartMessage", () => {
	it("includes session ID", () => {
		const result = buildStartMessage(makeSummary());
		expect(result).toContain("abc12345");
	});

	it("includes bug description when provided", () => {
		const result = buildStartMessage(makeSummary({ description: "Cart total wrong" }));
		expect(result).toContain("Bug: Cart total wrong");
	});

	it("prompts to describe the bug when no description", () => {
		const result = buildStartMessage(makeSummary({ description: "" }));
		expect(result).toContain("Describe the bug");
		expect(result).not.toContain("Bug:");
	});

	it("includes no warning when profiles detected", () => {
		const result = buildStartMessage(makeSummary({ hasProfiles: true }));
		expect(result).not.toContain("⚠");
	});

	it("warns when no profiles detected", () => {
		const result = buildStartMessage(makeSummary({ hasProfiles: false, detectedProfiles: [] }));
		expect(result).toContain("⚠");
		expect(result).toContain("No supported language");
		expect(result).toContain("package.json");
	});
});

// ── buildStartWidget ──────────────────────────────────────────────────────

describe("buildStartWidget", () => {
	function makeSession(overrides: Partial<DebugSession> = {}): DebugSession {
		return {
			id: "abc12345",
			description: "Checkout crash",
			status: "active",
			phase: "understand",
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

	it("includes session ID and phase", () => {
		const lines = buildStartWidget(makeSession());
		expect(lines[0]).toContain("abc12345");
		expect(lines[0]).toContain("understand");
	});

	it("includes iteration count", () => {
		const lines = buildStartWidget(makeSession({ iteration: 2 }));
		expect(lines.some((l) => l.includes("Iteration 2/5"))).toBe(true);
	});

	it("shows bug description when present", () => {
		const lines = buildStartWidget(makeSession({ description: "My bug" }));
		expect(lines.some((l) => l.includes("Bug: My bug"))).toBe(true);
	});

	it("shows analyzing state when no description", () => {
		const lines = buildStartWidget(makeSession({ description: "" }));
		expect(lines.some((l) => l.includes("Analyzing"))).toBe(true);
	});
});

// ── performStart ──────────────────────────────────────────────────────────

describe("performStart", () => {
	it("creates a session with the given description", async () => {
		writePackageJson();
		const summary = await performStart(deps, "Checkout crashes with 3 items");

		expect(summary.description).toBe("Checkout crashes with 3 items");
		const session = store.getActive();
		expect(session).toBeDefined();
		expect(session!.description).toBe("Checkout crashes with 3 items");
	});

	it("creates a session with empty description when no args", async () => {
		writePackageJson();
		const summary = await performStart(deps, "");

		expect(summary.description).toBe("");
		expect(store.getActive()!.description).toBe("");
	});

	it("trims whitespace from description", async () => {
		writePackageJson();
		const summary = await performStart(deps, "  spaced bug  ");
		// performStart receives already-trimmed args from the handler, but
		// the handler does args.trim(). Here we pass raw to verify store behavior.
		// The store stores whatever it's given.
		expect(summary.description).toBe("  spaced bug  ");
	});

	it("sets phase to understand", async () => {
		writePackageJson();
		await performStart(deps, "test");
		expect(store.getActive()!.phase).toBe("understand");
	});

	it("starts the log collector when not running", async () => {
		writePackageJson();
		expect(collector.isRunning).toBe(false);

		await performStart(deps, "test");

		expect(collector.isRunning).toBe(true);
	});

	it("does not restart collector when already running", async () => {
		writePackageJson();
		await collector.start(0);
		expect(collector.isRunning).toBe(true);
		const port = collector.listeningPort;

		await performStart(deps, "test");

		expect(collector.isRunning).toBe(true);
		// Port should be unchanged (not restarted)
		expect(collector.listeningPort).toBe(port);
	});

	it("includes collector port in summary", async () => {
		writePackageJson();
		const summary = await performStart(deps, "test");
		expect(summary.collectorPort).toBeGreaterThan(0);
		expect(summary.collectorPort).toBe(collector.listeningPort);
	});

	it("detects JS/TS profiles when package.json exists", async () => {
		writePackageJson();
		const summary = await performStart(deps, "test");
		expect(summary.hasProfiles).toBe(true);
		expect(summary.detectedProfiles).toContain("typescript");
	});

	it("reports no profiles when package.json missing", async () => {
		// No package.json written
		const summary = await performStart(deps, "test");
		expect(summary.hasProfiles).toBe(false);
		expect(summary.detectedProfiles).toEqual([]);
	});

	it("throws when a session is already active", async () => {
		writePackageJson();
		store.create("First session");

		await expect(performStart(deps, "second")).rejects.toThrow("already active");
	});

	it("includes the existing session ID in the rejection error", async () => {
		writePackageJson();
		const existing = store.create("First");

		await expect(performStart(deps, "second")).rejects.toThrow(existing.id);
	});

	it("rejects with cleanup/abort suggestion", async () => {
		writePackageJson();
		store.create("First");

		await expect(performStart(deps, "second")).rejects.toThrow("/debug cleanup");
	});

	it("includes session ID in summary", async () => {
		writePackageJson();
		const summary = await performStart(deps, "test");
		expect(summary.sessionId).toBe(store.getActive()!.id);
	});

	it("uses config maxIterations for the session", async () => {
		writePackageJson();
		deps.config.maxIterations = 8;
		await performStart(deps, "test");
		expect(store.getActive()!.maxIterations).toBe(8);
	});

	it("persists the session to disk", async () => {
		writePackageJson();
		const summary = await performStart(deps, "disk test");

		const store2 = new SessionStore(tmpDir);
		const loaded = store2.get(summary.sessionId);
		expect(loaded).toBeDefined();
		expect(loaded!.description).toBe("disk test");
		expect(loaded!.phase).toBe("understand");
	});
});
