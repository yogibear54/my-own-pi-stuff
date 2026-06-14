/**
 * Tests for the debug_hypothesize tool.
 *
 * Strategy:
 * - Pure functions (toHypotheses, format*, buildHypothesizeResult) are tested directly
 * - The execute function is tested with a real SessionStore + LogCollector in an isolated
 *   temp directory, using a mock ctx with a controllable ui.select
 * - Collector uses port 0 (ephemeral) to avoid conflicts across parallel tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SessionStore } from "../session-store.js";
import { LogCollector } from "../log-collector.js";
import { DEFAULTS } from "../config.js";
import {
	createHypothesizeTool,
	toHypotheses,
	formatHypothesisForDisplay,
	formatHypothesisOptions,
	buildHypothesizeResult,
} from "./hypothesize.js";
import type { HypothesisInput, HypothesizeParams, HypothesizeToolDeps } from "./hypothesize.js";
import type { Hypothesis } from "../types.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// ── Test isolation ─────────────────────────────────────────────────────────

let tmpDir: string;
let store: SessionStore;
let collector: LogCollector;
let deps: HypothesizeToolDeps;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-debugger-hyp-test-"));
	store = new SessionStore(tmpDir);
	collector = new LogCollector(tmpDir, 100);
	// port 0 = ephemeral, avoids conflicts across parallel test runs
	deps = { store, collector, config: { ...DEFAULTS, port: 0 } };
});

afterEach(async () => {
	await collector.stop();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────────────────────────────

function makeHypothesisInput(overrides: Partial<HypothesisInput> = {}): HypothesisInput {
	return {
		description: "Race condition in cart.update()",
		confidence: "high",
		files: ["src/cart.ts"],
		instrumentationPlan: [
			{
				file: "src/cart.ts",
				locations: [{ function: "update", whatToLog: "cart state before and after update" }],
			},
		],
		...overrides,
	};
}

function makeParams(overrides: Partial<HypothesizeParams> = {}): HypothesizeParams {
	return {
		bugDescription: "Checkout crashes with 3 items",
		context: "TypeError: Cannot read property 'price' of undefined",
		hypotheses: [
			makeHypothesisInput(),
			makeHypothesisInput({
				description: "Null item in cart array",
				confidence: "medium",
				files: ["src/checkout.ts"],
				instrumentationPlan: [
					{
						file: "src/checkout.ts",
						locations: [{ line: 42, whatToLog: "each item's price" }],
					},
				],
			}),
		],
		...overrides,
	};
}

/** Build a mock ExtensionContext with a controllable ui.select. */
function makeCtx(opts: { selectIndex?: number; hasUI?: boolean } = {}): ExtensionContext {
	const { selectIndex, hasUI = true } = opts;
	return {
		hasUI,
		ui: {
			select: async (_title: string, options: string[]) => {
				if (selectIndex === undefined) return undefined;
				return options[selectIndex];
			},
			confirm: async () => false,
			input: async () => undefined,
			notify: () => {},
		},
	} as unknown as ExtensionContext;
}

// ── toHypotheses ───────────────────────────────────────────────────────────

describe("toHypotheses", () => {
	it("assigns sequential 1-indexed IDs", () => {
		const result = toHypotheses([
			makeHypothesisInput(),
			makeHypothesisInput({ description: "Second" }),
			makeHypothesisInput({ description: "Third" }),
		]);
		expect(result.map((h) => h.id)).toEqual([1, 2, 3]);
	});

	it("sets status to pending", () => {
		const result = toHypotheses([makeHypothesisInput()]);
		expect(result[0].status).toBe("pending");
	});

	it("preserves description, confidence, files, and instrumentationPlan", () => {
		const input = makeHypothesisInput({
			description: "Off-by-one in loop",
			confidence: "low",
			files: ["a.ts", "b.ts"],
			instrumentationPlan: [
				{ file: "a.ts", locations: [{ line: 10, whatToLog: "loop counter" }] },
			],
		});
		const [result] = toHypotheses([input]);
		expect(result.description).toBe("Off-by-one in loop");
		expect(result.confidence).toBe("low");
		expect(result.files).toEqual(["a.ts", "b.ts"]);
		expect(result.instrumentationPlan).toEqual(input.instrumentationPlan);
	});

	it("returns empty array for empty input", () => {
		expect(toHypotheses([])).toEqual([]);
	});
});

// ── formatHypothesisForDisplay ─────────────────────────────────────────────

