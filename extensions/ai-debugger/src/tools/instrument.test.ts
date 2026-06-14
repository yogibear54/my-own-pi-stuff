/**
 * Tests for the debug_instrument tool.
 *
 * Strategy:
 * - Pure functions (insertInstrumentation, scanInstrumentedChanges,
 *   buildInstrumentationBlock, buildInstrumentResult) are tested directly
 * - The execute function is tested with real files in an isolated temp dir,
 *   using a real SessionStore + LogCollector (ephemeral port 0)
 * - Integration tests verify the generated code actually executes and POSTs
 *   to the collector (strongest verification that instrumentation is valid)
 *
 * Per TODO verifies:
 * - Instrument a .ts file → markers present, fetch() call valid, InstrumentedFile recorded
 * - Instrument 3 files where 1 fails → 2 succeed with warning
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SessionStore } from "../session-store.js";
import { LogCollector } from "../log-collector.js";
import { DEFAULTS } from "../config.js";
import { TypeScriptProfile } from "../language-profiles/index.js";
import type { InstrumentationEnvelope } from "../language-profiles/index.js";
import type { DebugLogEntry } from "../types.js";
import {
	createInstrumentTool,
	insertInstrumentation,
	scanInstrumentedChanges,
	buildInstrumentationBlock,
	buildInstrumentResult,
} from "./instrument.js";
import type {
	InstrumentParams,
	InstrumentToolDeps,
	InstrumentationPlanItem,
	InsertionEntry,
} from "./instrument.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// ── Test isolation ─────────────────────────────────────────────────────────

let tmpDir: string;
let store: SessionStore;
let collector: LogCollector;
let deps: InstrumentToolDeps;

beforeEach(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-debugger-instr-test-"));
	store = new SessionStore(tmpDir);
	collector = new LogCollector(tmpDir, 100);
	await collector.start(0); // ephemeral port
	deps = { store, collector, config: { ...DEFAULTS, port: 0 }, cwd: tmpDir };
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

/** Create a session with hypotheses and return the first hypothesis ID. */
function setupSession(hypothesisId = 1): string {
	const session = store.create("Test bug");
	store.update(session.id, {
		phase: "hypothesize",
		hypotheses: [
			{
				id: hypothesisId,
				description: "Test hypothesis",
				confidence: "high",
				files: ["src/cart.ts"],
				instrumentationPlan: [],
				status: "pending",
			},
		],
	});
	return session.id;
}

function makePlanItem(overrides: Partial<InstrumentationPlanItem> = {}): InstrumentationPlanItem {
	return {
		file: "src/cart.ts",
		location: { line: 2 },
		whatToLog: "cart_state",
		data: "{ items: cart.items.length }",
		...overrides,
	};
}

function makeParams(overrides: Partial<InstrumentParams> = {}): InstrumentParams {
	return {
		hypothesisId: 1,
		instrumentationPlan: [makePlanItem()],
		...overrides,
	};
}

/** A minimal mock ctx (instrument doesn't use UI). */
function makeCtx(): ExtensionContext {
	return {} as ExtensionContext;
}

/** Resolve when the collector receives a log entry. */
function waitForLog(timeoutMs = 1000): Promise<DebugLogEntry> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Timed out waiting for log")), timeoutMs);
		collector.once("log", (entry: DebugLogEntry) => {
			clearTimeout(timer);
			resolve(entry);
		});
	});
}

// ── insertInstrumentation ──────────────────────────────────────────────────

