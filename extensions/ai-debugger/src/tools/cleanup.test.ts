/**
 * Tests for the debug_cleanup tool.
 *
 * Strategy:
 * - Pure functions (removeInstrumentation, buildCleanupResult, formatDuration)
 *   are tested directly
 * - performCleanup is tested with real files in an isolated temp dir,
 *   simulating the full instrument → fix → cleanup lifecycle
 * - The execute function is tested via the tool factory
 *
 * Per TODO verifies:
 * - Instrument file → apply fix → cleanup → markers removed, fix code intact
 * - Cleanup with no instrumentation → no-op
 * - Session status = completed
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SessionStore } from "../session-store.js";
import { LogCollector } from "../log-collector.js";
import { DEFAULTS } from "../config.js";
import { insertInstrumentation } from "./instrument.js";
import {
	createCleanupTool,
	removeInstrumentation,
	buildCleanupResult,
	formatDuration,
	performCleanup,
} from "./cleanup.js";
import type { CleanupToolDeps, CleanupSummary, FileCleanupResult } from "./cleanup.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// ── Test isolation ─────────────────────────────────────────────────────────

let tmpDir: string;
let store: SessionStore;
let collector: LogCollector;
let deps: CleanupToolDeps;

beforeEach(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-debugger-cleanup-test-"));
	store = new SessionStore(tmpDir);
	collector = new LogCollector(tmpDir, 1000);
	await collector.start(0); // ephemeral port
	deps = { store, collector, cwd: tmpDir };
});

afterEach(async () => {
	await collector.stop();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Write a source file under tmpDir and return its relative path. */
function writeSource(relPath: string, content: string): string {
	const abs = path.join(tmpDir, relPath);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, content, "utf-8");
	return relPath;
}

/** Read a source file from tmpDir. */
function readSource(relPath: string): string {
	return fs.readFileSync(path.join(tmpDir, relPath), "utf-8");
}

/** Create a session with one instrumented file (simulating the instrument step). */
function setupInstrumentedSession(opts: {
	file?: string;
	content?: string;
	hypothesisId?: number;
	addFix?: boolean;
} = {}): string {
	const file = opts.file ?? "src/cart.ts";
	const originalContent = opts.content ?? "const a = 1;\nconst b = 2;\nconst c = 3;\n";
	writeSource(file, originalContent);

	const session = store.create("Test bug", DEFAULTS.maxIterations);

	// Simulate instrumentation: insert markers using insertInstrumentation
	const { content: instrumented, changes } = insertInstrumentation(originalContent, [
		{
			line: 1,
			block: [
				"// __AI_DEBUG_START__ session=" + session.id + " hypothesis=1",
				"fetch('http://localhost:19847/log').catch(()=>{});",
				"// __AI_DEBUG_END__",
			],
		},
	]);
	writeSource(file, instrumented);

	store.update(session.id, {
		phase: "instrument",
		hypotheses: [
			{
				id: opts.hypothesisId ?? 1,
				description: "Test hypothesis",
				confidence: "high",
				files: [file],
				instrumentationPlan: [],
				status: "instrumented",
			},
		],
	});
	store.addInstrumentedFile(session.id, {
		path: file,
		originalContent,
		changes,
	});

	if (opts.addFix) {
		store.addFix(session.id, {
			iteration: 1,
			hypothesisId: 1,
			files: [{ path: file, description: "Added null check" }],
			verified: false,
		});
	}

	return session.id;
}

/** A minimal mock ctx (cleanup doesn't use UI). */
function makeCtx(): ExtensionContext {
	return {} as ExtensionContext;
}

/** Build a marker block string for test content. */
function markerBlock(session: string, hypothesis: number, logLine = "log();"): string {
	return [
		`// __AI_DEBUG_START__ session=${session} hypothesis=${hypothesis}`,
		logLine,
		"// __AI_DEBUG_END__",
	].join("\n");
}

// ── removeInstrumentation ──────────────────────────────────────────────────

