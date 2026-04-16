/**
 * code-nav: Symbol-level source code navigation for Pi.
 *
 * Provides go-to-definition, find-references, and symbol listing
 * powered by Tree-sitter with a persistent SQLite index.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initParser, setEnabledLanguages } from "./src/languages/registry.js";
import { Store } from "./src/store.js";
import { fullIndex, indexFileContent } from "./src/engine.js";
import type { FullIndexOptions } from "./src/engine.js";
import { resolveToolsConfig } from "./src/config.js";
import type { CodeNavToolsConfig } from "./src/config.js";
import { registerTools } from "./src/tools.js";
import { startWatcher, type WatcherHandle } from "./src/watcher.js";

/** Code-nav tool names (used to enable/disable as a group). */
const CODE_NAV_TOOLS = [
	"code_nav_definition",
	"code_nav_references",
	"code_nav_symbols",
	"code_nav_fetch_context",
	"code_nav_search",
];

const DEFAULT_INDEX_OPTIONS: Required<FullIndexOptions> = {
	includeHiddenPaths: true,
	excludedDirectories: ["node_modules", "vendor", "dist", "build", ".git", ".pi", "__pycache__"],
	maxFileSizeBytes: 1_000_000,
	indexer: { minNameLength: 2, maxSignatureLength: 120 },
};

/**
 * Read a JSON settings file, returning null on any error.
 */
function readSettingsFile(filePath: string): any {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return null;
	}
}

/**
 * Get merged code-nav settings (global overridden by project settings).
 */
function getCodeNavSettings(cwd: string): any {
	const global = readSettingsFile(path.join(os.homedir(), ".pi", "agent", "settings.json"));
	const project = readSettingsFile(path.join(cwd, ".pi", "settings.json"));

	const globalCodeNav = global?.codeNav ?? {};
	const projectCodeNav = project?.codeNav ?? {};

	return {
		...globalCodeNav,
		...projectCodeNav,
		indexing: {
			...(globalCodeNav.indexing ?? {}),
			...(projectCodeNav.indexing ?? {}),
		},
	};
}

/**
 * Check whether code-nav is enabled for a given project directory.
 * Reads project-level .pi/settings.json first, then global
 * ~/.pi/agent/settings.json. Defaults to disabled.
 */
function isCodeNavEnabled(cwd: string): boolean {
	const settings = getCodeNavSettings(cwd);
	if (settings?.enabled !== undefined) {
		return !!settings.enabled;
	}
	return false;
}

/**
 * Get indexing options with project/global overrides and sane defaults.
 */
function getFullIndexOptions(cwd: string): FullIndexOptions {
	const settings = getCodeNavSettings(cwd);
	const indexing = settings?.indexing ?? {};

	const includeHiddenPaths = indexing.includeHiddenPaths ?? DEFAULT_INDEX_OPTIONS.includeHiddenPaths;
	const rawMaxFileSize = Number(indexing.maxFileSizeBytes ?? DEFAULT_INDEX_OPTIONS.maxFileSizeBytes);
	const maxFileSizeBytes = Number.isFinite(rawMaxFileSize)
		? Math.max(10_000, Math.floor(rawMaxFileSize))
		: DEFAULT_INDEX_OPTIONS.maxFileSizeBytes;

	const excludedDirectories = Array.isArray(indexing.excludedDirectories)
		? indexing.excludedDirectories
			.filter((d: any) => typeof d === "string")
			.map((d: string) => d.trim())
			.filter(Boolean)
		: DEFAULT_INDEX_OPTIONS.excludedDirectories;

	return {
		includeHiddenPaths: !!includeHiddenPaths,
		maxFileSizeBytes,
		excludedDirectories,
		indexer: resolveToolsConfig(settings).indexer,
	};
}

/**
 * Get resolved tools + search config for a project directory.
 */
function resolveAndStoreConfig(cwd: string): CodeNavToolsConfig {
	const settings = getCodeNavSettings(cwd);
	return resolveToolsConfig(settings);
}