describe("insertInstrumentation", () => {
	it("inserts a block after the specified line", () => {
		const content = "line1\nline2\nline3";
		const entries: InsertionEntry[] = [
			{ line: 1, block: ["// MARK_A", "console.log('a');", "// END_A"] },
		];
		const result = insertInstrumentation(content, entries);
		const lines = result.content.split("\n");
		expect(lines[1]).toBe("// MARK_A");
		expect(lines[2]).toBe("console.log('a');");
		expect(lines[3]).toBe("// END_A");
	});

	it("inserts multiple blocks bottom-up (line numbers don't shift)", () => {
		const content = "a\nb\nc\nd";
		const entries: InsertionEntry[] = [
			{ line: 1, block: ["// S1", "log1();", "// E1"] },
			{ line: 3, block: ["// S2", "log2();", "// E2"] },
		];
		const result = insertInstrumentation(content, entries);
		const lines = result.content.split("\n");
		// Expected order: a, S1, log1, E1, b, c, S2, log2, E2, d
		expect(lines).toEqual(["a", "// S1", "log1();", "// E1", "b", "c", "// S2", "log2();", "// E2", "d"]);
	});

	it("returns empty changes for no entries", () => {
		const result = insertInstrumentation("content", []);
		expect(result.content).toBe("content");
		expect(result.changes).toEqual([]);
	});

	it("clamps line beyond file length to end", () => {
		const content = "a\nb";
		const entries: InsertionEntry[] = [
			{ line: 100, block: ["// S", "log();", "// E"] },
		];
		const result = insertInstrumentation(content, entries);
		// Should insert at the end (after line 2)
		const lines = result.content.split("\n");
		expect(lines).toEqual(["a", "b", "// S", "log();", "// E"]);
	});

	it("clamps negative line to top of file", () => {
		const content = "a\nb";
		const entries: InsertionEntry[] = [
			{ line: -5, block: ["// S", "log();", "// E"] },
		];
		const result = insertInstrumentation(content, entries);
		const lines = result.content.split("\n");
		expect(lines).toEqual(["// S", "log();", "// E", "a", "b"]);
	});

	it("records changes via marker scanning", () => {
		const content = "a\nb\nc";
		// Use real markers so scanInstrumentedChanges finds them
		const entries: InsertionEntry[] = [
			{
				line: 1,
				block: [
					"// __AI_DEBUG_START__ session=sess hypothesis=1",
					"fetch('http://localhost:19847/log').catch(()=>{});",
					"// __AI_DEBUG_END__",
				],
			},
		];
		const result = insertInstrumentation(content, entries);
		expect(result.changes).toHaveLength(1);
		expect(result.changes[0].lineStart).toBe(2);
		expect(result.changes[0].lineEnd).toBe(4);
		expect(result.changes[0].hypothesisId).toBe(1);
	});

	it("records multiple changes in correct order", () => {
		const content = "a\nb\nc\nd";
		const entries: InsertionEntry[] = [
			{
				line: 1,
				block: [
					"// __AI_DEBUG_START__ session=sess hypothesis=1",
					"log1();",
					"// __AI_DEBUG_END__",
				],
			},
			{
				line: 3,
				block: [
					"// __AI_DEBUG_START__ session=sess hypothesis=2",
					"log2();",
					"// __AI_DEBUG_END__",
				],
			},
		];
		const result = insertInstrumentation(content, entries);
		expect(result.changes).toHaveLength(2);
		// Sorted by lineStart ascending
		expect(result.changes[0].lineStart).toBeLessThan(result.changes[1].lineStart);
		expect(result.changes[0].hypothesisId).toBe(1);
		expect(result.changes[1].hypothesisId).toBe(2);
	});
});

// ── scanInstrumentedChanges ────────────────────────────────────────────────

