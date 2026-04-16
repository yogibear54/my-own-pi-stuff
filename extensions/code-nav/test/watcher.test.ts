/**
 * Tests for the file watcher and dirty-set lazy invalidation.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startWatcher } from "../src/watcher.js";
import { refreshStaleContent, fullIndex, findDefinitions } from "../src/engine.js";
import { ensureParser, createTestStore } from "./helpers.js";

/**
 * Helper: create a temp project dir with files, run full index, return helpers.
 */
function createTempProject(files: Record<string, string>) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-nav-watch-"));
	for (const [relPath, content] of Object.entries(files)) {
		const fullPath = path.join(dir, relPath);
		fs.mkdirSync(path.dirname(fullPath), { recursive: true });
		fs.writeFileSync(fullPath, content, "utf8");
	}
	return dir;
}

function cleanupDir(dir: string) {
	fs.rmSync(dir, { recursive: true, force: true });
}

describe("watcher", () => {
	beforeEach(async () => {
		await ensureParser();
	});

	describe("startWatcher", () => {
		it("tracks file changes in the dirty set", async () => {
			const dir = createTempProject({
				"src/app.ts": `export function hello(): string { return "hello"; }\n`,
			});

			const watcher = startWatcher(dir, {
				excludedDirs: new Set(["node_modules", ".git"]),
				extensions: new Set([".ts", ".tsx", ".js"]),
			});

			try {
				// No changes yet
				let dirty = watcher.drainDirty();
				expect(dirty.size).toBe(0);

				// Modify the file
				fs.writeFileSync(path.join(dir, "src/app.ts"), `export function goodbye(): string { return "bye"; }\n`);

				// Give fs.watch a moment to fire
				await new Promise((r) => setTimeout(r, 200));

				dirty = watcher.drainDirty();
				expect(dirty.size).toBeGreaterThan(0);
				expect(dirty).toContain("src/app.ts");

				// Drain again should be empty
				dirty = watcher.drainDirty();
				expect(dirty.size).toBe(0);
			} finally {
				watcher.stop();
				cleanupDir(dir);
			}
		});

		it("ignores excluded directories", async () => {
			const dir = createTempProject({
				"src/app.ts": `export const a = 1;\n`,
				"node_modules/pkg/index.js": `module.exports = {};\n`,
			});

			const watcher = startWatcher(dir, {
				excludedDirs: new Set(["node_modules", ".git"]),
				extensions: new Set([".ts", ".js"]),
			});

			try {
				// Modify file in excluded dir
				fs.writeFileSync(path.join(dir, "node_modules/pkg/index.js"), `module.exports = { x: 1 };\n`);

				await new Promise((r) => setTimeout(r, 200));

				const dirty = watcher.drainDirty();
				for (const p of dirty) {
					expect(p).not.toContain("node_modules");
				}
			} finally {
				watcher.stop();
				cleanupDir(dir);
			}
		});

		it("ignores unsupported file extensions", async () => {
			const dir = createTempProject({
				"src/app.ts": `export const a = 1;\n`,
				"src/data.json": `{"key": "value"}\n`,
			});

			const watcher = startWatcher(dir, {
				excludedDirs: new Set(["node_modules"]),
				extensions: new Set([".ts", ".tsx"]),
			});

			try {
				// Modify non-TS file
				fs.writeFileSync(path.join(dir, "src/data.json"), `{"key": "changed"}\n`);

				await new Promise((r) => setTimeout(r, 200));

				const dirty = watcher.drainDirty();
				for (const p of dirty) {
					expect(p).not.toContain(".json");
				}
			} finally {
				watcher.stop();
				cleanupDir(dir);
			}
		});

		it("drainDirty clears the set", async () => {
			const dir = createTempProject({
				"src/a.ts": `export const a = 1;\n`,
			});

			const watcher = startWatcher(dir, {
				excludedDirs: new Set(),
				extensions: new Set([".ts"]),
			});

			try {
				fs.writeFileSync(path.join(dir, "src/a.ts"), `export const a = 2;\n`);
				await new Promise((r) => setTimeout(r, 200));

				const first = watcher.drainDirty();
				expect(first.size).toBeGreaterThan(0);

				// Second drain is empty
				const second = watcher.drainDirty();
				expect(second.size).toBe(0);
			} finally {
				watcher.stop();
				cleanupDir(dir);
			}
		});
	});

	describe("refreshStaleContent with dirtySet", () => {
		it("only re-indexes dirty files, not all tracked files", async () => {
			const dir = createTempProject({
				"src/a.ts": `export function alpha(): number { return 1; }\n`,
				"src/b.ts": `export function beta(): number { return 2; }\n`,
			});

			const { store, cleanup } = createTestStore();

			try {
				// Full index
				fullIndex(dir, store, dir);
				const symbolsBefore = store.findDefinitions("beta");
				expect(symbolsBefore.length).toBe(1);
				expect(symbolsBefore[0].signature).toContain("return 2");

				// Modify only b.ts
				fs.writeFileSync(path.join(dir, "src/b.ts"), `export function beta(): number { return 99; }\n`);

				// Refresh with dirty set pointing to b.ts only
				const dirty = new Set(["src/b.ts"]);
				const refreshed = refreshStaleContent(dir, store, undefined, dirty);
				expect(refreshed).toBe(1);

				// b.ts was re-indexed
				const symbolsAfter = store.findDefinitions("beta");
				expect(symbolsAfter.length).toBe(1);
				expect(symbolsAfter[0].signature).toContain("return 99");

				// a.ts was untouched (still in index)
				const alpha = store.findDefinitions("alpha");
				expect(alpha.length).toBe(1);
			} finally {
				cleanup();
				cleanupDir(dir);
			}
		});

		it("removes deleted files from index", async () => {
			const dir = createTempProject({
				"src/a.ts": `export function alpha(): number { return 1; }\n`,
				"src/b.ts": `export function beta(): number { return 2; }\n`,
			});

			const { store, cleanup } = createTestStore();

			try {
				fullIndex(dir, store, dir);
				expect(store.findDefinitions("beta").length).toBe(1);

				// Delete b.ts
				fs.rmSync(path.join(dir, "src/b.ts"));

				// Refresh with dirty set
				const dirty = new Set(["src/b.ts"]);
				refreshStaleContent(dir, store, undefined, dirty);

				// beta should no longer be found
				expect(store.findDefinitions("beta").length).toBe(0);

				// alpha still there
				expect(store.findDefinitions("alpha").length).toBe(1);
			} finally {
				cleanup();
				cleanupDir(dir);
			}
		});

		it("falls back to mtime scan when dirty set is empty", async () => {
			const dir = createTempProject({
				"src/a.ts": `export function alpha(): number { return 1; }\n`,
			});

			const { store, cleanup } = createTestStore();

			try {
				fullIndex(dir, store, dir);

				// Modify the file after indexing (no dirty set)
				// Small delay to ensure mtime differs from lastIndexedAt
				await new Promise((r) => setTimeout(r, 50));
				fs.writeFileSync(path.join(dir, "src/a.ts"), `export function alpha(): number { return 42; }\n`);

				// Empty dirty set → falls back to mtime scan
				const refreshed = refreshStaleContent(dir, store, undefined, new Set());
				expect(refreshed).toBe(1);

				const symbols = store.findDefinitions("alpha");
				expect(symbols[0].signature).toContain("return 42");
			} finally {
				cleanup();
				cleanupDir(dir);
			}
		});

		it("handles new files added to dirty set", async () => {
			const dir = createTempProject({
				"src/a.ts": `export function alpha(): number { return 1; }\n`,
			});

			const { store, cleanup } = createTestStore();

			try {
				fullIndex(dir, store, dir);

				// Create a new file
				fs.writeFileSync(path.join(dir, "src/b.ts"), `export function beta(): number { return 2; }\n`);

				// Mark it dirty
				const dirty = new Set(["src/b.ts"]);
				const refreshed = refreshStaleContent(dir, store, undefined, dirty);
				expect(refreshed).toBe(1);

				// beta should now be indexed
				expect(store.findDefinitions("beta").length).toBe(1);
			} finally {
				cleanup();
				cleanupDir(dir);
			}
		});
	});
});
