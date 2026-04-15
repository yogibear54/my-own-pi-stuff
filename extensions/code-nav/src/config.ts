/**
 * Typed configuration for code-nav.
 *
 * Settings are read from .pi/settings.json (project and global),
 * shallow-merged, then resolved against these defaults.
 */

/** Tool output limits. */
export interface ToolsConfig {
	/** Max definitions returned by code_nav_definition. Default: 20. */
	definitionMaxResults: number;
	/** Max distinct files shown in code_nav_references. Default: 15. */
	referenceMaxFiles: number;
	/** Max reference lines per file in code_nav_references. Default: 10. */
	referenceMaxPerFile: number;
	/** Max symbols returned by code_nav_symbols workspace search. Default: 50. */
	symbolSearchLimit: number;
	/** Default result limit for code_nav_search. Default: 30. */
	searchDefaultLimit: number;
}

/** Search tuning defaults. */
export interface SearchConfig {
	/** Candidate file fan-out multiplier. Default: 50. Range: 1-200. */
	defaultScanMultiplier: number;
	/** Hard cap on candidate files from FTS. Default: 10000. Range: 100-100000. */
	defaultMaxCandidateFiles: number;
	/** Line-scan budget. Default: null (unlimited). Range: 1000-10000000 or null. */
	defaultMaxLinesScanned: number | null;
}

/** Fetch context defaults. */
export interface FetchContextConfig {
	/** Lines before the symbol. Default: 5. Range: 0-100. */
	defaultBefore: number;
	/** Lines after the symbol. Default: 5. Range: 0-100. */
	defaultAfter: number;
	/** Total line cap. Default: 100. Range: 10-200. */
	defaultMaxLines: number;
	/** Absolute upper bound on maxLines. Default: 200. Range: 10-200. */
	maxLinesCap: number;
	/** Max declaration lines shown for container types. Default: 10. */
	containerDeclMaxLines: number;
	/** Max signature length in member summary. Default: 80. */
	signatureDisplayLength: number;
}

/** SQLite database tuning. */
export interface DatabaseConfig {
	/** Journal mode. Default: "WAL". Values: DELETE, TRUNCATE, PERSIST, MEMORY, WAL, OFF. */
	journalMode: string;
	/** Synchronous mode. Default: "NORMAL". Values: OFF, NORMAL, FULL, EXTRA. */
	synchronous: string;
	/** Page cache size in MB. Default: 32. */
	cacheSizeMB: number;
}

/** Language grammar control. */
export interface LanguagesConfig {
	/** List of language names to enable. Default: all supported languages. */
	enabled: string[];
}

/** Indexer behavior knobs. */
export interface IndexerConfig {
	/** Min identifier length to index. Default: 2. */
	minNameLength: number;
	/** Max signature text length before truncation. Default: 120. */
	maxSignatureLength: number;
}

/** All known language names (used for validation). */
export const ALL_LANGUAGE_NAMES = ["typescript", "tsx", "javascript", "python", "php"] as const;

/** Full code-nav config (tools + search + fetchContext + database + languages + indexer sections). */
export interface CodeNavToolsConfig {
	tools: ToolsConfig;
	search: SearchConfig;
	fetchContext: FetchContextConfig;
	database: DatabaseConfig;
	languages: LanguagesConfig;
	indexer: IndexerConfig;
}

/** Built-in defaults. */
const DEFAULT_TOOLS: ToolsConfig = {
	definitionMaxResults: 20,
	referenceMaxFiles: 15,
	referenceMaxPerFile: 10,
	symbolSearchLimit: 50,
	searchDefaultLimit: 30,
};

const DEFAULT_SEARCH: SearchConfig = {
	defaultScanMultiplier: 50,
	defaultMaxCandidateFiles: 10_000,
	defaultMaxLinesScanned: null,
};

const DEFAULT_FETCH_CONTEXT: FetchContextConfig = {
	defaultBefore: 5,
	defaultAfter: 5,
	defaultMaxLines: 100,
	maxLinesCap: 200,
	containerDeclMaxLines: 10,
	signatureDisplayLength: 80,
};

const DEFAULT_DATABASE: DatabaseConfig = {
	journalMode: "WAL",
	synchronous: "NORMAL",
	cacheSizeMB: 32,
};

const VALID_JOURNAL_MODES = new Set(["DELETE", "TRUNCATE", "PERSIST", "MEMORY", "WAL", "OFF"]);
const VALID_SYNCHRONOUS = new Set(["OFF", "NORMAL", "FULL", "EXTRA"]);
const ALL_LANG_SET = new Set<string>(ALL_LANGUAGE_NAMES);

/**
 * Resolve the tools + search config from raw settings (already
 * merged from global + project).
 */