describe("removeInstrumentation", () => {
	it("removes a single marker block (inclusive)", () => {
		const content = [
			"line1",
			"// __AI_DEBUG_START__ session=s hypothesis=1",
			"fetch(...);",
			"// __AI_DEBUG_END__",
			"line5",
		].join("\n");
		const result = removeInstrumentation(content);
		expect(result.content).toBe("line1\nline5");
		expect(result.blocksRemoved).toBe(1);
	});

	it("removes multiple marker blocks", () => {
		const content = [
			"line1",
			"// __AI_DEBUG_START__ session=s hypothesis=1",
			"log1();",
			"// __AI_DEBUG_END__",
			"middle",
			"// __AI_DEBUG_START__ session=s hypothesis=2",
			"log2();",
			"// __AI_DEBUG_END__",
			"line9",
		].join("\n");
		const result = removeInstrumentation(content);
		expect(result.content).toBe("line1\nmiddle\nline9");
		expect(result.blocksRemoved).toBe(2);
	});

	it("preserves code between and around blocks (fix code intact)", () => {
		const content = [
			"const a = 1;",
			"// __AI_DEBUG_START__ session=s hypothesis=1",
			"fetch(...);",
			"// __AI_DEBUG_END__",
			"const fixed = a ?? 0; // this is the fix",
			"// __AI_DEBUG_START__ session=s hypothesis=1",
			"fetch(...);",
			"// __AI_DEBUG_END__",
			"return fixed;",
		].join("\n");
		const result = removeInstrumentation(content);
		expect(result.content).toBe("const a = 1;\nconst fixed = a ?? 0; // this is the fix\nreturn fixed;");
		expect(result.blocksRemoved).toBe(2);
	});

	it("returns content unchanged when no markers present", () => {
		const content = "just\nsome\ncode";
		const result = removeInstrumentation(content);
		expect(result.content).toBe(content);
		expect(result.blocksRemoved).toBe(0);
	});

	it("handles multi-line log calls between markers", () => {
		const content = [
			"// __AI_DEBUG_START__ session=s hypothesis=1",
			"const r = require('http').request(",
			"  'http://localhost:19847/log'",
			");",
			"// __AI_DEBUG_END__",
			"code",
		].join("\n");
		const result = removeInstrumentation(content);
		expect(result.content).toBe("code");
		expect(result.blocksRemoved).toBe(1);
	});

	it("removes from START to end of file when END is missing", () => {
		const content = [
			"line1",
			"// __AI_DEBUG_START__ session=s hypothesis=1",
			"log();",
		].join("\n");
		const result = removeInstrumentation(content);
		expect(result.content).toBe("line1");
		expect(result.blocksRemoved).toBe(1);
	});
});

// ── formatDuration ─────────────────────────────────────────────────────────

describe("formatDuration", () => {
	it("formats milliseconds", () => {
		expect(formatDuration(200)).toBe("200ms");
		expect(formatDuration(999)).toBe("999ms");
	});

	it("formats seconds", () => {
		expect(formatDuration(1000)).toBe("1s");
		expect(formatDuration(45000)).toBe("45s");
	});

	it("formats minutes with remaining seconds", () => {
		expect(formatDuration(90000)).toBe("1m 30s");
		expect(formatDuration(125000)).toBe("2m 5s");
	});

	it("formats whole minutes", () => {
		expect(formatDuration(60000)).toBe("1m");
		expect(formatDuration(120000)).toBe("2m");
	});
});

// ── buildCleanupResult ────────────────────────────────────────────────────