describe("formatHypothesisForDisplay", () => {
	it("includes id, confidence, description, and files", () => {
		const h: Hypothesis = {
			id: 1,
			description: "Race condition",
			confidence: "high",
			files: ["src/cart.ts"],
			instrumentationPlan: [],
			status: "pending",
		};
		const result = formatHypothesisForDisplay(h);
		expect(result).toBe("#1 [high] Race condition (src/cart.ts)");
	});

	it("joins multiple files with comma", () => {
		const h: Hypothesis = {
			id: 2,
			description: "Bug",
			confidence: "medium",
			files: ["a.ts", "b.ts", "c.ts"],
			instrumentationPlan: [],
			status: "pending",
		};
		expect(formatHypothesisForDisplay(h)).toContain("a.ts, b.ts, c.ts");
	});

	it("shows 'no files' when files array is empty", () => {
		const h: Hypothesis = {
			id: 3,
			description: "Mystery bug",
			confidence: "low",
			files: [],
			instrumentationPlan: [],
			status: "pending",
		};
		expect(formatHypothesisForDisplay(h)).toContain("(no files)");
	});
});

// ── formatHypothesisOptions ────────────────────────────────────────────────

describe("formatHypothesisOptions", () => {
	it("returns one string per hypothesis", () => {
		const hypotheses = toHypotheses([makeHypothesisInput(), makeHypothesisInput()]);
		const options = formatHypothesisOptions(hypotheses);
		expect(options).toHaveLength(2);
		expect(options[0]).toContain("#1");
		expect(options[1]).toContain("#2");
	});

	it("returns empty array for no hypotheses", () => {
		expect(formatHypothesisOptions([])).toEqual([]);
	});
});

// ── buildHypothesizeResult ─────────────────────────────────────────────────

describe("buildHypothesizeResult", () => {
	const hypotheses: Hypothesis[] = [
		{
			id: 1,
			description: "Race condition in cart.update()",
			confidence: "high",
			files: ["src/cart.ts"],
			instrumentationPlan: [
				{ file: "src/cart.ts", locations: [{ function: "update", whatToLog: "cart state" }] },
			],
			status: "pending",
		},
		{
			id: 2,
			description: "Null item in cart array",
			confidence: "medium",
			files: ["src/checkout.ts"],
			instrumentationPlan: [
				{ file: "src/checkout.ts", locations: [{ line: 42, whatToLog: "item price" }] },
			],
			status: "pending",
		},
	];

	it("includes session ID", () => {
		const result = buildHypothesizeResult("abc123", hypotheses);
		expect(result).toContain("abc123");
	});

	it("includes each hypothesis with id, confidence, and description", () => {
		const result = buildHypothesizeResult("abc123", hypotheses);
		expect(result).toContain("#1 [high] Race condition in cart.update()");
		expect(result).toContain("#2 [medium] Null item in cart array");
	});

	it("includes instrumentation plan details", () => {
		const result = buildHypothesizeResult("abc123", hypotheses);
		expect(result).toContain("src/cart.ts @ update: cart state");
		expect(result).toContain("src/checkout.ts @ line 42: item price");
	});

	it("marks selected hypothesis with star", () => {
		const result = buildHypothesizeResult("abc123", hypotheses, 2);
		expect(result).toContain("#2 [medium] Null item in cart array ★ (user selected)");
		expect(result).not.toContain("#1 [high] ★");
	});

	it("includes debug_instrument guidance with selected ID", () => {
		const result = buildHypothesizeResult("abc123", hypotheses, 1);
		expect(result).toContain("debug_instrument with hypothesisId: 1");
	});

	it("includes generic guidance when no selection", () => {
		const result = buildHypothesizeResult("abc123", hypotheses);
		expect(result).toContain("debug_instrument");
		expect(result).not.toContain("hypothesisId:");
	});
});

// ── createHypothesizeTool — execute ────────────────────────────────────────

