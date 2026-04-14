/**
 * code-nav: Symbol-level source code navigation for Pi.
 *
 * Provides go-to-definition, find-references, and symbol listing
 * powered by Tree-sitter with a persistent SQLite index.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import path from "node:path";
import { initParser } from "./src/languages/registry.js";
import { Store } from "./src/store.js";
import { fullIndex, indexFileContent } from "./src/engine.js";
import { registerTools } from "./src/tools.js";

export default function (pi: ExtensionAPI) {
	let store: Store | undefined;
	let projectRoot: string;

	// Resolve this extension's directory for WASM loading
	const extDir = path.resolve(__dirname);

	// Shared state getters for tools
	const getStore = () => store;
	const getRoot = () => projectRoot;

	// Register tools
	registerTools(pi, getStore, getRoot);

	/**
	 * Build FTS content index for all tracked files.
	 * Called asynchronously after symbol indexing.
	 */
	function buildFtsIndex(store: Store, root: string) {
		const files = store.getAllFiles();
		let ftsCount = 0;
		for (const { path: relPath } of files) {
			indexFileContent(relPath, root, store);
			ftsCount++;
		}
		store.setMeta("ftsBuilt", "1");
		console.log(`[code-nav] FTS content indexed: ${ftsCount} files`);
	}

	// Register /reindex command
	pi.registerCommand("reindex", {
		description: "Force a full re-index of the project for code navigation",
		handler: async (_args, ctx) => {
			if (!store) {
				ctx.ui.notify("[code-nav] No active index", "warning");
				return;
			}

			// Close old store and re-index
			const dbPath = path.join(ctx.cwd, ".pi", "code-nav", "index.db");
			store = new Store(dbPath);

			const result = fullIndex(ctx.cwd, store, ctx.cwd);
			store.setMeta("rootPath", ctx.cwd);

			// Re-build FTS in background
			setTimeout(() => {
				if (!store) return;
				buildFtsIndex(store, ctx.cwd);
			}, 0);

			ctx.ui.notify(
				`[code-nav] Re-indexed: ${result.indexed} files, ${store.getStats().symbolCount} symbols (${result.totalMs}ms)`,
				"info",
			);
		},
	});

	// Initialize on session start
	pi.on("session_start", async (_event, ctx) => {
		projectRoot = ctx.cwd;

		// Initialize Tree-sitter (async, one-time WASM load)
		try {
			await initParser(extDir);
		} catch (e: any) {
			console.error(`[code-nav] Failed to initialize Tree-sitter: ${e.message}`);
			return;
		}

		// Open or create index
		const dbPath = path.join(ctx.cwd, ".pi", "code-nav", "index.db");
		store = new Store(dbPath);

		// Check if we need to index
		const indexedRoot = store.getMeta("rootPath");
		const stats = store.getStats();

		if (indexedRoot !== ctx.cwd || stats.fileCount === 0) {
			// Full index needed
			const result = fullIndex(ctx.cwd, store, ctx.cwd);
			store.setMeta("rootPath", ctx.cwd);

			if (ctx.hasUI) {
				ctx.ui.setStatus(
					"code-nav",
					`${store.getStats().symbolCount} symbols (${result.totalMs}ms)`,
				);
			}

			// Background FTS content indexing
			setTimeout(() => {
				if (!store) return;
				buildFtsIndex(store, ctx.cwd);
			}, 0);
		} else {
			// Incremental update
			const result = fullIndex(ctx.cwd, store, ctx.cwd);
			store.setMeta("rootPath", ctx.cwd);

			if (ctx.hasUI && (result.indexed > 0 || result.removed > 0)) {
				ctx.ui.setStatus(
					"code-nav",
					`${store.getStats().symbolCount} symbols (${result.indexed} updated)`,
				);
			} else if (ctx.hasUI) {
				ctx.ui.setStatus(
					"code-nav",
					`${stats.symbolCount} symbols`,
				);
			}

			// Background FTS content indexing if not yet built
			if (!store.getMeta("ftsBuilt")) {
				setTimeout(() => {
					if (!store) return;
					buildFtsIndex(store, ctx.cwd);
				}, 0);
			}
		}
	});

	// Cleanup on shutdown
	pi.on("session_shutdown", async () => {
		store?.close();
		store = undefined;
	});
}
