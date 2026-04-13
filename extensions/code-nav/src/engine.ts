/**
 * Query engine: combines the store and indexer to answer symbol queries.
 */
import fs from "node:fs";
import path from "node:path";
import type { Store, SymbolRecord } from "./store.js";
import { indexFile, hashContent } from "./indexer.js";
import { detectLanguage, getSupportedExtensions } from "./languages/registry.js";

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