describe("scanInstrumentedChanges", () => {
	it("finds a single marker pair", () => {
		const content = [
			"const a = 1;",
			"// __AI_DEBUG_START__ session=abc hypothesis=1",
			"fetch(...);",
			"// __AI_DEBUG_END__",
			"const b = 2;",
		].join("\n");
		const changes = scanInstrumentedChanges(content);
		expect(changes).toHaveLength(1);
		expect(changes[0].lineStart).toBe(2);
		expect(changes[0].lineEnd).toBe(4);
		expect(changes[0].hypothesisId).toBe(1);
		expect(changes[0].marker).toContain("__AI_DEBUG_START__");
	});

	it("finds multiple marker pairs", () => {
		const content = [
			"// __AI_DEBUG_START__ session=abc hypothesis=1",
			"log1();",
			"// __AI_DEBUG_END__",
			"other code",
			"// __AI_DEBUG_START__ session=abc hypothesis=2",
			"log2();",
			"// __AI_DEBUG_END__",
		].join("\n");
		const changes = scanInstrumentedChanges(content);
		expect(changes).toHaveLength(2);
		expect(changes[0].hypothesisId).toBe(1);
		expect(changes[1].hypothesisId).toBe(2);
	});

	it("returns empty for content with no markers", () => {
		expect(scanInstrumentedChanges("no markers here")).toEqual([]);
	});

	it("returns empty for content with no markers at all", () => {
		expect(scanInstrumentedChanges("just\nsome\ncode")).toEqual([]);
	});

	it("handles multi-line log calls between markers", () => {
		const content = [
			"// __AI_DEBUG_START__ session=abc hypothesis=3",
			"const r = require('http').request(",
			"  'http://localhost:19847/log'",
			");",
			"// __AI_DEBUG_END__",
		].join("\n");
		const changes = scanInstrumentedChanges(content);
		expect(changes).toHaveLength(1);
		expect(changes[0].lineStart).toBe(1);
		expect(changes[0].lineEnd).toBe(5);
	});
});

// ── buildInstrumentationBlock ──────────────────────────────────────────────

describe("buildInstrumentationBlock", () => {
	it("produces marker start, log call, marker end", () => {
		const envelope: InstrumentationEnvelope = {
			session: "abc",
			hypothesis: 1,
			file: "src/cart.ts",
			line: 42,
			level: "info",
			tag: "cart_state",
			port: 19847,
			data: "{ items: 3 }",
		};
		const block = buildInstrumentationBlock(TypeScriptProfile, envelope);
		expect(block).toHaveLength(3);
		expect(block[0]).toContain("__AI_DEBUG_START__");
		expect(block[1]).toContain("fetch(");
		expect(block[2]).toContain("__AI_DEBUG_END__");
	});
});

// ── buildInstrumentResult ──────────────────────────────────────────────────

describe("buildInstrumentResult", () => {
	it("lists successful files with change counts", () => {
		const result = buildInstrumentResult("sess", 1, [
			{ file: "a.ts", success: true, changeCount: 2 },
			{ file: "b.ts", success: true, changeCount: 1 },
		]);
		expect(result).toContain("Instrumented 2 file(s)");
		expect(result).toContain("✓ a.ts — 2 log point(s)");
		expect(result).toContain("✓ b.ts — 1 log point(s)");
	});

	it("lists failed files with errors", () => {
		const result = buildInstrumentResult("sess", 1, [
			{ file: "a.ts", success: true, changeCount: 1 },
			{ file: "missing.ts", success: false, error: "File not found" },
		]);
		expect(result).toContain("✗ missing.ts — File not found");
		expect(result).toContain("⚠ 1 file(s) failed");
	});

	it("includes next-step guidance", () => {
		const result = buildInstrumentResult("sess", 1, []);
		expect(result).toContain("debug_logs");
		expect(result).toContain("observe");
	});

	it("includes session ID and hypothesis ID", () => {
		const result = buildInstrumentResult("mysess", 7, []);
		expect(result).toContain("mysess");
		expect(result).toContain("#7");
	});
});

// ── createInstrumentTool — execute ─────────────────────────────────────────

