/**
 * Debug test: investigate CodeNavToolsConfig fetchContext issue.
 * Run with: npx vitest run test/debug.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { ensureParser, createTestStore } from "./helpers.js";
import { fullIndex, fetchContext, findDefinitions, listFileSymbols } from "../src/engine.js";
import { resolveToolsConfig } from "../src/config.js";
import type { Store } from "../src/store.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname ?? ".", "..");

describe("debug: CodeNavToolsConfig", () => {
	let store: Store;
	let cleanupStore: () => void;

	beforeAll(async () => {
		await ensureParser();
		const s = createTestStore();
		store = s.store;
		cleanupStore = s.cleanup;
		const config = resolveToolsConfig({});
		fullIndex(PROJECT_ROOT, store, PROJECT_ROOT, { indexer: config.indexer });
	});

	afterAll(() => cleanupStore());

	it("lists symbols in src/config.ts", () => {
		const symbols = listFileSymbols("src/config.ts", store);
		const names = symbols.map((s) => s.symbol.name);
		console.log("\nAll symbols in src/config.ts:");
		for (const s of symbols) {
			console.log(`  ${s.symbol.kind} ${s.symbol.name} :${s.symbol.line} (scope: ${s.symbol.scope ?? "-"})`);
		}
	});

	it("findDefinitions for CodeNavToolsConfig", () => {
		const results = findDefinitions("CodeNavToolsConfig", undefined, store, PROJECT_ROOT);
		console.log("\nfindDefinitions('CodeNavToolsConfig'):", results.length, "results");
		for (const r of results) {
			console.log(`  ${r.symbol.kind} ${r.symbol.name} at ${r.symbol.file}:${r.symbol.line}`);
		}
	});

	it("fetchContext for CodeNavToolsConfig", () => {
		const result = fetchContext("CodeNavToolsConfig", store, PROJECT_ROOT, {
			contextFile: "src/config.ts",
		});
		console.log("\n=== fetchContext('CodeNavToolsConfig') ===");
		console.log(result.content);
		console.log(`file: ${result.file}, lines: ${result.startLine}-${result.endLine}/${result.totalLines}, truncated: ${result.truncated}`);
	});
});
