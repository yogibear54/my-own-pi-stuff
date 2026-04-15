/**
 * Pi tool definitions for code navigation.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { Store } from "./store.js";
import type { CodeNavToolsConfig } from "./config.js";

interface IndexingPolicyDetails {
	includeHiddenPaths: boolean;
	maxFileSizeBytes: number;
	excludedDirectories: string[];
}

function getIndexingPolicy(store: Store): IndexingPolicyDetails | undefined {
	const raw = store.getMeta("indexOptions");
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return undefined;
		const includeHiddenPaths = !!parsed.includeHiddenPaths;
		const rawSize = Number(parsed.maxFileSizeBytes);
		const maxFileSizeBytes = Number.isFinite(rawSize) ? Math.max(10_000, Math.floor(rawSize)) : 1_000_000;
		const excludedDirectories = Array.isArray(parsed.excludedDirectories)
			? parsed.excludedDirectories.filter((d: unknown): d is string => typeof d === "string")
			: [];
		return { includeHiddenPaths, maxFileSizeBytes, excludedDirectories };
	} catch {
		return undefined;
	}
}

function withIndexingPolicy<T extends Record<string, unknown>>(details: T, store: Store): T & { indexingPolicy?: IndexingPolicyDetails } {
	const indexingPolicy = getIndexingPolicy(store);
	return indexingPolicy ? { ...details, indexingPolicy } : details;
}

export function registerTools(
	pi: ExtensionAPI,
	getStore: () => Store | undefined,
	getRoot: () => string,
	getConfig: () => CodeNavToolsConfig,
) {
	// Tool: Find definition
	pi.registerTool({
		name: "code_nav_definition",
		label: "Go to Definition",
		description:
			"Find where a symbol (function, class, variable, type, method) is defined. " +
			"Returns file path, line number, signature, and surrounding context. " +
			"Use when you need to understand what a symbol IS or jump to its implementation. " +
			"Uses name matching with context-file preference; not full import-graph resolution, and not for full-text search.",
		promptSnippet: "Find symbol definitions (go-to-definition)",
		promptGuidelines: [
			"Use code_nav_definition for the declaration site of a known symbol name; use code_nav_search for arbitrary text in file bodies.",
			"Provide the symbol name and optionally the current file path to prefer same-file matches when names are ambiguous.",
		],
		parameters: Type.Object({
			symbol: Type.String({
				description: "Symbol name to find the definition of",
			}),
			file: Type.Optional(
				Type.String({
					description:
						"Current file path (relative to project root). Used to prefer same-file definitions when multiple matches exist.",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (signal?.aborted) {
				throw new Error("[code-nav] Operation cancelled.");
			}
			const store = getStore();
			if (!store) {
				throw new Error("[code-nav] Index not initialized. Try again in a moment.");
			}

			const root = getRoot();
			const results = await import("./engine.js").then((e) =>
				e.findDefinitions(params.symbol, params.file, store, root),
			);

			if (results.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: `No definitions found for "${params.symbol}". The symbol may not be indexed yet.`,
						},
					],
					details: withIndexingPolicy({}, store),
				};
			}

			// Limit output
			const max = getConfig().tools.definitionMaxResults;
			const shown = results.slice(0, max);
			let text = `Found ${results.length} definition(s) for "${params.symbol}":\n\n`;

			for (const r of shown) {
				const s = r.symbol;
				const loc = `${s.file}:${s.line}`;
				const scope = s.scope ? ` (${s.scope})` : "";
				const vis = s.visibility ? `[${s.visibility}] ` : "";
				text += `  ${vis}${s.kind}${scope}: ${loc}\n`;
				if (s.signature) {
					text += `    ${s.signature}\n`;
				}
				if (r.lineText) {
					text += `    ${r.lineText}\n`;
				}
				text += "\n";
			}

			if (results.length > max) {
				text += `... and ${results.length - max} more.\n`;
			}

			return {
				content: [{ type: "text", text }],
				details: withIndexingPolicy({ definitions: shown.map((r) => r.symbol) }, store),
			};
		},
	});

	// Tool: Find references
	pi.registerTool({
		name: "code_nav_references",
		label: "Find References",
		description:
			"Find likely usages of a symbol across the codebase. " +
			"Returns file paths, line numbers, and the source line for each match. " +
			"Use before refactoring to estimate change impact. " +
			"This is lexical identifier matching (not full semantic reference resolution).",
		promptSnippet: "Find all references to a symbol across the codebase",
		promptGuidelines: [
			"Use code_nav_references to find likely symbol usages; use code_nav_definition when you only need where it is declared.",
			"Provide the definition file if known to improve accuracy (see code_nav_definition).",
		],
		parameters: Type.Object({
			symbol: Type.String({
				description: "Symbol name to find references for",
			}),
			definitionFile: Type.Optional(
				Type.String({
					description:
						"File where the symbol is defined (relative path). Improves accuracy if provided.",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (signal?.aborted) {
				throw new Error("[code-nav] Operation cancelled.");
			}
			const store = getStore();
			if (!store) {
				throw new Error("[code-nav] Index not initialized. Try again in a moment.");
			}

			const root = getRoot();
			const results = await import("./engine.js").then((e) =>
				e.findReferences(params.symbol, params.definitionFile, store, root, signal),
			);

			if (results.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: `No references found for "${params.symbol}".`,
						},
					],
					details: withIndexingPolicy({}, store),
				};
			}

			// Group by file
			const byFile = new Map<string, typeof results>();
			for (const r of results) {
				const arr = byFile.get(r.file) ?? [];
				arr.push(r);
				byFile.set(r.file, arr);
			}

			const maxFiles = getConfig().tools.referenceMaxFiles;
			const maxPerFile = getConfig().tools.referenceMaxPerFile;
			let text = `Found ${results.length} reference(s) for "${params.symbol}" in ${byFile.size} file(s):\n\n`;

			let fileCount = 0;
			for (const [file, refs] of byFile) {
				if (fileCount >= maxFiles) {
					text += `... and ${byFile.size - maxFiles} more file(s)\n`;
					break;
				}

				text += `  ${file}:\n`;
				const shown = refs.slice(0, maxPerFile);
				for (const r of shown) {
					const marker = r.isDefinition ? " [DEFINITION]" : "";
					text += `    ${r.line}: ${r.lineText}${marker}\n`;
				}
				if (refs.length > maxPerFile) {
					text += `    ... and ${refs.length - maxPerFile} more\n`;
				}
				text += "\n";
				fileCount++;
			}

			return {
				content: [{ type: "text", text }],
				details: withIndexingPolicy({ references: results.slice(0, 100) }, store),
			};
		},
	});

	// Tool: List symbols
	pi.registerTool({
		name: "code_nav_symbols",
		label: "List Symbols",
		description:
			"List symbols in a file (outline view) or search workspace symbols by name prefix. " +
			"Use to quickly understand a file's structure without reading the entire file, " +
			"or to browse indexed symbol names across the project (prefix match, not full-text in bodies).",
		promptSnippet: "List symbols in a file or search workspace symbols",
		promptGuidelines: [
			"Use code_nav_symbols for a file outline or to browse symbols by name prefix across the workspace.",
			"Omit 'file' and provide 'query' for workspace symbol search (prefix). For a resolved declaration, use code_nav_definition.",
		],
		parameters: Type.Object({
			file: Type.Optional(
				Type.String({
					description: "File path (relative to project root) to list symbols for",
				}),
			),
			query: Type.Optional(
				Type.String({
					description:
						"Search query for workspace symbols (name prefix). Use without 'file'.",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (signal?.aborted) {
				throw new Error("[code-nav] Operation cancelled.");
			}
			const store = getStore();
			if (!store) {
				throw new Error("[code-nav] Index not initialized. Try again in a moment.");
			}

			if (params.file) {
				// File outline
				const results = await import("./engine.js").then((e) =>
					e.listFileSymbols(params.file!, store),
				);

				if (results.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: `No symbols found in "${params.file}". The file may not be indexed.`,
							},
						],
						details: withIndexingPolicy({}, store),
					};
				}

				let text = `Symbols in ${params.file} (${results.length}):\n\n`;
				for (const r of results) {
					const s = r.symbol;
					const scope = s.scope ? `${s.scope}.` : "";
					const vis = s.visibility ? `[${s.visibility}] ` : "";
					text += `  ${vis}${s.kind} ${scope}${s.name} :${s.line}\n`;
					if (s.signature && s.signature.length < 120) {
						text += `    ${s.signature}\n`;
					}
				}

				return {
					content: [{ type: "text", text }],
					details: withIndexingPolicy({ symbols: results.map((r) => r.symbol) }, store),
				};
			} else if (params.query) {
				// Workspace search
				const results = await import("./engine.js").then((e) =>
					e.searchSymbols(params.query!, store, getConfig().tools.symbolSearchLimit),
				);

				if (results.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: `No symbols matching "${params.query}".`,
							},
						],
						details: withIndexingPolicy({}, store),
					};
				}

				let text = `Found ${results.length} symbol(s) matching "${params.query}":\n\n`;
				for (const r of results) {
					const s = r.symbol;
					const scope = s.scope ? ` (${s.scope})` : "";
					text += `  ${s.kind}${scope}: ${s.name} at ${s.file}:${s.line}\n`;
				}

				return {
					content: [{ type: "text", text }],
					details: withIndexingPolicy({ symbols: results.map((r) => r.symbol) }, store),
				};
			} else {
				// Stats
				const stats = store.getStats();
				return {
					content: [
						{
							type: "text",
							text: `Index stats: ${stats.symbolCount} symbols in ${stats.fileCount} files.\nProvide 'file' for an outline or 'query' to search symbols.`,
						},
					],
					details: withIndexingPolicy(stats, store),
				};
			}
		},
	});

	// Tool: Fetch context
	pi.registerTool({
		name: "code_nav_fetch_context",
		label: "Fetch Symbol Context",
		description:
			"Fetch the source code around a symbol definition with configurable padding. " +
			"Returns a code block with line numbers. For classes/interfaces/enums, returns " +
			"the declaration line plus a member summary instead of the full body. " +
			"Use to read a specific function/class implementation without loading the entire file. " +
			"Complements code_nav_definition: use definition for the declaration site, this for a wider code window.",
		promptSnippet: "Fetch source code around a symbol definition",
		promptGuidelines: [
			"Use code_nav_fetch_context after code_nav_definition when you need more implementation lines than the definition snippet.",
			"More token-efficient than reading an entire file when you only need one function or class.",
			"For classes, returns a member summary instead of the full body — read the full file if you need the entire class source.",
		],
	parameters: Type.Object({
			symbol: Type.String({
				description: "Symbol name to fetch context for",
			}),
			file: Type.Optional(
				Type.String({
					description:
						"Current file path (relative to project root). Helps resolve ambiguous symbol names.",
				}),
			),
			before: Type.Optional(
				Type.Number({
					description: "Lines of context before the symbol (default: 5)",
					minimum: 0,
					maximum: 100,
				}),
			),
			after: Type.Optional(
				Type.Number({
					description: "Lines of context after the symbol (default: 5)",
					minimum: 0,
					maximum: 100,
				}),
			),
			maxLines: Type.Optional(
				Type.Number({
					description: "Maximum total lines to return (default: 100, max: 200)",
					minimum: 10,
					maximum: 200,
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			if (signal?.aborted) {
				throw new Error("[code-nav] Operation cancelled.");
			}
			const store = getStore();
			if (!store) {
				throw new Error("[code-nav] Index not initialized. Try again in a moment.");
			}

			const root = getRoot();
			const config = getConfig();
			const result = await import("./engine.js").then((e) =>
				e.fetchContext(params.symbol, store, root, {
					contextFile: params.file,
					before: params.before,
					after: params.after,
					maxLines: params.maxLines,
				}, config.fetchContext),
			);

			return {
				content: [{ type: "text", text: result.content }],
				details: withIndexingPolicy({
					file: result.file,
					startLine: result.startLine,
					endLine: result.endLine,
					totalLines: result.totalLines,
					truncated: result.truncated,
				}, store),
			};
		},
	});

	// Tool: Search codebase content
	pi.registerTool({
		name: "code_nav_search",
		label: "Search Codebase Content",
		description:
			"Search file contents for any text across the entire codebase. " +
			"Returns matches with file path, line number, and enclosing symbol name. " +
			"Unlike code_nav_symbols (indexed symbol names / outline) or code_nav_definition (declaration resolution), " +
			"this searches raw file bodies for strings, comments, constants, and arbitrary text. " +
			"Use when looking for where a concept, string, or pattern is mentioned.",
		promptSnippet: "Search codebase file contents for text",
		promptGuidelines: [
			"Use code_nav_search for text inside files (error messages, literals, comments, partial identifiers); use code_nav_definition for symbol declarations and code_nav_symbols for outlines or name-prefix symbol browse.",
			"Use code_nav_references when you need likely symbol usages, not substring occurrence search.",
		],
		parameters: Type.Object({
			query: Type.String({
				description: "Search query. Matches all terms (implicit AND). Supports quoted phrases.",
			}),
			limit: Type.Optional(
				Type.Number({
					description: "Maximum number of results to return (default: 30, range: 10-100)",
					minimum: 10,
					maximum: 100,
				}),
			),
			scanMultiplier: Type.Optional(
				Type.Number({
					description:
						"Candidate file fan-out multiplier before line filtering (default: 50, range: 1-200).",
					minimum: 1,
					maximum: 200,
				}),
			),
			maxCandidateFiles: Type.Optional(
				Type.Number({
					description:
						"Hard cap on candidate files fetched from FTS before line filtering (default: 10000).",
					minimum: 100,
					maximum: 100000,
				}),
			),
			maxLinesScanned: Type.Optional(
				Type.Number({
					description:
						"Optional line-scan budget across candidate files (default: unlimited). Lower values can speed up large repos but may truncate.",
					minimum: 1000,
					maximum: 10000000,
				}),
			),
			includeStats: Type.Optional(
				Type.Boolean({
					description: "Include performance stats in the text output (stats are always in details).",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			if (signal?.aborted) {
				throw new Error("[code-nav] Operation cancelled.");
			}
			const store = getStore();
			if (!store) {
				throw new Error("[code-nav] Index not initialized. Try again in a moment.");
			}

			const root = getRoot();
			const config = getConfig();
			const limit = params.limit ?? config.tools.searchDefaultLimit;
			const { results, totalMatches, totalFilesMatched, truncated, stats } = await import("./engine.js").then((e) =>
				e.searchCodebase(params.query, store, root, limit, {
					scanMultiplier: params.scanMultiplier ?? config.search.defaultScanMultiplier,
					maxCandidateFiles: params.maxCandidateFiles ?? config.search.defaultMaxCandidateFiles,
					maxLinesScanned: params.maxLinesScanned ?? config.search.defaultMaxLinesScanned ?? undefined,
					signal,
				}),
			);

			if (results.length === 0) {
				const emptyQuery = !params.query || !params.query.trim();
				return {
					content: [
						{
							type: "text",
							text: emptyQuery
								? "Empty query. Provide a search term."
							: `No content matches for "${params.query}".`,
						},
					],
					details: withIndexingPolicy({ stats }, store),
				};
			}

			const matchWord = totalMatches === 1 ? "match" : "matches";
			let text = `Found ${results.length} of ${totalMatches} ${matchWord} in ${totalFilesMatched} file(s) for "${params.query}"${truncated ? " (truncated)" : ""}:\n\n`;

			let lastFile = "";
			for (const r of results) {
				if (r.file !== lastFile) {
					if (lastFile) text += "\n";
					text += `${r.file}:\n`;
					lastFile = r.file;
				}

				const loc = `  ${r.line}`;
				const symTag = r.enclosingSymbol
					? ` (inside ${r.enclosingKind} ${r.enclosingSymbol})`
					: "";
				const nameTag = r.inSymbolName ? " ★" : "";
				text += `${loc} | ${r.lineText}${symTag}${nameTag}\n`;
			}

			if (results.some((r) => r.inSymbolName)) {
				text += "\n★ = match in symbol name/signature (likely more relevant)\n";
			}

			if (truncated) {
				text += `\n${Math.max(totalMatches - results.length, 0)} more matches. Increase limit for full results.`;
			}

			if (params.includeStats) {
				const maxLinesLabel = stats.maxLinesScanned >= Number.MAX_SAFE_INTEGER
					? "unlimited"
					: String(stats.maxLinesScanned);
				text += "\n\n── Search Stats ──\n";
				text += `  refreshed files: ${stats.refreshedFiles}\n`;
				text += `  candidate files: ${stats.candidateFiles} (fetchLimit=${stats.fetchLimit})\n`;
				text += `  scanned files: ${stats.filesScanned}\n`;
				text += `  scanned lines: ${stats.linesScanned}\n`;
				text += `  config: scanMultiplier=${stats.scanMultiplier}, maxCandidateFiles=${stats.maxCandidateFiles}, maxLinesScanned=${maxLinesLabel}\n`;
				text += `  line budget hit: ${stats.hitLineScanBudget ? "yes" : "no"}\n`;
				text += `  elapsed: ${stats.totalMs}ms\n`;
			}

			return {
				content: [{ type: "text", text }],
				details: withIndexingPolicy({
					results: results.map((r) => ({
						file: r.file,
						line: r.line,
						enclosingSymbol: r.enclosingSymbol,
						enclosingKind: r.enclosingKind,
					})),
					totalMatches,
					totalFilesMatched,
					truncated,
					stats,
				}, store),
			};
		},
	});
}
