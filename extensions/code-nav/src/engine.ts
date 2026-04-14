/**
 * Query engine: combines the store and indexer to answer symbol queries.
 */
import fs from "node:fs";
import path from "node:path";
import type { Store, SymbolRecord } from "./store.js";
import { indexFile, hashContent } from "./indexer.js";
import { detectLanguage, getSupportedExtensions } from "./languages/registry.js";

/** Regex: split camelCase and PascalCase at word boundaries. */
const CAMEL_SPLIT_RE = /([a-z])([A-Z])/g;

/**
 * Pre-process source content for FTS5: split camelCase/PascalCase identifiers
 * so that sub-words become independently searchable.
 * snake_case and kebab-case are already split by the unicode61 tokenizer.
 */
export function preprocessForFts(content: string): string {
	return content.replace(CAMEL_SPLIT_RE, "$1 $2");
}

/**
 * Escape a user query for FTS5 MATCH. Wraps terms in quotes if they contain
 * special characters. Supports simple word queries and quoted phrases.
 */
export function escapeFtsQuery(query: string): string {
	// Already quoted — pass through
	if (/^".+"$/.test(query)) return query;

	// Split into tokens, escape each, rejoin as implicit AND
	const tokens = query.trim().split(/\s+/).filter(Boolean);
	return tokens.map((t) => {
		// If token contains FTS-special chars, quote it
		if (/["'*:^(){}|\[\]]/.test(t)) {
			return `"${t.replace(/"/g, "")}"`;
		}
		return t;
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
}

/**
 * Walk the project directory and index all supported files.
 * Returns { indexed, skipped, totalMs }.
 */
export function fullIndex(
	projectRoot: string,
	store: Store,
	relativeTo: string,
): { indexed: number; skipped: number; removed: number; totalMs: number } {
	const start = Date.now();
	const extensions = new Set(getSupportedExtensions());

	// Collect all existing indexed files for removal detection
	const existingFiles = new Map<string, string>();
	for (const row of store.getAllFiles()) {
		existingFiles.set(row.path, row.hash);
	}

	const indexedFiles = new Set<string>();
	let indexed = 0;
	let skipped = 0;

	// Walk directory
	function walk(dir: string) {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			// Skip hidden, node_modules, vendor, etc.
			if (entry.name.startsWith(".")) continue;
			if (
				entry.name === "node_modules" ||
				entry.name === "vendor" ||
				entry.name === "vendor" ||
				entry.name === "dist" ||
				entry.name === "build" ||
				entry.name === ".git" ||
				entry.name === "__pycache__"
			)
				continue;

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
						const content = fs.readFileSync(fullPath, "utf8");
						const hash = hashContent(content);
						if (hash === existing) {
							needsIndex = false;
						}
					} catch {
						needsIndex = false;
					}
				}

				if (needsIndex) {
					const result = indexFile(fullPath, relativePath);
					if (result) {
						store.indexFile(relativePath, result.language, result.hash, result.symbols);
						indexed++;
					} else {
						skipped++;
					}
				}

				indexedFiles.add(relativePath);
			}
		}
	}

	walk(projectRoot);

	// Remove files that no longer exist
	let removed = 0;
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
): boolean {
	const relativePath = path.relative(relativeTo, absolutePath);
	const result = indexFile(absolutePath, relativePath);
	if (result) {
		store.indexFile(relativePath, result.language, result.hash, result.symbols);
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
 * Find references to a symbol by searching for its name across indexed files
 * and verifying with import analysis.
 */
export function findReferences(
	name: string,
	definitionFile: string | undefined,
	store: Store,
	projectRoot: string,
): ReferenceResult[] {
	const results: ReferenceResult[] = [];

	// Get all files that might reference this symbol
	const files = new Set<string>();

	// Add the definition file
	if (definitionFile) files.add(definitionFile);

	// We need to grep for the name in all indexed files
	// For now, use a pragmatic approach: search file contents for the identifier
	const allIndexedFiles = store.getAllFiles();

	for (const { path: relPath } of allIndexedFiles) {
		const fullPath = path.resolve(projectRoot, relPath);
		try {
			const content = fs.readFileSync(fullPath, "utf8");
			const lines = content.split("\n");

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				// Simple word-boundary check for the name
				const regex = new RegExp(`\\b${escapeRegex(name)}\\b`);
				if (regex.test(line)) {
					const col = line.indexOf(name);
					if (col === -1) continue;

					const isDef =
						definitionFile &&
						relPath === definitionFile &&
						store.findDefinitionsInFile(name, relPath).some(
							(s) => s.line === i + 1,
						);

					results.push({
						file: relPath,
						line: i + 1,
						column: col,
						lineText: line.trim(),
						isDefinition: !!isDef,
						confidence: isDef ? "high" : relPath === definitionFile ? "high" : "medium",
					});
				}
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
): FetchContextResult {
	const { contextFile, before = 5, after = 5, maxLines: rawMax = 100 } = options;
	const maxLines = Math.min(rawMax, 200); // Hard cap at 200

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
		return buildContainerResult(sym, store, lines, totalLines, maxLines);
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
): FetchContextResult {
	const scopeName = sym.name;
	const members = store.findMembersOfScope(sym.file, scopeName);

	// Declaration lines: from sym.line to first member or endLine (whichever is smaller)
	const declEnd = members.length > 0
		? Math.min(members[0].line - 1, sym.endLine)
		: Math.min(sym.line + 10, sym.endLine); // Up to 10 lines of declaration

	const headerLines: string[] = [];
	for (let i = sym.line - 1; i < declEnd && i < totalLines; i++) {
		headerLines.push(formatLine(i + 1, lines[i]));
	}

	let content = `${sym.file}:${sym.line}-${sym.endLine}\n`;
	content += "━".repeat(40) + "\n";
	content += headerLines.join("\n") + "\n";

	if (members.length > 0) {
		content += "\n── Members ──\n";
		const maxMembers = maxLines - headerLines.length - 5; // Reserve lines for header/separators
		const shown = members.slice(0, Math.max(maxMembers, 10));
		for (const m of shown) {
			const vis = m.visibility ? `[${m.visibility}] ` : "";
			const sig = m.signature && m.signature.length < 80 ? `  ${m.signature}` : "";
			content += `  ${m.line} | ${vis}${m.kind} ${m.name}${sig}\n`;
		}
		if (members.length > shown.length) {
			content += `  ... and ${members.length - shown.length} more members\n`;
		}
	} else {
		content += "  (no members indexed)\n";
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
 * Build result with asymmetric padding around symbol definition.
 * Applies smart centering when symbol body exceeds available space.
 */
function buildPaddedResult(
	sym: SymbolRecord,
	lines: string[],
	totalLines: number,
	before: number,
	after: number,
	maxLines: number,
): FetchContextResult {
	const symBodyLines = sym.endLine - sym.line + 1;
	const requestedTotal = before + symBodyLines + after;

	let startLine: number;
	let endLine: number;

	if (requestedTotal <= maxLines) {
		// Fits within budget — use requested padding
		startLine = Math.max(1, sym.line - before);
		endLine = Math.min(totalLines, sym.endLine + after);
	} else {
		// Exceeds budget — smart centering around definition line
		const halfBudget = Math.floor((maxLines - symBodyLines) / 2);
		startLine = Math.max(1, sym.line - halfBudget);
		endLine = startLine + maxLines - 1;
		if (endLine > totalLines) {
			endLine = totalLines;
			startLine = Math.max(1, endLine - maxLines + 1);
		}
	}

	const truncated = endLine - startLine + 1 < requestedTotal;

	let content = `${sym.file}:${startLine}-${endLine}\n`;
	content += "━".repeat(40) + "\n";

	for (let i = startLine - 1; i < endLine && i < totalLines; i++) {
		content += formatLine(i + 1, lines[i]) + "\n";
	}

	if (truncated) {
		content += `... (truncated: show full context via read tool with lines ${sym.line - before}-${sym.endLine + after})\n`;
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
 * Re-index FTS content for stale files. Returns count of re-indexed files.
 */
export function refreshStaleContent(
	projectRoot: string,
	store: Store,
): number {
	const tracked = store.getAllTrackedFiles();
	let refreshed = 0;

	for (const { path: relPath, hash } of tracked) {
		const fullPath = path.resolve(projectRoot, relPath);
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
			}
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
): ContentSearchResult[] {
	// First, refresh any stale content
	refreshStaleContent(projectRoot, store);

	const ftsQuery = escapeFtsQuery(query);
	const rawResults = store.searchContentFts(ftsQuery, limit * 3); // Over-fetch for ranking

	if (rawResults.length === 0) return [];

	// For each matching file, find all matching lines by grepping the original content
	const results: ContentSearchResult[] = [];
	const queryTerms = query.trim().toLowerCase().split(/\s+/);

	for (const { path: relPath, rank } of rawResults) {
		const fullPath = path.resolve(projectRoot, relPath);
		let lines: string[];
		try {
			lines = fs.readFileSync(fullPath, "utf8").split("\n");
		} catch {
			continue;
		}

		// Get symbols in this file for metadata
		const fileSymbols = store.findSymbolsInFile(relPath);

		for (let i = 0; i < lines.length; i++) {
			const lineLower = lines[i].toLowerCase();
			// Check if all query terms appear in this line
			const allMatch = queryTerms.every((term) => lineLower.includes(term));
			if (!allMatch) continue;

			const lineNum = i + 1;

			// Find enclosing symbol
			let enclosingSymbol: string | null = null;
			let enclosingKind: string | null = null;
			for (const sym of fileSymbols) {
				if (lineNum >= sym.line && lineNum <= sym.endLine) {
					enclosingSymbol = sym.name;
					enclosingKind = sym.kind;
					break;
				}
			}

			// Check if match is in a symbol name or signature
			let inSymbolName = false;
			for (const sym of fileSymbols) {
				if (lineNum === sym.line) {
					inSymbolName = true;
					break;
				}
				if (sym.signature && lineNum >= sym.line && lineNum <= sym.line + 2) {
					// Signature spans first few lines of definition
					inSymbolName = true;
					break;
				}
			}

			results.push({
				file: relPath,
				line: lineNum,
				lineText: lines[i].trim(),
				enclosingSymbol,
				enclosingKind,
				inSymbolName,
				rank,
			});
		}
	}

	// Sort: symbol name matches first (boosted), then by rank, then file/line
	results.sort((a, b) => {
		// Boost symbol name/signature matches
		if (a.inSymbolName && !b.inSymbolName) return -1;
		if (!a.inSymbolName && b.inSymbolName) return 1;

		// Then by FTS rank (lower = more relevant)
		if (a.rank !== b.rank) return a.rank - b.rank;

		// Tiebreak: file path, then line
		if (a.file !== b.file) return a.file.localeCompare(b.file);
		return a.line - b.line;
	});

	return results.slice(0, limit);
}