describe("buildCleanupResult", () => {
	function makeSummary(overrides: Partial<CleanupSummary> = {}): CleanupSummary {
		return {
			sessionId: "abc123",
			files: [
				{ file: "src/cart.ts", cleaned: true, blocksRemoved: 2 },
				{ file: "src/checkout.ts", cleaned: true, blocksRemoved: 1 },
			],
			totalBlocksRemoved: 3,
			logsCollected: 42,
			fixCount: 1,
			fixFiles: ["src/cart.ts"],
			durationMs: 95000,
			...overrides,
		};
	}

	it("includes session ID", () => {
		const result = buildCleanupResult(makeSummary());
		expect(result).toContain("abc123");
	});

	it("lists cleaned files with block counts", () => {
		const result = buildCleanupResult(makeSummary());
		expect(result).toContain("✓ src/cart.ts — 2 block(s)");
		expect(result).toContain("✓ src/checkout.ts — 1 block(s)");
	});

	it("includes total blocks removed", () => {
		const result = buildCleanupResult(makeSummary());
		expect(result).toContain("3 log block(s)");
	});

	it("includes logs collected count", () => {
		const result = buildCleanupResult(makeSummary());
		expect(result).toContain("Logs collected: 42");
	});

	it("includes fix count and fix files", () => {
		const result = buildCleanupResult(makeSummary());
		expect(result).toContain("Fixes retained: 1");
		expect(result).toContain("src/cart.ts");
	});

	it("includes duration", () => {
		const result = buildCleanupResult(makeSummary());
		expect(result).toContain("1m 35s");
	});

	it("shows 'already clean' when no files were cleaned", () => {
		const result = buildCleanupResult(makeSummary({
			files: [],
			totalBlocksRemoved: 0,
		}));
		expect(result).toContain("No instrumentation found");
	});

	it("lists skipped files with reason", () => {
		const result = buildCleanupResult(makeSummary({
			files: [
				{ file: "src/cart.ts", cleaned: true, blocksRemoved: 1 },
				{ file: "src/deleted.ts", cleaned: false, blocksRemoved: 0, skipped: "file not found (may have been deleted)" },
			],
		}));
		expect(result).toContain("⊘ src/deleted.ts");
		expect(result).toContain("file not found");
	});

	it("reports session completed", () => {
		const result = buildCleanupResult(makeSummary());
		expect(result).toContain("completed");
	});
});

// ── performCleanup ────────────────────────────────────────────────────────