describe("createInstrumentTool — execute", () => {
	it("throws when no active session", async () => {
		const tool = createInstrumentTool(deps);
		await expect(
			tool.execute("call-1", makeParams(), undefined, undefined, makeCtx()),
		).rejects.toThrow("No active debug session");
	});

	it("throws when hypothesis ID not found", async () => {
		setupSession(1);
		const tool = createInstrumentTool(deps);
		await expect(
			tool.execute("call-1", makeParams({ hypothesisId: 99 }), undefined, undefined, makeCtx()),
		).rejects.toThrow("Hypothesis #99 not found");
	});

	it("throws on empty instrumentation plan", async () => {
		setupSession(1);
		const tool = createInstrumentTool(deps);
		await expect(
			tool.execute("call-1", makeParams({ instrumentationPlan: [] }), undefined, undefined, makeCtx()),
		).rejects.toThrow("at least one item");
	});

	it("instruments a .ts file with markers and fetch call", async () => {
		setupSession(1);
		writeSource("src/cart.ts", "const a = 1;\nconst b = 2;\nconst c = 3;\n");

		const tool = createInstrumentTool(deps);
		const result = await tool.execute(
			"call-1", makeParams(), undefined, undefined, makeCtx(),
		);

		expect(result.content[0].text).toContain("Instrumented 1 file(s)");

		// Read the modified file and verify markers + fetch call
		const modified = fs.readFileSync(path.join(tmpDir, "src/cart.ts"), "utf-8");
		expect(modified).toContain("__AI_DEBUG_START__");
		expect(modified).toContain("fetch(");
		expect(modified).toContain("__AI_DEBUG_END__");
		expect(modified).toContain("http://localhost:");
		expect(modified).toContain("/log");
	});

	it("records InstrumentedFile in session", async () => {
		setupSession(1);
		writeSource("src/cart.ts", "const a = 1;\nconst b = 2;\n");

		const tool = createInstrumentTool(deps);
		await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx());

		const session = store.getActive()!;
		expect(session.instrumentedFiles).toHaveLength(1);
		expect(session.instrumentedFiles[0].path).toBe("src/cart.ts");
		expect(session.instrumentedFiles[0].originalContent).toContain("const a = 1;");
		expect(session.instrumentedFiles[0].changes).toHaveLength(1);
		expect(session.instrumentedFiles[0].changes[0].hypothesisId).toBe(1);
	});

	it("sets phase to observe", async () => {
		setupSession(1);
		writeSource("src/cart.ts", "const a = 1;\nconst b = 2;\n");

		const tool = createInstrumentTool(deps);
		await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx());

		expect(store.getActive()!.phase).toBe("observe");
	});

	it("sets hypothesis status to instrumented", async () => {
		setupSession(1);
		writeSource("src/cart.ts", "const a = 1;\nconst b = 2;\n");

		const tool = createInstrumentTool(deps);
		await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx());

		const hyp = store.getActive()!.hypotheses.find((h) => h.id === 1);
		expect(hyp!.status).toBe("instrumented");
	});

	it("starts the collector when not running", async () => {
		await collector.stop();
		expect(collector.isRunning).toBe(false);

		setupSession(1);
		writeSource("src/cart.ts", "const a = 1;\n");

		const tool = createInstrumentTool(deps);
		await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx());

		expect(collector.isRunning).toBe(true);
	});

	it("uses the collector's actual listening port in generated code", async () => {
		setupSession(1);
		writeSource("src/cart.ts", "const a = 1;\n");

		const tool = createInstrumentTool(deps);
		await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx());

		const modified = fs.readFileSync(path.join(tmpDir, "src/cart.ts"), "utf-8");
		expect(modified).toContain(`localhost:${collector.listeningPort}`);
	});

	it("embeds the data JS source verbatim in the log call", async () => {
		setupSession(1);
		writeSource("src/cart.ts", "const a = 1;\n");

		const tool = createInstrumentTool(deps);
		await tool.execute(
			"call-1",
			makeParams({
				instrumentationPlan: [
					makePlanItem({ data: "{ items: cart.items.length, total: cart.total }" }),
				],
			}),
			undefined, undefined, makeCtx(),
		);

		const modified = fs.readFileSync(path.join(tmpDir, "src/cart.ts"), "utf-8");
		expect(modified).toContain("data: { items: cart.items.length, total: cart.total }");
	});

	it("uses whatToLog as the tag in the generated code", async () => {
		setupSession(1);
		writeSource("src/cart.ts", "const a = 1;\n");

		const tool = createInstrumentTool(deps);
		await tool.execute(
			"call-1",
			makeParams({
				instrumentationPlan: [makePlanItem({ whatToLog: "checkout_state" })],
			}),
			undefined, undefined, makeCtx(),
		);

		const modified = fs.readFileSync(path.join(tmpDir, "src/cart.ts"), "utf-8");
		expect(modified).toContain('tag: "checkout_state"');
	});

	it("inserts instrumentation after the specified line", async () => {
		setupSession(1);
		writeSource("src/cart.ts", "line1\nline2\nline3\n");

		const tool = createInstrumentTool(deps);
		await tool.execute(
			"call-1",
			makeParams({
				instrumentationPlan: [makePlanItem({ location: { line: 2 } })],
			}),
			undefined, undefined, makeCtx(),
		);

		const lines = fs.readFileSync(path.join(tmpDir, "src/cart.ts"), "utf-8").split("\n");
		// Instrumentation should be after line 2 (0-indexed: lines[1])
		expect(lines[0]).toBe("line1");
		expect(lines[1]).toBe("line2");
		expect(lines[2]).toContain("__AI_DEBUG_START__");
		expect(lines[3]).toContain("fetch(");
		expect(lines[4]).toContain("__AI_DEBUG_END__");
		expect(lines[5]).toBe("line3");
	});

	it("instruments multiple locations in one file (bottom-up)", async () => {
		setupSession(1);
		writeSource("src/cart.ts", "a\nb\nc\nd\ne\n");

		const tool = createInstrumentTool(deps);
		await tool.execute(
			"call-1",
			makeParams({
				instrumentationPlan: [
					makePlanItem({ location: { line: 1 }, whatToLog: "first" }),
					makePlanItem({ location: { line: 4 }, whatToLog: "fourth" }),
				],
			}),
			undefined, undefined, makeCtx(),
		);

		const modified = fs.readFileSync(path.join(tmpDir, "src/cart.ts"), "utf-8");
		const changes = scanInstrumentedChanges(modified);
		expect(changes).toHaveLength(2);
		// Both markers present
		expect(modified).toContain('tag: "first"');
		expect(modified).toContain('tag: "fourth"');
	});
});

