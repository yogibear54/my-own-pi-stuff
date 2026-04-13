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
			"Use when you need to understand what a symbol IS or jump to its implementation.",
		promptSnippet: "Find symbol definitions (go-to-definition)",
		promptGuidelines: [
			"Use code_nav_definition instead of grep when you need to find where something is defined.",
			"Provide the symbol name and optionally the current file path for context-aware resolution.",
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
			"Use before refactoring to understand the full impact of changes.",
		promptSnippet: "Find all references to a symbol across the codebase",
		promptGuidelines: [
			"Use code_nav_references before refactoring to understand the full impact of changes.",
			"Provide the definition file if known to improve accuracy.",
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
			"or to find symbols by name across the project.",
		promptSnippet: "List symbols in a file or search workspace symbols",
		promptGuidelines: [
			"Use code_nav_symbols to get a quick overview of a file's structure before reading it.",
			"Omit 'file' and provide 'query' to search for symbols across the entire project.",
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
}