describe("performCleanup", () => {
	it("throws when no active session", async () => {
		await expect(performCleanup(deps)).rejects.toThrow("No active debug session");
	});

	it("throws when session ID not found", async () => {
		await expect(performCleanup(deps, "nonexistent")).rejects.toThrow("Session not found");
	});

	it("removes instrumentation markers from files", async () => {
		const sessionId = setupInstrumentedSession({ file: "src/cart.ts" });
		expect(readSource("src/cart.ts")).toContain("__AI_DEBUG_START__");

		const summary = await performCleanup(deps);

		expect(summary.sessionId).toBe(sessionId);
		const cleaned = readSource("src/cart.ts");
		expect(cleaned).not.toContain("__AI_DEBUG_START__");
		expect(cleaned).not.toContain("__AI_DEBUG_END__");
		expect(cleaned).not.toContain("fetch(");
	});

	it("preserves fix code (non-marker lines)", async () => {
		// Simulate: instrument, then the LLM adds a fix line
		setupInstrumentedSession({ file: "src/cart.ts" });
		// Add fix code to the file (simulating LLM's edit)
		const current = readSource("src/cart.ts");
		const withFix = current.replace("const b = 2;", "const b = 2;\nconst fixed = a ?? 0; // FIX");
		writeSource("src/cart.ts", withFix);

		await performCleanup(deps);

		const cleaned = readSource("src/cart.ts");
		expect(cleaned).toContain("const fixed = a ?? 0; // FIX");
		expect(cleaned).not.toContain("__AI_DEBUG_START__");
	});

	it("records blocks removed in summary", async () => {
		setupInstrumentedSession({ file: "src/cart.ts" });
		const summary = await performCleanup(deps);
		expect(summary.totalBlocksRemoved).toBe(1);
		expect(summary.files[0].cleaned).toBe(true);
		expect(summary.files[0].blocksRemoved).toBe(1);
	});

	it("cleans multiple files", async () => {
		setupInstrumentedSession({ file: "src/cart.ts" });
		// Add a second instrumented file
		writeSource("src/checkout.ts", "const x = 1;\nconst y = 2;\n");
		const session = store.getActive()!;
		const checkoutInstrumented = insertInstrumentation("const x = 1;\nconst y = 2;\n", [
			{
				line: 1,
				block: [
					`// __AI_DEBUG_START__ session=${session.id} hypothesis=1`,
					"fetch(...);",
					"// __AI_DEBUG_END__",
				],
			},
		]);
		writeSource("src/checkout.ts", checkoutInstrumented.content);
		store.addInstrumentedFile(session.id, {
			path: "src/checkout.ts",
			originalContent: "const x = 1;\nconst y = 2;\n",
			changes: checkoutInstrumented.changes,
		});

		const summary = await performCleanup(deps);

		expect(summary.files).toHaveLength(2);
		expect(summary.files.every((f) => f.cleaned)).toBe(true);
		expect(readSource("src/cart.ts")).not.toContain("__AI_DEBUG_START__");
		expect(readSource("src/checkout.ts")).not.toContain("__AI_DEBUG_START__");
	});

	it("is a no-op when no instrumentation exists", async () => {
		const session = store.create("Clean bug");
		store.update(session.id, { phase: "verify" });

		const summary = await performCleanup(deps);

		expect(summary.totalBlocksRemoved).toBe(0);
		expect(summary.files).toHaveLength(0);
	});

	it("skips files that no longer exist", async () => {
		setupInstrumentedSession({ file: "src/cart.ts" });
		// Delete the file
		fs.unlinkSync(path.join(tmpDir, "src/cart.ts"));

		const summary = await performCleanup(deps);

		expect(summary.files).toHaveLength(1);
		expect(summary.files[0].cleaned).toBe(false);
		expect(summary.files[0].skipped).toContain("file not found");
	});

	it("skips files with no markers (already clean)", async () => {
		setupInstrumentedSession({ file: "src/cart.ts" });
		// Overwrite with clean content (e.g., user ran git checkout)
		writeSource("src/cart.ts", "const a = 1;\nconst b = 2;\n");

		const summary = await performCleanup(deps);

		expect(summary.files[0].cleaned).toBe(false);
		expect(summary.files[0].skipped).toContain("already clean");
	});

	it("stops the log collector", async () => {
		setupInstrumentedSession();
		expect(collector.isRunning).toBe(true);

		await performCleanup(deps);

		expect(collector.isRunning).toBe(false);
	});

	it("sets session status to completed", async () => {
		const sessionId = setupInstrumentedSession();
		await performCleanup(deps);

		// Active session is cleared, so load from disk
		const store2 = new SessionStore(tmpDir);
		const loaded = store2.get(sessionId);
		expect(loaded!.status).toBe("completed");
		expect(loaded!.phase).toBe("cleanup");
	});

	it("clears the active session reference", async () => {
		setupInstrumentedSession();
		expect(store.getActive()).toBeDefined();

		await performCleanup(deps);

		expect(store.getActive()).toBeUndefined();
	});

	it("includes logs collected and fix info in summary", async () => {
		const sessionId = setupInstrumentedSession({ addFix: true });
		// Simulate some logs
		store.update(sessionId, { logCount: 15 });

		const summary = await performCleanup(deps);

		expect(summary.logsCollected).toBe(15);
		expect(summary.fixCount).toBe(1);
		expect(summary.fixFiles).toContain("src/cart.ts");
	});

	it("includes duration in summary", async () => {
		const sessionId = setupInstrumentedSession();
		// Simulate a session that started 5 seconds ago
		const session = store.get(sessionId)!;
		const originalCreatedAt = session.createdAt;
		store.update(sessionId, { createdAt: Date.now() - 5000 });

		const summary = await performCleanup(deps);

		expect(summary.durationMs).toBeGreaterThanOrEqual(4000);
		expect(summary.durationMs).toBeLessThan(10000);
	});

	it("clears instrumentedFiles array after cleanup", async () => {
		const sessionId = setupInstrumentedSession();
		await performCleanup(deps);

		const store2 = new SessionStore(tmpDir);
		const loaded = store2.get(sessionId);
		expect(loaded!.instrumentedFiles).toEqual([]);
	});

	it("works with explicit sessionId parameter", async () => {
		const sessionId = setupInstrumentedSession();
		// Clear active (simulate session being non-active)
		store.clearActive();

		const summary = await performCleanup(deps, sessionId);

		expect(summary.sessionId).toBe(sessionId);
		expect(readSource("src/cart.ts")).not.toContain("__AI_DEBUG_START__");
	});
});