// ── createInstrumentTool — partial failure ────────────────────────────────

describe("createInstrumentTool — partial failure", () => {
	it("instruments 2 of 3 files and warns about the failure", async () => {
		setupSession(1);
		writeSource("src/a.ts", "const a = 1;\n");
		writeSource("src/b.ts", "const b = 2;\n");
		// src/c.ts does NOT exist

		const tool = createInstrumentTool(deps);
		const result = await tool.execute(
			"call-1",
			makeParams({
				instrumentationPlan: [
					makePlanItem({ file: "src/a.ts", location: { line: 1 } }),
					makePlanItem({ file: "src/b.ts", location: { line: 1 } }),
					makePlanItem({ file: "src/c.ts", location: { line: 1 } }),
				],
			}),
			undefined, undefined, makeCtx(),
		);

		// Result text shows 2 successes + 1 failure
		expect(result.content[0].text).toContain("Instrumented 2 file(s)");
		expect(result.content[0].text).toContain("✓ src/a.ts");
		expect(result.content[0].text).toContain("✓ src/b.ts");
		expect(result.content[0].text).toContain("✗ src/c.ts — File not found");
		expect(result.content[0].text).toContain("⚠ 1 file(s) failed");

		// Session records only the 2 successful files
		expect(store.getActive()!.instrumentedFiles).toHaveLength(2);
	});

	it("fails for unsupported file types", async () => {
		setupSession(1);
		writeSource("src/data.txt", "some text\n");

		const tool = createInstrumentTool(deps);
		const result = await tool.execute(
			"call-1",
			makeParams({
				instrumentationPlan: [
					makePlanItem({ file: "src/data.txt", location: { line: 1 } }),
				],
			}),
			undefined, undefined, makeCtx(),
		);

		expect(result.content[0].text).toContain("✗ src/data.txt");
		expect(result.content[0].text).toContain("Unsupported file type");
		expect(store.getActive()!.instrumentedFiles).toHaveLength(0);
	});

	it("fails when no line number provided", async () => {
		setupSession(1);
		writeSource("src/cart.ts", "const a = 1;\n");

		const tool = createInstrumentTool(deps);
		const result = await tool.execute(
			"call-1",
			makeParams({
				instrumentationPlan: [
					makePlanItem({ location: { function: "addToCart" } }),
				],
			}),
			undefined, undefined, makeCtx(),
		);

		expect(result.content[0].text).toContain("✗ src/cart.ts");
		expect(result.content[0].text).toContain("No line numbers");
		expect(store.getActive()!.instrumentedFiles).toHaveLength(0);
	});

	it("does not set phase to observe when all files fail", async () => {
		setupSession(1);
		writeSource("src/data.txt", "text\n"); // unsupported

		const tool = createInstrumentTool(deps);
		await tool.execute(
			"call-1",
			makeParams({
				instrumentationPlan: [makePlanItem({ file: "src/data.txt", location: { line: 1 } })],
			}),
			undefined, undefined, makeCtx(),
		);

		// Phase stays as hypothesize (not observe) since nothing succeeded
		expect(store.getActive()!.phase).toBe("hypothesize");
	});
});

