/**
 * Pi tool definitions for code navigation.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { Store } from "./store.js";
import type { Engine } from "./engine.js";

export function registerTools(
	pi: ExtensionAPI,
	getStore: () => Store | undefined,
	getRoot: () => string,
) {
	// Tool: Find definition
	pi.registerTool({
		name: "code_nav_definition",
		label: "Go to Definition",
		description:
			"Find where a symbol (function, class, variable, type, method) is defined. " +
			"Returns file path, line number, signature, and surrounding context. " +
			"Use when you need to understand what a symbol IS or jump to its implementation. " +
			"Resolves declarations (including across imports); not for listing a whole file's symbols or full-text search.",
		promptSnippet: "Find symbol definitions (go-to-definition)",
		promptGuidelines: [
			"Use code_nav_definition for the declaration site of a known symbol name; use code_nav_search for arbitrary text in file bodies.",
			"Provide the symbol name and optionally the current file path for import-aware resolution.",
		],
		parameters: Type.Object({
			symbol: Type.String({
				description: "Symbol name to find the definition of",
			}),
			file: Type.Optional(
				Type.String({
					description:
						"Current file path (relative to project root) for import-aware resolution. Provide when available.",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
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
					details: {},
				};
			}

			// Limit output
			const max = 20;
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
				details: { definitions: shown.map((r) => r.symbol) },
			};
		},
	});

	// Tool: Find references
	pi.registerTool({
		name: "code_nav_references",
		label: "Find References",
		description:
			"Find all usages of a symbol across the codebase. " +
			"Returns file paths, line numbers, and the source line for each reference. " +
			"Use before refactoring to understand the full impact of changes. " +
			"Distinct from go-to-definition: this lists call sites and reads, not only the declaration.",
		promptSnippet: "Find all references to a symbol across the codebase",
		promptGuidelines: [
			"Use code_nav_references for every usage of a symbol; use code_nav_definition when you only need where it is declared.",
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
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const store = getStore();
			if (!store) {
				throw new Error("[code-nav] Index not initialized. Try again in a moment.");
			}

			const root = getRoot();
			const results = await import("./engine.js").then((e) =>
				e.findReferences(params.symbol, params.definitionFile, store, root),
			);

			if (results.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: `No references found for "${params.symbol}".`,
						},
					],
					details: {},
				};
			}

			// Group by file
			const byFile = new Map<string, typeof results>();
			for (const r of results) {
				const arr = byFile.get(r.file) ?? [];
				arr.push(r);
				byFile.set(r.file, arr);
			}

			const maxFiles = 15;
			const maxPerFile = 10;
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
				details: { references: results.slice(0, 100) },
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
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
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
						details: {},
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
					details: { symbols: results.map((r) => r.symbol) },
				};
			} else if (params.query) {
				// Workspace search
				const results = await import("./engine.js").then((e) =>
					e.searchSymbols(params.query!, store),
				);

				if (results.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: `No symbols matching "${params.query}".`,
							},
						],
						details: {},
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
					details: { symbols: results.map((r) => r.symbol) },
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
					details: stats,
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
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const store = getStore();
			if (!store) {
				throw new Error("[code-nav] Index not initialized. Try again in a moment.");
			}

			const root = getRoot();
			const result = await import("./engine.js").then((e) =>
				e.fetchContext(params.symbol, store, root, {
					contextFile: params.file,
					before: params.before,
					after: params.after,
					maxLines: params.maxLines,
				}),
			);

			return {
				content: [{ type: "text", text: result.content }],
				details: {
					file: result.file,
					startLine: result.startLine,
					endLine: result.endLine,
					totalLines: result.totalLines,
					truncated: result.truncated,
				},
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
			"Use code_nav_references when you need every usage of a symbol, not a substring occurrence search.",
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
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const store = getStore();
			if (!store) {
				throw new Error("[code-nav] Index not initialized. Try again in a moment.");
			}

			const root = getRoot();
			const limit = params.limit ?? 30;
			const results = await import("./engine.js").then((e) =>
				e.searchCodebase(params.query, store, root, limit),
			);

			if (results.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: `No content matches for "${params.query}".`,
						},
					],
					details: {},
				};
			}

			let text = `Found ${results.length} match(es) for "${params.query}":\n\n`;

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

			return {
				content: [{ type: "text", text }],
				details: { results: results.map((r) => ({
					file: r.file,
					line: r.line,
					enclosingSymbol: r.enclosingSymbol,
					enclosingKind: r.enclosingKind,
				})) },
			};
		},
	});
}