// ── createCleanupTool — execute ────────────────────────────────────────────

describe("createCleanupTool — execute", () => {
	it("throws when no active session", async () => {
		const tool = createCleanupTool(deps);
		await expect(
			tool.execute("call-1", {}, undefined, undefined, makeCtx()),
		).rejects.toThrow("No active debug session");
	});

	it("cleans up the active session by default", async () => {
		const sessionId = setupInstrumentedSession();
		const tool = createCleanupTool(deps);

		const result = await tool.execute("call-1", {}, undefined, undefined, makeCtx());

		expect(result.content[0].text).toContain("Cleanup complete");
		expect(result.content[0].text).toContain(sessionId);
		expect(readSource("src/cart.ts")).not.toContain("__AI_DEBUG_START__");
	});

	it("cleans up a specific session by ID", async () => {
		const sessionId = setupInstrumentedSession();
		store.clearActive();

		const tool = createCleanupTool(deps);
		const result = await tool.execute(
			"call-1", { sessionId }, undefined, undefined, makeCtx(),
		);

		expect(result.details.sessionId).toBe(sessionId);
	});

	it("returns structured details with full summary", async () => {
		setupInstrumentedSession({ addFix: true });
		const tool = createCleanupTool(deps);

		const result = await tool.execute("call-1", {}, undefined, undefined, makeCtx());

		expect(result.details.totalBlocksRemoved).toBe(1);
		expect(result.details.files).toHaveLength(1);
		expect(result.details.fixCount).toBe(1);
		expect(result.details.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("result text includes files cleaned, logs, fixes, duration", async () => {
		setupInstrumentedSession({ addFix: true });
		const tool = createCleanupTool(deps);

		const result = await tool.execute("call-1", {}, undefined, undefined, makeCtx());

		const text = result.content[0].text;
		expect(text).toContain("src/cart.ts");
		expect(text).toContain("Logs collected:");
		expect(text).toContain("Fixes retained:");
		expect(text).toContain("Duration:");
		expect(text).toContain("completed");
	});
});

// ── Full lifecycle: instrument → fix → cleanup ───────────────────────────

describe("full lifecycle: instrument → fix → cleanup", () => {
	it("removes all markers, preserves fix, completes session", async () => {
		const original = "function getTotal(cart) {\n  return cart.total;\n}\n";
		writeSource("src/cart.ts", original);

		// 1. Instrument
		const session = store.create("Cart total bug");
		const { content: instrumented, changes } = insertInstrumentation(original, [
			{
				line: 1,
				block: [
					`// __AI_DEBUG_START__ session=${session.id} hypothesis=1`,
					"fetch('http://localhost:19847/log').catch(()=>{});",
					"// __AI_DEBUG_END__",
				],
			},
		]);
		writeSource("src/cart.ts", instrumented);
		store.addInstrumentedFile(session.id, { path: "src/cart.ts", originalContent: original, changes });

		// 2. Apply fix (simulating the LLM's edit — adds a null check)
		const current = readSource("src/cart.ts");
		const withFix = current.replace(
			"return cart.total;",
			"return cart.total ?? 0; // FIX: guard against undefined",
		);
		writeSource("src/cart.ts", withFix);

		// 3. Cleanup
		const tool = createCleanupTool(deps);
		const result = await tool.execute("call-1", {}, undefined, undefined, makeCtx());

		// Verify: markers gone, fix intact
		const final = readSource("src/cart.ts");
		expect(final).not.toContain("__AI_DEBUG_START__");
		expect(final).not.toContain("__AI_DEBUG_END__");
		expect(final).not.toContain("fetch(");
		expect(final).toContain("return cart.total ?? 0; // FIX: guard against undefined");
		expect(final).toContain("function getTotal(cart) {");

		// Verify: session completed
		expect(result.details.sessionId).toBe(session.id);
		const store2 = new SessionStore(tmpDir);
		const loaded = store2.get(session.id);
		expect(loaded!.status).toBe("completed");
	});
});