export default function (pi: ExtensionAPI) {
	let store: Store | undefined;
	let projectRoot: string;
	let watcher: WatcherHandle | undefined;

	// Resolve this extension's directory for WASM loading
	const extDir = path.resolve(__dirname);

	// Shared state getters for tools
	const getStore = () => store;
	const getRoot = () => projectRoot;
	const getWatcher = () => watcher;
	const getConfig = (): CodeNavToolsConfig => {
		const raw = store?.getMeta("toolsConfig");
		if (raw) {
			try {
				const parsed = JSON.parse(raw);
				if (parsed && typeof parsed === "object") return parsed as CodeNavToolsConfig;
			} catch { /* fall through */ }
		}
		return resolveToolsConfig({});
	};

	// Register tools
	registerTools(pi, getStore, getRoot, getConfig, getWatcher);

	/**
	 * Backfill any missing FTS content rows for tracked files.
	 * Called asynchronously after symbol indexing.
	 */
	function buildFtsIndex(store: Store, root: string) {
		const files = store.getAllFiles();
		let ftsCount = 0;
		for (const { path: relPath } of files) {
			if (store.hasIndexedContent(relPath)) continue;
			indexFileContent(relPath, root, store);
			ftsCount++;
		}
		store.setMeta("ftsBuilt", "1");
		console.log(`[code-nav] FTS backfilled: ${ftsCount} files`);
	}

	// Register /reindex command
	pi.registerCommand("reindex", {
		description: "Force a full re-index of the project for code navigation",
		handler: async (_args, ctx) => {
			if (!isCodeNavEnabled(ctx.cwd)) {
				ctx.ui.notify(
					"[code-nav] Not enabled for this project. Add `\"codeNav\": { \"enabled\": true }` to .pi/settings.json to enable.",
					"warning",
				);
				return;
			}
			if (!store) {
				ctx.ui.notify("[code-nav] No active index", "warning");
				return;
			}

			// Close old store and re-index
			store.close();
			const dbPath = path.join(ctx.cwd, ".pi", "code-nav", "index.db");
			const toolsConfig = resolveAndStoreConfig(ctx.cwd);
			store = new Store(dbPath, toolsConfig.database);
			store.clearAll();

			const indexOptions = getFullIndexOptions(ctx.cwd);
			store.setMeta("indexOptions", JSON.stringify(indexOptions));
			store.setMeta("toolsConfig", JSON.stringify(toolsConfig));
			const result = fullIndex(ctx.cwd, store, ctx.cwd, indexOptions);
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

	// Register /code-nav-config command
	pi.registerCommand("code-nav-config", {
		description: "Show effective code-nav configuration and index status",
		handler: async (_args, ctx) => {
			const enabled = isCodeNavEnabled(ctx.cwd);
			const settings = getCodeNavSettings(ctx.cwd);
			const indexOptions = getFullIndexOptions(ctx.cwd);
			const toolsConfig = resolveAndStoreConfig(ctx.cwd);
			const dbPath = path.join(ctx.cwd, ".pi", "code-nav", "index.db");
			const activeStore = store;
			const stats = activeStore ? activeStore.getStats() : null;
			const indexedRoot = activeStore?.getMeta("rootPath");
			const ftsBuilt = activeStore?.getMeta("ftsBuilt") === "1";

			const lines = [
				"[code-nav] Effective configuration",
				`enabled: ${enabled ? "true" : "false"}`,
				`cwd: ${ctx.cwd}`,
				`dbPath: ${dbPath}`,
				`storeActive: ${activeStore ? "true" : "false"}`,
				`indexedRoot: ${indexedRoot ?? "(none)"}`,
				`ftsBuilt: ${ftsBuilt ? "true" : "false"}`,
				`fileCount: ${stats?.fileCount ?? 0}`,
				`symbolCount: ${stats?.symbolCount ?? 0}`,
				"indexing:",
				`  includeHiddenPaths: ${indexOptions.includeHiddenPaths ? "true" : "false"}`,
				`  maxFileSizeBytes: ${indexOptions.maxFileSizeBytes}`,
				`  excludedDirectories: ${indexOptions.excludedDirectories?.join(", ") || "(none)"}`,
				"tools:",
				`  definitionMaxResults: ${toolsConfig.tools.definitionMaxResults}`,
				`  referenceMaxFiles: ${toolsConfig.tools.referenceMaxFiles}`,
				`  referenceMaxPerFile: ${toolsConfig.tools.referenceMaxPerFile}`,
				`  symbolSearchLimit: ${toolsConfig.tools.symbolSearchLimit}`,
				`  searchDefaultLimit: ${toolsConfig.tools.searchDefaultLimit}`,
				"search:",
				`  defaultScanMultiplier: ${toolsConfig.search.defaultScanMultiplier}`,
				`  defaultMaxCandidateFiles: ${toolsConfig.search.defaultMaxCandidateFiles}`,
				`  defaultMaxLinesScanned: ${toolsConfig.search.defaultMaxLinesScanned ?? "(unlimited)"}`,
				"fetchContext:",
				`  defaultBefore: ${toolsConfig.fetchContext.defaultBefore}`,
				`  defaultAfter: ${toolsConfig.fetchContext.defaultAfter}`,
				`  defaultMaxLines: ${toolsConfig.fetchContext.defaultMaxLines}`,
				`  maxLinesCap: ${toolsConfig.fetchContext.maxLinesCap}`,
				`  containerDeclMaxLines: ${toolsConfig.fetchContext.containerDeclMaxLines}`,
				`  signatureDisplayLength: ${toolsConfig.fetchContext.signatureDisplayLength}`,
				"database:",
				`  journalMode: ${toolsConfig.database.journalMode}`,
				`  synchronous: ${toolsConfig.database.synchronous}`,
				`  cacheSizeMB: ${toolsConfig.database.cacheSizeMB}`,
				"languages:",
				`  enabled: ${toolsConfig.languages.enabled.join(", ")}`,
				"indexer:",
				`  minNameLength: ${toolsConfig.indexer.minNameLength}`,
				`  maxSignatureLength: ${toolsConfig.indexer.maxSignatureLength}`,
				"watcher:",
				`  active: ${watcher ? "true" : "false"}`,
				`  dirtyFiles: ${watcher?.dirtyCount() ?? 0}`,
				`  filesRefreshed: ${watcher?.refreshCount() ?? 0}`,
				"raw codeNav settings:",
				JSON.stringify(settings, null, 2),
			];
			const text = lines.join("\n");

			console.log(text);
			if (ctx.hasUI) {
				ctx.ui.notify(text, "info");
			}
		},
	});

	// Initialize on session start
	pi.on("session_start", async (_event, ctx) => {
		projectRoot = ctx.cwd;

		// Check if code-nav is enabled for this project
		if (!isCodeNavEnabled(ctx.cwd)) {
			// Disable code-nav tools so they don't appear in the tool list
			const activeTools = pi.getActiveTools();
			const filtered = activeTools
				.filter((t) => !CODE_NAV_TOOLS.includes(t.name))
				.map((t) => t.name);
			pi.setActiveTools(filtered);

			if (ctx.hasUI) {
				ctx.ui.notify(
					"[code-nav] Not enabled for this project. Add `\"codeNav\": { \"enabled\": true }` to .pi/settings.json to enable. Use /tools to manage tools.",
					"info",
				);
			}
			return;
		}

		// Initialize Tree-sitter (async, one-time WASM load)
		const toolsConfig = resolveAndStoreConfig(ctx.cwd);
		setEnabledLanguages(toolsConfig.languages.enabled);
		try {
			await initParser(extDir, toolsConfig.languages.enabled);
		} catch (e: any) {
			console.error(`[code-nav] Failed to initialize Tree-sitter: ${e.message}`);
			return;
		}

		// Open or create index
		const dbPath = path.join(ctx.cwd, ".pi", "code-nav", "index.db");
		store = new Store(dbPath, toolsConfig.database);

		// Check if we need to index
		const indexedRoot = store.getMeta("rootPath");
		const stats = store.getStats();

		if (indexedRoot !== ctx.cwd || stats.fileCount === 0) {
			// Full index needed
			const indexOptions = getFullIndexOptions(ctx.cwd);
			store.setMeta("indexOptions", JSON.stringify(indexOptions));
			store.setMeta("toolsConfig", JSON.stringify(toolsConfig));
			const result = fullIndex(ctx.cwd, store, ctx.cwd, indexOptions);
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
			const indexOptions = getFullIndexOptions(ctx.cwd);
			store.setMeta("indexOptions", JSON.stringify(indexOptions));
			store.setMeta("toolsConfig", JSON.stringify(toolsConfig));
			const result = fullIndex(ctx.cwd, store, ctx.cwd, indexOptions);
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

		// Start file watcher for lazy invalidation
		const { getSupportedExtensions } = await import("./src/languages/registry.js");
		const extensions = new Set(getSupportedExtensions());
		const indexOpts = JSON.parse(store.getMeta("indexOptions") || "{}");
		const excludedDirs = new Set<string>(
			Array.isArray(indexOpts.excludedDirectories)
				? indexOpts.excludedDirectories
				: ["node_modules", "vendor", "dist", "build", ".git", ".pi", "__pycache__"],
		);
		watcher = startWatcher(ctx.cwd, { excludedDirs, extensions });
	});

	// Cleanup on shutdown
	pi.on("session_shutdown", async () => {
		watcher?.stop();
		watcher = undefined;
		store?.close();
		store = undefined;
	});
}
