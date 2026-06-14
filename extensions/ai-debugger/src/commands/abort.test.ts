/**
 * Tests for the /debug abort command.
 *
 * Strategy:
 * - Pure functions (buildAbortConfirmationTitle, buildAbortConfirmationMessage,
 *   buildAbortNotification) are tested directly
 * - performAbort is tested with real files in an isolated temp dir, simulating
 *   the instrument → fix → abort lifecycle
 *
 * Per TODO verifies:
 * - Abort → all instrumented files restored to original content, collector
 *   stopped, session status = aborted
 * - Abort with no changes → clean no-op
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SessionStore } from "../session-store.js";
import { LogCollector } from "../log-collector.js";
import { DEFAULTS } from "../config.js";
import { insertInstrumentation } from "../tools/instrument.js";
import {
	buildAbortConfirmationTitle,
	buildAbortConfirmationMessage,
	buildAbortNotification,
	performAbort,
} from "./abort.js";
import type { AbortCommandDeps, AbortSummary } from "./abort.js";

// ── Test isolation ─────────────────────────────────────────────────────────

let tmpDir: string;
let store: SessionStore;
let collector: LogCollector;
let deps: AbortCommandDeps;

beforeEach(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-debugger-abort-test-"));
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

function writeSource(relPath: string, content: string): string {
	const abs = path.join(tmpDir, relPath);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, content, "utf-8");
	return relPath;
}

function readSource(relPath: string): string {
	return fs.readFileSync(path.join(tmpDir, relPath), "utf-8");
}

/** Create a session with one instrumented file (simulating instrument + fix). */
function setupSession(opts: {
	file?: string;
	originalContent?: string;
	addFix?: boolean;
} = {}): { sessionId: string; file: string; original: string } {
	const file = opts.file ?? "src/cart.ts";
	const original = opts.originalContent ?? "const a = 1;\nconst b = 2;\nconst c = 3;\n";
	writeSource(file, original);

	const session = store.create("Test bug", DEFAULTS.maxIterations);

	// Simulate instrumentation
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
	writeSource(file, instrumented);

	store.update(session.id, {
		phase: "observe",
		hypotheses: [
			{
				id: 1,
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
		originalContent: original,
		changes,
	});

	if (opts.addFix) {
		// Simulate LLM applying a fix AFTER instrumentation
		const withFix = readSource(file).replace("const b = 2;", "const b = 2;\nconst fixed = a ?? 0; // FIX");
		writeSource(file, withFix);
		store.addFix(session.id, {
			iteration: 1,
			hypothesisId: 1,
			files: [{ path: file, description: "Added null check" }],
			verified: false,
		});
	}

	return { sessionId: session.id, file, original };
}

function makeSummary(overrides: Partial<AbortSummary> = {}): AbortSummary {
	return {
		sessionId: "abc12345",
		files: [
			{ file: "src/cart.ts", reverted: true },
			{ file: "src/checkout.ts", reverted: true },
		],
		revertedCount: 2,
		...overrides,
	};
}

// ── buildAbortConfirmationTitle ────────────────────────────────────────────

describe("buildAbortConfirmationTitle", () => {
	it("includes session ID and warning emoji", () => {
		expect(buildAbortConfirmationTitle("abc123")).toBe("⚠️ Abort session abc123?");
	});

	it("includes a question mark", () => {
		expect(buildAbortConfirmationTitle("xyz")).toContain("?");
	});
});

// ── buildAbortConfirmationMessage ──────────────────────────────────────────

describe("buildAbortConfirmationMessage", () => {
	it("warns that ALL changes are reverted", () => {
		const msg = buildAbortConfirmationMessage();
		expect(msg).toContain("ALL changes");
		expect(msg).toContain("instrumentation");
		expect(msg).toContain("fixes");
	});

	it("mentions that session is aborted", () => {
		expect(buildAbortConfirmationMessage()).toContain("aborted");
	});
});

// ── buildAbortNotification ─────────────────────────────────────────────────

describe("buildAbortNotification", () => {
	it("includes ❌ emoji", () => {
		expect(buildAbortNotification(makeSummary())).toContain("❌");
	});

	it("includes session ID", () => {
		expect(buildAbortNotification(makeSummary())).toContain("abc12345");
	});

	it("includes reverted file count", () => {
		expect(buildAbortNotification(makeSummary())).toContain("2 files reverted");
	});

	it("uses singular 'file' for one reverted", () => {
		const result = buildAbortNotification(makeSummary({
			files: [{ file: "a.ts", reverted: true }],
			revertedCount: 1,
		}));
		expect(result).toContain("1 file reverted");
		expect(result).not.toContain("1 files");
	});

	it("uses 'no files needed reverting' for zero reverts", () => {
		const result = buildAbortNotification(makeSummary({
			files: [],
			revertedCount: 0,
		}));
		expect(result).toContain("No files needed reverting");
	});

	it("lists skipped files with reason", () => {
		const result = buildAbortNotification(makeSummary({
			files: [
				{ file: "a.ts", reverted: true },
				{ file: "deleted.ts", reverted: false, skipped: "file no longer exists" },
			],
			revertedCount: 1,
		}));
		expect(result).toContain("⚠ deleted.ts");
		expect(result).toContain("file no longer exists");
	});

	it("omits skipped warning when all files reverted", () => {
		const result = buildAbortNotification(makeSummary());
		expect(result).not.toContain("⚠");
	});
});

// ── performAbort ──────────────────────────────────────────────────────────

describe("performAbort", () => {
	it("throws when no active session", async () => {
		await expect(performAbort(deps)).rejects.toThrow("No active debug session");
	});

	it("restores instrumented files to original content", async () => {
		const { file, original } = setupSession();
		// File currently has instrumentation markers
		expect(readSource(file)).toContain("__AI_DEBUG_START__");

		await performAbort(deps);

		// File should be back to original
		expect(readSource(file)).toBe(original);
		expect(readSource(file)).not.toContain("__AI_DEBUG_START__");
	});

	it("reverts fixes applied after instrumentation", async () => {
		const { file, original } = setupSession({ addFix: true });
		// File has instrumentation + fix
		expect(readSource(file)).toContain("const fixed = a ?? 0; // FIX");

		await performAbort(deps);

		// Fix should be gone — reverted to pre-instrumentation original
		const content = readSource(file);
		expect(content).toBe(original);
		expect(content).not.toContain("const fixed = a ?? 0; // FIX");
		expect(content).not.toContain("__AI_DEBUG_START__");
	});

	it("stops the log collector", async () => {
		setupSession();
		expect(collector.isRunning).toBe(true);

		await performAbort(deps);

		expect(collector.isRunning).toBe(false);
	});

	it("sets session status to aborted", async () => {
		const { sessionId } = setupSession();
		await performAbort(deps);

		// Active session is cleared, so load from disk
		const store2 = new SessionStore(tmpDir);
		const loaded = store2.get(sessionId);
		expect(loaded!.status).toBe("aborted");
		expect(loaded!.phase).toBe("cleanup");
	});

	it("clears the active session reference", async () => {
		setupSession();
		expect(store.getActive()).toBeDefined();

		await performAbort(deps);

		expect(store.getActive()).toBeUndefined();
	});

	it("clears instrumentedFiles array after abort", async () => {
		const { sessionId } = setupSession();
		await performAbort(deps);

		const store2 = new SessionStore(tmpDir);
		const loaded = store2.get(sessionId);
		expect(loaded!.instrumentedFiles).toEqual([]);
	});

	it("reverts multiple files", async () => {
		// First file
		const { file: file1, original: original1 } = setupSession({ file: "src/cart.ts" });

		// Second file
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

		const summary = await performAbort(deps);

		expect(summary.revertedCount).toBe(2);
		expect(readSource("src/cart.ts")).toBe(original1);
		expect(readSource("src/checkout.ts")).toBe("const x = 1;\nconst y = 2;\n");
	});

	it("is a clean no-op when no instrumentation exists", async () => {
		const session = store.create("Clean bug");
		store.update(session.id, { phase: "understand" });

		const summary = await performAbort(deps);

		expect(summary.revertedCount).toBe(0);
		expect(summary.files).toHaveLength(0);
	});

	it("handles files that no longer exist (skipped, not reverted)", async () => {
		const { file } = setupSession();
		// Delete the file
		fs.unlinkSync(path.join(tmpDir, file));

		const summary = await performAbort(deps);

		expect(summary.revertedCount).toBe(0);
		expect(summary.files[0].reverted).toBe(false);
		expect(summary.files[0].skipped).toContain("no longer exists");
	});

	it("includes session ID in summary", async () => {
		const { sessionId } = setupSession();
		const summary = await performAbort(deps);
		expect(summary.sessionId).toBe(sessionId);
	});

	it("preserves fixes list in session record (for history)", async () => {
		const { sessionId } = setupSession({ addFix: true });
		await performAbort(deps);

		const store2 = new SessionStore(tmpDir);
		const loaded = store2.get(sessionId);
		// Fixes are kept in the record for history/audit, even though the
		// actual file changes are reverted
		expect(loaded!.fixes).toHaveLength(1);
	});
});