describe("createHypothesizeTool — execute", () => {
	it("creates a session when none exists", async () => {
		const tool = createHypothesizeTool(deps);
		expect(store.getActive()).toBeUndefined();

		await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx({ selectIndex: 0 }));

		const session = store.getActive();
		expect(session).toBeDefined();
		expect(session!.description).toBe("Checkout crashes with 3 items");
	});

	it("uses existing session when one is active", async () => {
		const existing = store.create("Original bug description");
		const existingId = existing.id;

		const tool = createHypothesizeTool(deps);
		await tool.execute("call-1", makeParams({ bugDescription: "Updated description" }), undefined, undefined, makeCtx({ selectIndex: 0 }));

		const session = store.getActive();
		expect(session!.id).toBe(existingId);
		expect(session!.description).toBe("Updated description");
	});

	it("sets phase to hypothesize", async () => {
		const tool = createHypothesizeTool(deps);
		await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx({ selectIndex: 0 }));

		expect(store.getActive()!.phase).toBe("hypothesize");
	});

	it("stores hypotheses with sequential IDs and pending status", async () => {
		const tool = createHypothesizeTool(deps);
		await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx({ selectIndex: 0 }));

		const hypotheses = store.getActive()!.hypotheses;
		expect(hypotheses).toHaveLength(2);
		expect(hypotheses[0].id).toBe(1);
		expect(hypotheses[0].status).toBe("pending");
		expect(hypotheses[1].id).toBe(2);
		expect(hypotheses[1].status).toBe("pending");
	});

	it("starts the collector when not running", async () => {
		expect(collector.isRunning).toBe(false);
		const tool = createHypothesizeTool(deps);
		await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx({ selectIndex: 0 }));
		expect(collector.isRunning).toBe(true);
	});

	it("does not restart collector when already running", async () => {
		await collector.start(0);
		expect(collector.isRunning).toBe(true);
		const tool = createHypothesizeTool(deps);
		// Should not throw (port conflict) — collector.start is skipped
		await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx({ selectIndex: 0 }));
		expect(collector.isRunning).toBe(true);
	});

	it("presents hypotheses to user via ctx.ui.select when hasUI", async () => {
		let selectArgs: { title: string; options: string[] } | undefined;
		const ctx = {
			hasUI: true,
			ui: {
				select: async (title: string, options: string[]) => {
					selectArgs = { title, options };
					return options[0];
				},
				confirm: async () => false,
				input: async () => undefined,
				notify: () => {},
			},
		} as unknown as ExtensionContext;

		const tool = createHypothesizeTool(deps);
		await tool.execute("call-1", makeParams(), undefined, undefined, ctx);

		expect(selectArgs).toBeDefined();
		expect(selectArgs!.options).toHaveLength(2);
		expect(selectArgs!.options[0]).toContain("#1");
		expect(selectArgs!.options[1]).toContain("#2");
		expect(selectArgs!.title).toContain("hypothesis");
	});

	it("skips review when hasUI is false", async () => {
		let selectCalled = false;
		const ctx = {
			hasUI: false,
			ui: {
				select: async () => {
					selectCalled = true;
					return undefined;
				},
				confirm: async () => false,
				input: async () => undefined,
				notify: () => {},
			},
		} as unknown as ExtensionContext;

		const tool = createHypothesizeTool(deps);
		const result = await tool.execute("call-1", makeParams(), undefined, undefined, ctx);

		expect(selectCalled).toBe(false);
		expect(result.details.selectedHypothesisId).toBeUndefined();
	});

	it("returns selectedHypothesisId when user selects", async () => {
		const tool = createHypothesizeTool(deps);
		const result = await tool.execute(
			"call-1", makeParams(), undefined, undefined,
			makeCtx({ selectIndex: 1 }),
		);
		expect(result.details.selectedHypothesisId).toBe(2);
		expect(result.content[0].text).toContain("hypothesisId: 2");
	});

	it("returns undefined selectedHypothesisId when user cancels", async () => {
		const tool = createHypothesizeTool(deps);
		const result = await tool.execute(
			"call-1", makeParams(), undefined, undefined,
			makeCtx({ selectIndex: undefined }),
		);
		expect(result.details.selectedHypothesisId).toBeUndefined();
	});

	it("throws on empty hypotheses", async () => {
		const tool = createHypothesizeTool(deps);
		await expect(
			tool.execute("call-1", makeParams({ hypotheses: [] }), undefined, undefined, makeCtx()),
		).rejects.toThrow("At least one hypothesis");
	});

	it("returns content with text and details", async () => {
		const tool = createHypothesizeTool(deps);
		const result = await tool.execute(
			"call-1", makeParams(), undefined, undefined,
			makeCtx({ selectIndex: 0 }),
		);

		expect(result.content).toHaveLength(1);
		expect(result.content[0].type).toBe("text");
		expect(result.content[0].text).toContain("Hypotheses stored");
		expect(result.details.sessionId).toBeDefined();
		expect(result.details.hypotheses).toHaveLength(2);
	});

	it("persists hypotheses to disk", async () => {
		const tool = createHypothesizeTool(deps);
		await tool.execute("call-1", makeParams(), undefined, undefined, makeCtx({ selectIndex: 0 }));

		const sessionId = store.getActive()!.id;
		// A fresh store should load the hypotheses from disk
		const store2 = new SessionStore(tmpDir);
		const loaded = store2.get(sessionId);
		expect(loaded!.hypotheses).toHaveLength(2);
		expect(loaded!.phase).toBe("hypothesize");
	});
});