// ── Integration: generated code actually runs and POSTs ───────────────────

describe("createInstrumentTool — integration (instrumented code POSTs to collector)", () => {
	it("generated fetch call POSTs a valid log entry", async () => {
		setupSession(1);
		writeSource("src/cart.ts", "const cart = { items: [1, 2, 3], total: 60 };\n");

		const sessionId = store.getActive()!.id;
		const tool = createInstrumentTool(deps);
		await tool.execute(
			"call-1",
			makeParams({
				instrumentationPlan: [
					makePlanItem({
						location: { line: 1 },
						data: "{ items: cart.items.length, total: cart.total }",
					}),
				],
			}),
			undefined, undefined, makeCtx(),
		);

		// Extract the generated fetch call and execute it
		const modified = fs.readFileSync(path.join(tmpDir, "src/cart.ts"), "utf-8");
		const fetchLine = modified.split("\n").find((l) => l.includes("fetch("));
		expect(fetchLine).toBeDefined();

		// Execute the fetch call with `cart` in scope
		const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
		const fn = new AsyncFunction("cart", fetchLine!);
		const done = waitForLog();
		await fn({ items: [1, 2, 3], total: 60 });

		const entry = await done;
		expect(entry.session).toBe(sessionId);
		expect(entry.hypothesis).toBe(1);
		expect(entry.file).toBe("src/cart.ts");
		expect(entry.tag).toBe("cart_state");
		expect(entry.data).toEqual({ items: 3, total: 60 });
	});
});

// ── Disk persistence ──────────────────────────────────────────────────────

describe("createInstrumentTool — disk persistence", () => {
	it("persists instrumented files to session on disk", async () => {
		setupSession(1);
		writeSource("src/cart.ts", "const a = 1;\n");

		const tool = createInstrumentTool(deps);
		await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx());

		const sessionId = store.getActive()!.id;
		// Fresh store loads from disk
		const store2 = new SessionStore(tmpDir);
		const loaded = store2.get(sessionId);
		expect(loaded!.instrumentedFiles).toHaveLength(1);
		expect(loaded!.instrumentedFiles[0].path).toBe("src/cart.ts");
		expect(loaded!.instrumentedFiles[0].changes).toHaveLength(1);
		expect(loaded!.phase).toBe("observe");
	});
});
