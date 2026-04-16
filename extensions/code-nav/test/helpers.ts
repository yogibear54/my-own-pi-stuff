/**
 * Shared test helpers: create temp project directories, Store, and index files.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { fullIndex } from "../src/engine.js";
import { initParser, setEnabledLanguages } from "../src/languages/registry.js";
import { resolveToolsConfig } from "../src/config.js";
import type { FullIndexOptions } from "../src/engine.js";
import type { CodeNavToolsConfig } from "../src/config.js";

/** Default config for tests. */
export function getTestConfig(): CodeNavToolsConfig {
	return resolveToolsConfig({});
}

/** Create a temp directory with fixture files. Returns cleanup function. */
export function createTempProject(files: Record<string, string>): {
	root: string;
	cleanup: () => void;
} {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-nav-test-"));
	for (const [relPath, content] of Object.entries(files)) {
		const fullPath = path.join(root, relPath);
		fs.mkdirSync(path.dirname(fullPath), { recursive: true });
		fs.writeFileSync(fullPath, content, "utf8");
	}
	return {
		root,
		cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
	};
}

/** Initialize parser once per test suite. */
let parserInitialized = false;
export async function ensureParser(): Promise<void> {
	if (parserInitialized) return;
	const extDir = path.resolve(import.meta.dirname ?? ".", "..");
	setEnabledLanguages(getTestConfig().languages.enabled);
	await initParser(extDir, getTestConfig().languages.enabled);
	parserInitialized = true;
}

/** Create a Store backed by a temp DB. */
export function createTestStore(): { store: Store; dbPath: string; cleanup: () => void } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-nav-db-"));
	const dbPath = path.join(dir, "test.db");
	const store = new Store(dbPath, getTestConfig().database);
	return {
		store,
		dbPath,
		cleanup: () => {
			store.close();
			fs.rmSync(dir, { recursive: true, force: true });
		},
	};
}

/** Index a temp project into a store. */
export function indexProject(
	root: string,
	store: Store,
	options?: Partial<FullIndexOptions>,
): { indexed: number; skipped: number; removed: number; totalMs: number } {
	return fullIndex(root, store, root, {
		indexer: getTestConfig().indexer,
		...options,
	});
}
