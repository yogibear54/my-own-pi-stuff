/**
 * Query engine: combines the store and indexer to answer symbol queries.
 */
import fs from "node:fs";
import path from "node:path";
import type { Store, SymbolRecord } from "./store.js";
import { indexFile, hashContent } from "./indexer.js";
import type { IndexerConfig } from "./indexer.js";
import { getSupportedExtensions } from "./languages/registry.js";

/** Regex: split camelCase and PascalCase at word boundaries. */
const CAMEL_SPLIT_RE = /([a-z])([A-Z])/g;

/**
 * Pre-process source content for FTS5.
 *
 * We index both the original text and a camelCase/PascalCase-split variant.
 * This preserves exact identifier matches (e.g. myFunction) while still
 * enabling sub-word search (my, Function).
 */
export function preprocessForFts(content: string): string {
	const split = content.replace(CAMEL_SPLIT_RE, "$1 $2");
	if (split === content) return content;
	return `${content}\n${split}`;
}

/** Parsed query token used by both FTS query building and line filtering. */
interface QueryToken {
	value: string;
	quoted: boolean;
}

/**
 * Split a query into tokens while preserving quoted phrases.
 * Example: foo "bar baz" -> [foo, bar baz]
 */
function tokenizeQuery(query: string): QueryToken[] {
	const tokens: QueryToken[] = [];
	const re = /"([^"]+)"|(\S+)/g;
	let match: RegExpExecArray | null;

	while ((match = re.exec(query)) !== null) {
		const raw = (match[1] ?? match[2] ?? "").trim();
		if (!raw) continue;
		tokens.push({ value: raw.replace(/"/g, ""), quoted: !!match[1] });
	}

	return tokens;
}

/**
 * Escape a user query for FTS5 MATCH. Wraps terms in quotes if they contain
 * special characters. Supports simple word queries and quoted phrases.
 */
export function escapeFtsQuery(query: string): string {
	const tokens = tokenizeQuery(query);
	if (tokens.length === 0) return "";

	return tokens.map(({ value, quoted }) => {
		if (quoted || /["'*:^(){}|\[\]]/.test(value)) {
			return `"${value}"`;
		}
		return value;
	}).join(" ");
}

export interface DefinitionResult {
	symbol: SymbolRecord;
	/** Context snippet: the line of code where the symbol is defined */
	lineText: string | null;
}

export interface ReferenceResult {
	file: string;
	line: number;
	column: number;
	lineText: string;
	isDefinition: boolean;
	confidence: "high" | "medium" | "low";
}

export interface SearchResult {
	symbol: SymbolRecord;
}

export interface FetchContextResult {
	file: string;
	startLine: number;
	endLine: number;
	totalLines: number;
	truncated: boolean;
	content: string;
}

export interface ContentSearchResult {
	file: string;
	line: number;
	lineText: string;
	enclosingSymbol: string | null;
	enclosingKind: string | null;
	inSymbolName: boolean;
	rank: number;
	/** Position-based rank: lower = earlier in file, used to break FTS ties */
	linePos: number;
}

export interface SearchCodebaseStats {
	refreshedFiles: number;
	fetchLimit: number;
	candidateFiles: number;
	filesScanned: number;
	linesScanned: number;
	scanMultiplier: number;
	maxCandidateFiles: number;
	maxLinesScanned: number;
	hitLineScanBudget: boolean;
	totalMs: number;
}

export interface SearchCodebaseResult {
	results: ContentSearchResult[];
	totalMatches: number;
	totalFilesMatched: number;
	truncated: boolean;
	stats: SearchCodebaseStats;
}

export interface SearchCodebaseOptions {
	/** Multiplier for candidate file fan-out before line-level filtering (default: 50). */
	scanMultiplier?: number;
	/** Hard cap of candidate files fetched from FTS before line filtering (default: 10000). */
	maxCandidateFiles?: number;
	/** Optional line-scan budget across all candidate files (default: unlimited). */
	maxLinesScanned?: number;
	/** Optional cancellation signal for long-running searches. */
	signal?: { aborted?: boolean };
	/** Set of dirty file paths from the watcher. If provided, only these files are re-indexed. */
	dirtySet?: Set<string>;
}

export interface FullIndexOptions {
	/** Include hidden files/directories (dot-prefixed). Default: true. */
	includeHiddenPaths?: boolean;
	/** Directory names to skip while walking. */
	excludedDirectories?: string[];
	/** Maximum source file size to parse in bytes. Default: 1_000_000 (1MB). */
	maxFileSizeBytes?: number;
	/** Indexer behavior knobs. */
	indexer?: IndexerConfig;
}

const DEFAULT_EXCLUDED_DIRS = [
	"node_modules",
	"vendor",
	"dist",
	"build",
	".git",
	".pi",
	"__pycache__",
];

/**
 * Walk the project directory and index all supported files.
 * Returns { indexed, skipped, removed, totalMs }.
 */
export function fullIndex(
	projectRoot: string,
	store: Store,
	relativeTo: string,
	options: FullIndexOptions = {},
): { indexed: number; skipped: number; removed: number; totalMs: number } {
	const start = Date.now();
	const extensions = new Set(getSupportedExtensions());
	const includeHiddenPaths = options.includeHiddenPaths ?? true;
	const excludedDirectories = new Set(options.excludedDirectories ?? DEFAULT_EXCLUDED_DIRS);
	const maxFileSizeBytes = Math.max(10_000, Math.floor(options.maxFileSizeBytes ?? 1_000_000));

	// Collect all existing indexed files for removal detection
	const existingFiles = new Map<string, { hash: string; lastIndexedAt: number }>();
	for (const row of store.getAllFilesWithMeta()) {
		existingFiles.set(row.path, { hash: row.hash, lastIndexedAt: row.lastIndexedAt });
	}

	const indexedFiles = new Set<string>();
	let indexed = 0;
	let skipped = 0;
	let removed = 0;

	// Walk directory
	function walk(dir: string) {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const isHidden = entry.name.startsWith(".");
			if (isHidden && !includeHiddenPaths) continue;
			if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;

			const fullPath = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				walk(fullPath);
			} else if (entry.isFile()) {
				const ext = path.extname(entry.name).toLowerCase();
				if (!extensions.has(ext)) continue;

				const relativePath = path.relative(relativeTo, fullPath);
				const existing = existingFiles.get(relativePath);

				// Check if we need to re-index
				let needsIndex = true;
				if (existing) {
					try {
						const stat = fs.statSync(fullPath);
						if (stat.mtimeMs <= existing.lastIndexedAt) {
							needsIndex = false;
						} else {
							const content = fs.readFileSync(fullPath, "utf8");
							const hash = hashContent(content);
							if (hash === existing.hash) {
								needsIndex = false;
							}
						}
					} catch {
						needsIndex = false;
					}
				}

				if (needsIndex) {
					const result = indexFile(fullPath, relativePath, maxFileSizeBytes, options.indexer);
					if (result) {
						store.indexFile(relativePath, result.language, result.hash, result.symbols);
						indexFileContent(relativePath, projectRoot, store);
						indexed++;
					} else {
						skipped++;
						if (existing) {
							// File exists but is no longer indexable (parse/read/size failure).
							// Remove old rows so we don't serve stale symbols/content.
							store.deleteFile(relativePath);
							removed++;
						}
					}
				} else if (!store.hasIndexedContent(relativePath)) {
					// Backfill missing content rows for previously indexed files.
					indexFileContent(relativePath, projectRoot, store);
				}

				indexedFiles.add(relativePath);
			}
		}
	}

	walk(projectRoot);

	// Remove files that no longer exist
	for (const [filePath] of existingFiles) {
		if (!indexedFiles.has(filePath)) {
			store.deleteFile(filePath);
			removed++;
		}
	}

	return { indexed, skipped, removed, totalMs: Date.now() - start };
}

/**
 * Re-index a specific file (e.g., after a change detected by watcher).
 */
export function reindexFile(
	absolutePath: string,
	projectRoot: string,
	store: Store,
	relativeTo: string,
	options: Pick<FullIndexOptions, "maxFileSizeBytes" | "indexer"> = {},
): boolean {
	const relativePath = path.relative(relativeTo, absolutePath);
	const maxFileSizeBytes = Math.max(10_000, Math.floor(options.maxFileSizeBytes ?? 1_000_000));
	const result = indexFile(absolutePath, relativePath, maxFileSizeBytes, options.indexer);
	if (result) {
		store.indexFile(relativePath, result.language, result.hash, result.symbols);
		indexFileContent(relativePath, projectRoot, store);
		return true;
	}
	return false;
}

/**
 * Find definitions for a symbol name.
 */
export function findDefinitions(
	name: string,
	contextFile: string | undefined,
	store: Store,
	projectRoot: string,
): DefinitionResult[] {
	const all = store.findDefinitions(name);
	if (all.length === 0) return [];

	// Sort by relevance
	const sorted = all.sort((a, b) => {
		// Prefer definitions in context file
		if (contextFile) {
			if (a.file === contextFile && b.file !== contextFile) return -1;
			if (b.file === contextFile && a.file !== contextFile) return 1;
		}
		// Prefer classes/interfaces over functions over variables
		const kindOrder: Record<string, number> = {
			class: 0,
			interface: 0,
			trait: 0,
			enum: 0,
			function: 1,
			method: 1,
			constant: 2,
			variable: 3,
			property: 3,
		};
		const ka = kindOrder[a.kind] ?? 4;
		const kb = kindOrder[b.kind] ?? 4;
		if (ka !== kb) return ka - kb;

		return a.file.localeCompare(b.file) || a.line - b.line;
	});

	// Add line text context
	return sorted.map((sym) => ({
		symbol: sym,
		lineText: readLine(path.resolve(projectRoot, sym.file), sym.line),
	}));
}

/**
 * Find likely references to a symbol by lexical identifier matching across
 * indexed files. This is not full semantic reference resolution.
 */
export function findReferences(
	name: string,
	definitionFile: string | undefined,
	store: Store,
	projectRoot: string,
	signal?: { aborted?: boolean },
): ReferenceResult[] {
	const results: ReferenceResult[] = [];
	const symbolRegex = new RegExp(`\\b${escapeRegex(name)}\\b`);

	const definitionLines = new Set<number>();
	if (definitionFile) {
		for (const sym of store.findDefinitionsInFile(name, definitionFile)) {
			definitionLines.add(sym.line);
		}
	}

	// We need to grep for the name in all indexed files
	// For now, use a pragmatic approach: search file contents for the identifier
	const allIndexedFiles = store.getAllFiles();

	for (const { path: relPath } of allIndexedFiles) {
		throwIfCancelled(signal);
		const fullPath = path.resolve(projectRoot, relPath);
		try {
			const content = fs.readFileSync(fullPath, "utf8");
			if (!content.includes(name)) continue;
			const lines = content.split("\n");
			const isDefinitionFile = !!definitionFile && relPath === definitionFile;

			for (let i = 0; i < lines.length; i++) {
				if ((i & 255) === 0) throwIfCancelled(signal);
				const line = lines[i];
				if (!line.includes(name)) continue;
				if (!symbolRegex.test(line)) continue;

				const col = line.indexOf(name);
				if (col === -1) continue;
				const lineNum = i + 1;
				const isDef = isDefinitionFile && definitionLines.has(lineNum);

				results.push({
					file: relPath,
					line: lineNum,
					column: col,
					lineText: line.trim(),
					isDefinition: isDef,
					confidence: isDef ? "high" : relPath === definitionFile ? "high" : "medium",
				});
			}
		} catch {
			// Skip unreadable files
		}
	}

	// Sort: definitions first, then by file and line
	results.sort((a, b) => {
		if (a.isDefinition !== b.isDefinition) return a.isDefinition ? -1 : 1;
		if (a.file !== b.file) return a.file.localeCompare(b.file);
		return a.line - b.line;
	});

	return results;
}

/**
 * List all symbols in a file (outline view).
 */
export function listFileSymbols(
	file: string,
	store: Store,
): DefinitionResult[] {
	const symbols = store.findSymbolsInFile(file);
	return symbols.map((sym) => ({
		symbol: sym,
		lineText: null, // Caller can add context if needed
	}));
}

/**
 * Search symbols by name prefix.
 */
export function searchSymbols(
	query: string,
	store: Store,
	limit: number = 50,
): SearchResult[] {
	const symbols = store.searchSymbols(query, limit);
	return symbols.map((sym) => ({ symbol: sym }));
}

export interface FetchContextConfig {
	defaultBefore: number;
	defaultAfter: number;
	defaultMaxLines: number;
	maxLinesCap: number;
	containerDeclMaxLines: number;
	signatureDisplayLength: number;
}

/**
 * Fetch symbol context with asymmetric configurable padding.
 *
 * For functions/methods/variables: returns source lines with padding.
 * For classes/interfaces/enums: returns declaration line + member summary.
 */
export function fetchContext(
	name: string,
	store: Store,
	projectRoot: string,
	options: {
		contextFile?: string;
		before?: number;
		after?: number;
		maxLines?: number;
	} = {},
	config?: FetchContextConfig,
): FetchContextResult {
	const { contextFile } = options;
	const before = options.before ?? config?.defaultBefore ?? 5;
	const after = options.after ?? config?.defaultAfter ?? 5;
	const maxLinesCap = config?.maxLinesCap ?? 200;
	const rawMax = options.maxLines ?? config?.defaultMaxLines ?? 100;
	const maxLines = Math.min(rawMax, maxLinesCap);

	const sym = store.getBestDefinition(name, contextFile);
	if (!sym) {
		return {
			file: "",
			startLine: 0,
			endLine: 0,
			totalLines: 0,
			truncated: false,
			content: `No definition found for "${name}". Try re-indexing if the symbol was recently added.`,
		};
	}

	const fullPath = path.resolve(projectRoot, sym.file);
	let lines: string[];
	try {
		lines = fs.readFileSync(fullPath, "utf8").split("\n");
	} catch {
		return {
			file: sym.file,
			startLine: 0,
			endLine: 0,
			totalLines: 0,
			truncated: false,
			content: `File "${sym.file}" no longer exists. Try re-indexing.`,
		};
	}

	const totalLines = lines.length;

	// Container types get member summary instead of full body
	if (isContainerKind(sym.kind)) {
		return buildContainerResult(sym, store, lines, totalLines, maxLines, config);
	}

	return buildPaddedResult(sym, lines, totalLines, before, after, maxLines);
}

/** Symbol kinds that show member summary instead of full body. */
function isContainerKind(kind: string): boolean {
	return kind === "class" || kind === "interface" || kind === "enum" || kind === "trait";
}

/**
 * Build result for container types: declaration + member summary.
 */
function buildContainerResult(
	sym: SymbolRecord,
	store: Store,
	lines: string[],
	totalLines: number,
	maxLines: number,
	config?: FetchContextConfig,
): FetchContextResult {
	const containerDeclMaxLines = config?.containerDeclMaxLines ?? 10;
	const signatureDisplayLength = config?.signatureDisplayLength ?? 80;

	const scopeName = sym.name;
	const members = store.findMembersOfScope(sym.file, scopeName);

	// If no indexed members, fall back to showing the full body like a regular symbol.
	// This handles interfaces, type aliases, and enums whose properties aren't
	// captured by tree-sitter queries.
	if (members.length === 0) {
		return buildPaddedResult(sym, lines, totalLines, 0, 0, maxLines);
	}

	// Declaration lines: from sym.line to first member or endLine (whichever is smaller)
	const declEnd = members.length > 0
		? Math.min(members[0].line - 1, sym.endLine)
		: Math.min(sym.line + containerDeclMaxLines, sym.endLine);

	const headerLines: string[] = [];
	for (let i = sym.line - 1; i < declEnd && i < totalLines; i++) {
		headerLines.push(formatLine(i + 1, lines[i]));
	}

	let content = `${sym.file}:${sym.line}-${sym.endLine}\n`;
	content += "━".repeat(40) + "\n";
	content += headerLines.join("\n") + "\n";

	content += "\n── Members ──\n";
	const maxMembers = maxLines - headerLines.length - 5; // Reserve lines for header/separators
	const shown = members.slice(0, Math.max(maxMembers, 10));
	for (const m of shown) {
		const vis = m.visibility ? `[${m.visibility}] ` : "";
		const sig = m.signature && m.signature.length < signatureDisplayLength ? `  ${m.signature}` : "";
		content += `  ${m.line} | ${vis}${m.kind} ${m.name}${sig}\n`;
	}
	if (members.length > shown.length) {
		content += `  ... and ${members.length - shown.length} more members\n`;
	}

	return {
		file: sym.file,
		startLine: sym.line,
		endLine: sym.endLine,
		totalLines,
		truncated: false,
		content,
	};
}

/**
 * Build result with padding around symbol definition.
 * Function body is always shown in full — maxLines limits padding only.
 */
function buildPaddedResult(
	sym: SymbolRecord,
	lines: string[],
	totalLines: number,
	before: number,
	after: number,
	maxLines: number,
): FetchContextResult {
	// Always include the full function body (padding may be truncated)
	const startLine = Math.max(1, sym.line - before);
	const endLine = Math.min(totalLines, sym.endLine + after);
	const shownLineCount = endLine - startLine + 1;

	const truncated = shownLineCount > maxLines;

	let content = `${sym.file}:${startLine}-${endLine}\n`;
	content += "━".repeat(40) + "\n";

	for (let i = startLine - 1; i < endLine && i < totalLines; i++) {
		content += formatLine(i + 1, lines[i]) + "\n";
	}

	if (truncated) {
		const excess = shownLineCount - maxLines;
		content += `\n... (${excess} lines exceed maxLines — use read tool for full context)\n`;
	}

	return {
		file: sym.file,
		startLine,
		endLine,
		totalLines,
		truncated,
		content,
	};
}

/** Format a source line with line number prefix. */
function formatLine(lineNum: number, text: string): string {
	return `${lineNum} | ${text}`;
}

// ---- Helpers ----

function readLine(filePath: string, lineNum: number): string | null {
	try {
		const content = fs.readFileSync(filePath, "utf8");
		const lines = content.split("\n");
		return (lines[lineNum - 1] ?? null)?.trim() ?? null;
	} catch {
		return null;
	}
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function throwIfCancelled(signal?: { aborted?: boolean }) {
	if (signal?.aborted) {
		throw new Error("[code-nav] Operation cancelled.");
	}
}

/**
 * Index file content into FTS5. Called after symbol indexing.
 */
export function indexFileContent(
	filePath: string,
	projectRoot: string,
	store: Store,
): void {
	const fullPath = path.resolve(projectRoot, filePath);
	let content: string;
	try {
		content = fs.readFileSync(fullPath, "utf8");
	} catch {
		return;
	}
	const processed = preprocessForFts(content);
	store.indexFileContent(filePath, content, processed);
}

/**
 * Re-index changed files. Returns count of re-indexed files.
 *
 * Two modes:
 * 1. **Dirty-set mode** (dirtySet provided & non-empty): only re-index those files.
 *    Handles deleted files (path gone from disk → remove from index).
 * 2. **Mtime scan mode** (no dirty set): iterate all tracked files and check mtime.
 *    Used as a safety-net fallback when the watcher isn't available.
 */
export function refreshStaleContent(
	projectRoot: string,
	store: Store,
	signal?: { aborted?: boolean },
	dirtySet?: Set<string>,
): number {
	if (dirtySet && dirtySet.size > 0) {
		return refreshDirtySet(projectRoot, store, dirtySet, signal);
	}
	return refreshByMtime(projectRoot, store, signal);
}

/** Re-index only the files in the dirty set. */
function refreshDirtySet(
	projectRoot: string,
	store: Store,
	dirtySet: Set<string>,
	signal?: { aborted?: boolean },
): number {
	let refreshed = 0;
	for (const relPath of dirtySet) {
		throwIfCancelled(signal);
		const fullPath = path.resolve(projectRoot, relPath);

		// Check if file still exists
		let content: string;
		try {
			content = fs.readFileSync(fullPath, "utf8");
		} catch {
			// File deleted or inaccessible — remove from index
			store.deleteFile(relPath);
			continue;
		}

		const result = indexFile(fullPath, relPath);
		if (result) {
			store.indexFile(relPath, result.language, result.hash, result.symbols);
			const processed = preprocessForFts(content);
			store.indexFileContent(relPath, content, processed);
			refreshed++;
		} else {
			// File can no longer be indexed (unsupported language, too large, etc.)
			store.deleteFile(relPath);
		}
	}
	return refreshed;
}

/** Re-index tracked files whose mtime is newer than lastIndexedAt. Safety-net fallback. */
function refreshByMtime(
	projectRoot: string,
	store: Store,
	signal?: { aborted?: boolean },
): number {
	const tracked = store.getAllFilesWithMeta();
	let refreshed = 0;

	for (const { path: relPath, hash, lastIndexedAt } of tracked) {
		throwIfCancelled(signal);
		const fullPath = path.resolve(projectRoot, relPath);
		const needsBackfill = !store.hasIndexedContent(relPath);

		// Fast path: check file mtime before reading content
		let fileMtime: number;
		try {
			const stat = fs.statSync(fullPath);
			fileMtime = stat.mtimeMs;
		} catch {
			// File deleted or inaccessible — will be handled by full index
			continue;
		}

		// Skip unchanged files unless they are missing FTS content rows
		if (!needsBackfill && fileMtime <= lastIndexedAt) {
			continue;
		}

		let content: string;
		try {
			content = fs.readFileSync(fullPath, "utf8");
		} catch {
			continue;
		}

		const currentHash = hashContent(content);
		if (currentHash !== hash) {
			// File changed — re-index both symbols and content
			const result = indexFile(fullPath, relPath);
			if (result) {
				store.indexFile(relPath, result.language, result.hash, result.symbols);
				const processed = preprocessForFts(content);
				store.indexFileContent(relPath, content, processed);
				refreshed++;
			} else {
				// Avoid stale definitions/content if file can no longer be indexed.
				store.deleteFile(relPath);
			}
			continue;
		}

		if (needsBackfill) {
			const processed = preprocessForFts(content);
			store.indexFileContent(relPath, content, processed);
			refreshed++;
		}
	}

	return refreshed;
}

/**
 * Search codebase content using FTS5. Returns ranked results with
 * enclosing symbol metadata.
 */
export function searchCodebase(
	query: string,
	store: Store,
	projectRoot: string,
	limit: number = 30,
	options: SearchCodebaseOptions = {},
): SearchCodebaseResult {
	const startedAt = Date.now();
	const scanMultiplier = Math.max(1, Math.min(200, Math.floor(options.scanMultiplier ?? 50)));
	const maxCandidateFiles = Math.max(100, Math.min(100_000, Math.floor(options.maxCandidateFiles ?? 10_000)));
	const maxLinesScanned = Math.max(1, Math.floor(options.maxLinesScanned ?? Number.MAX_SAFE_INTEGER));
	const safeLimit = Math.max(1, limit);

	function makeStats(overrides: Partial<SearchCodebaseStats> = {}): SearchCodebaseStats {
		return {
			refreshedFiles: 0,
			fetchLimit: 0,
			candidateFiles: 0,
			filesScanned: 0,
			linesScanned: 0,
			scanMultiplier,
			maxCandidateFiles,
			maxLinesScanned,
			hitLineScanBudget: false,
			totalMs: Date.now() - startedAt,
			...overrides,
		};
	}

	// Reject empty/whitespace-only queries
	if (!query || !query.trim()) {
		return {
			results: [],
			totalMatches: 0,
			totalFilesMatched: 0,
			truncated: false,
			stats: makeStats(),
		};
	}

	// First, refresh any stale content
	const refreshedFiles = refreshStaleContent(projectRoot, store, options.signal, options.dirtySet);

	const ftsQuery = escapeFtsQuery(query);
	if (!ftsQuery) {
		return {
			results: [],
			totalMatches: 0,
			totalFilesMatched: 0,
			truncated: false,
			stats: makeStats({ refreshedFiles }),
		};
	}

	// Get total files that match (before limiting)
	const totalFilesMatched = store.countContentFts(ftsQuery);

	// Fetch many more files than needed to reduce chance of missing matches.
	const fetchLimit = Math.min(safeLimit * scanMultiplier, totalFilesMatched || maxCandidateFiles, maxCandidateFiles);
	const rawResults = store.searchContentFts(ftsQuery, fetchLimit);

	if (rawResults.length === 0) {
		return {
			results: [],
			totalMatches: 0,
			totalFilesMatched,
			truncated: false,
			stats: makeStats({
				refreshedFiles,
				fetchLimit,
				candidateFiles: 0,
			}),
		};
	}

	// For each matching file, find all matching lines.
	const results: ContentSearchResult[] = [];
	const queryTerms = tokenizeQuery(query).map((t) => t.value.toLowerCase());
	if (queryTerms.length === 0) {
		return {
			results: [],
			totalMatches: 0,
			totalFilesMatched,
			truncated: false,
			stats: makeStats({
				refreshedFiles,
				fetchLimit,
				candidateFiles: rawResults.length,
			}),
		};
	}

	let filesScanned = 0;
	let linesScanned = 0;
	let hitLineScanBudget = false;

	for (const { path: relPath, rank } of rawResults) {
		throwIfCancelled(options.signal);
		if (linesScanned >= maxLinesScanned) {
			hitLineScanBudget = true;
			break;
		}

		let indexedLines = store.getContentLines(relPath);
		if (indexedLines.length === 0) {
			const fullPath = path.resolve(projectRoot, relPath);
			try {
				const fallback = fs.readFileSync(fullPath, "utf8").split("\n");
				indexedLines = fallback.map((line_text: string, i: number) => ({
					line_number: i + 1,
					line_text,
				}));
			} catch {
				continue;
			}
		}
		filesScanned++;

		// Get symbols in this file for metadata
		const fileSymbols = store.findSymbolsInFile(relPath).sort((a, b) =>
			a.line - b.line || b.endLine - a.endLine,
		);

		const symbolNameLines = new Set<number>();
		for (const sym of fileSymbols) {
			symbolNameLines.add(sym.line);
			if (sym.signature) {
				for (let sigLine = sym.line; sigLine <= Math.min(sym.line + 2, sym.endLine); sigLine++) {
					symbolNameLines.add(sigLine);
				}
			}
		}

		const activeSymbols: SymbolRecord[] = [];
		let nextSymbol = 0;

		for (const row of indexedLines) {
			if ((linesScanned & 255) === 0) throwIfCancelled(options.signal);
			if (linesScanned >= maxLinesScanned) {
				hitLineScanBudget = true;
				break;
			}
			linesScanned++;

			const lineNum = row.line_number;
			const lineText = row.line_text;
			const lineLower = lineText.toLowerCase();
			const allMatch = queryTerms.every((term) => lineLower.includes(term));
			if (!allMatch) continue;

			while (nextSymbol < fileSymbols.length && fileSymbols[nextSymbol].line <= lineNum) {
				activeSymbols.push(fileSymbols[nextSymbol]);
				nextSymbol++;
			}

			for (let i = activeSymbols.length - 1; i >= 0; i--) {
				if (activeSymbols[i].endLine < lineNum) {
					activeSymbols.splice(i, 1);
				}
			}

			let enclosingSymbol: string | null = null;
			let enclosingKind: string | null = null;
			for (let i = activeSymbols.length - 1; i >= 0; i--) {
				const sym = activeSymbols[i];
				if (lineNum >= sym.line && lineNum <= sym.endLine) {
					enclosingSymbol = sym.name;
					enclosingKind = sym.kind;
					break;
				}
			}

			results.push({
				file: relPath,
				line: lineNum,
				lineText: lineText.trim(),
				enclosingSymbol,
				enclosingKind,
				inSymbolName: symbolNameLines.has(lineNum),
				rank,
				linePos: lineNum - 1,
			});
		}
	}

	// Sort: symbol name matches first (boosted), then by FTS rank, then by line position
	results.sort((a, b) => {
		// Boost symbol name/signature matches
		if (a.inSymbolName && !b.inSymbolName) return -1;
		if (!a.inSymbolName && b.inSymbolName) return 1;

		// Then by FTS rank (lower = more relevant)
		if (a.rank !== b.rank) return a.rank - b.rank;

		// Within same file, prefer earlier matches
		if (a.file === b.file) return a.linePos - b.linePos;

		// Tiebreak: file path (alphabetical)
		return a.file.localeCompare(b.file);
	});

	const totalMatches = results.length;
	const truncated = totalFilesMatched > rawResults.length || totalMatches > safeLimit || hitLineScanBudget;

	return {
		results: results.slice(0, safeLimit),
		totalMatches,
		totalFilesMatched,
		truncated,
		stats: makeStats({
			refreshedFiles,
			fetchLimit,
			candidateFiles: rawResults.length,
			filesScanned,
			linesScanned,
			hitLineScanBudget,
		}),
	};
}
