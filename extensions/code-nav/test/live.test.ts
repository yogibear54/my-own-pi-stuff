/**
 * Manual live test: index the code-nav codebase itself and test fetchContext
 * against real symbols. Run with: npx vitest run test/live.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import {
	ensureParser,
	createTestStore,
} from "./helpers.js";
import { fullIndex, fetchContext, findDefinitions, listFileSymbols } from "../src/engine.js";
import { resolveToolsConfig } from "../src/config.js";
import type { Store } from "../src/store.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname ?? ".", "..");

describe("live: code-nav codebase", () => {
	let store: Store;
	let cleanupStore: () => void;

	beforeAll(async () => {
		await ensureParser();
		const s = createTestStore();
		store = s.store;
		cleanupStore = s.cleanup;

		const config = resolveToolsConfig({});
		const result = fullIndex(PROJECT_ROOT, store, PROJECT_ROOT, { indexer: config.indexer });
		console.log(`Indexed ${result.indexed} files, ${result.skipped} skipped in ${result.totalMs}ms`);
	});

	afterAll(() => {
		cleanupStore();
	});

	it("lists symbols in src/engine.ts", () => {
		const symbols = listFileSymbols("src/engine.ts", store);
		const names = symbols.map((s) => s.symbol.name);
		console.log("engine.ts symbols:", names.join(", "));
		expect(names).toContain("fetchContext");
		expect(names).toContain("findDefinitions");
		expect(names).toContain("fullIndex");
	});

	it("fetchContext on fetchContext (function)", () => {
		const result = fetchContext("fetchContext", store, PROJECT_ROOT, {
			contextFile: "src/engine.ts",
		});
		console.log("=== fetchContext output ===");
		console.log(result.content);
		console.log(`file: ${result.file}, lines: ${result.startLine}-${result.endLine}/${result.totalLines}, truncated: ${result.truncated}`);

		expect(result.content).toContain("fetchContext");
		expect(result.file).toContain("engine.ts");
		expect(result.startLine).toBeGreaterThan(0);
	});

	it("fetchContext on Store (class)", () => {
		const result = fetchContext("Store", store, PROJECT_ROOT, {
			contextFile: "src/store.ts",
		});
		console.log("=== Store output ===");
		console.log(result.content);
		console.log(`file: ${result.file}, lines: ${result.startLine}-${result.endLine}/${result.totalLines}, truncated: ${result.truncated}`);

		expect(result.content).toContain("Store");
		// Class should show member summary
		expect(result.content).toContain("method");
	});

	it("fetchContext on resolveToolsConfig (function)", () => {
		const result = fetchContext("resolveToolsConfig", store, PROJECT_ROOT, {
			contextFile: "src/config.ts",
		});
		console.log("=== resolveToolsConfig output ===");
		console.log(result.content);
		console.log(`file: ${result.file}, lines: ${result.startLine}-${result.endLine}/${result.totalLines}, truncated: ${result.truncated}`);

		expect(result.content).toContain("resolveToolsConfig");
	});

	it("fetchContext on registerTools (function)", () => {
		const result = fetchContext("registerTools", store, PROJECT_ROOT, {
			contextFile: "src/tools.ts",
		});
		console.log("=== registerTools output ===");
		console.log(result.content);
		console.log(`file: ${result.file}, lines: ${result.startLine}-${result.endLine}/${result.totalLines}, truncated: ${result.truncated}`);

		expect(result.content).toContain("registerTools");
	});
});