export function resolveToolsConfig(raw: any): CodeNavToolsConfig {
	const toolsRaw = raw?.tools ?? {};
	const searchRaw = raw?.search ?? {};
	const fcRaw = raw?.fetchContext ?? {};

	return {
		tools: {
			definitionMaxResults: positiveInt(toolsRaw.definitionMaxResults, DEFAULT_TOOLS.definitionMaxResults),
			referenceMaxFiles: positiveInt(toolsRaw.referenceMaxFiles, DEFAULT_TOOLS.referenceMaxFiles),
			referenceMaxPerFile: positiveInt(toolsRaw.referenceMaxPerFile, DEFAULT_TOOLS.referenceMaxPerFile),
			symbolSearchLimit: positiveInt(toolsRaw.symbolSearchLimit, DEFAULT_TOOLS.symbolSearchLimit),
			searchDefaultLimit: positiveInt(toolsRaw.searchDefaultLimit, DEFAULT_TOOLS.searchDefaultLimit),
		},
		search: {
			defaultScanMultiplier: clampInt(searchRaw.defaultScanMultiplier, 1, 200, DEFAULT_SEARCH.defaultScanMultiplier),
			defaultMaxCandidateFiles: clampInt(searchRaw.defaultMaxCandidateFiles, 100, 100_000, DEFAULT_SEARCH.defaultMaxCandidateFiles),
			defaultMaxLinesScanned: resolveNullableInt(searchRaw.defaultMaxLinesScanned, 1000, 10_000_000),
		},
		fetchContext: {
			defaultBefore: clampInt(fcRaw.defaultBefore, 0, 100, DEFAULT_FETCH_CONTEXT.defaultBefore),
			defaultAfter: clampInt(fcRaw.defaultAfter, 0, 100, DEFAULT_FETCH_CONTEXT.defaultAfter),
			defaultMaxLines: clampInt(fcRaw.defaultMaxLines, 10, 200, DEFAULT_FETCH_CONTEXT.defaultMaxLines),
			maxLinesCap: clampInt(fcRaw.maxLinesCap, 10, 200, DEFAULT_FETCH_CONTEXT.maxLinesCap),
			containerDeclMaxLines: positiveInt(fcRaw.containerDeclMaxLines, DEFAULT_FETCH_CONTEXT.containerDeclMaxLines),
			signatureDisplayLength: positiveInt(fcRaw.signatureDisplayLength, DEFAULT_FETCH_CONTEXT.signatureDisplayLength),
		},
		database: resolveDatabaseConfig(raw?.database),
		languages: resolveLanguagesConfig(raw?.languages),
		indexer: resolveIndexerConfig(raw?.indexer),
	};
}

// ---- Helpers ----

function resolveLanguagesConfig(raw: any): LanguagesConfig {
	const langRaw = raw ?? {};
	const rawEnabled = langRaw.enabled;
	if (!Array.isArray(rawEnabled) || rawEnabled.length === 0) {
		return { enabled: [...ALL_LANGUAGE_NAMES] };
	}
	const validated = rawEnabled
		.filter((v: any) => typeof v === "string")
		.map((v: string) => v.toLowerCase().trim())
		.filter((v: string) => ALL_LANG_SET.has(v));
	return { enabled: validated.length > 0 ? validated : [...ALL_LANGUAGE_NAMES] };
}

const DEFAULT_INDEXER: IndexerConfig = {
	minNameLength: 2,
	maxSignatureLength: 120,
};

function resolveIndexerConfig(raw: any): IndexerConfig {
	const ixRaw = raw ?? {};
	return {
		minNameLength: clampInt(ixRaw.minNameLength, 1, 10, DEFAULT_INDEXER.minNameLength),
		maxSignatureLength: clampInt(ixRaw.maxSignatureLength, 50, 500, DEFAULT_INDEXER.maxSignatureLength),
	};
}

function resolveDatabaseConfig(raw: any): DatabaseConfig {
	const dbRaw = raw ?? {};
	const rawMode = typeof dbRaw.journalMode === "string" ? dbRaw.journalMode.toUpperCase().trim() : "";
	const rawSync = typeof dbRaw.synchronous === "string" ? dbRaw.synchronous.toUpperCase().trim() : "";

	return {
		journalMode: VALID_JOURNAL_MODES.has(rawMode) ? rawMode : DEFAULT_DATABASE.journalMode,
		synchronous: VALID_SYNCHRONOUS.has(rawSync) ? rawSync : DEFAULT_DATABASE.synchronous,
		cacheSizeMB: clampInt(dbRaw.cacheSizeMB, 1, 1024, DEFAULT_DATABASE.cacheSizeMB),
	};
}

function positiveInt(value: any, fallback: number): number {
	const n = Number(value);
	return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

function clampInt(value: any, min: number, max: number, fallback: number): number {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(n)));
}

function resolveNullableInt(value: any, min: number, max: number): number | null {
	if (value === null || value === undefined) return null;
	const n = Number(value);
	if (!Number.isFinite(n)) return null;
	return Math.min(max, Math.max(min, Math.floor(n)));
}
