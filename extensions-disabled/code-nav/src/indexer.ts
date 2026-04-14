/**
 * Indexer: parses source files with web-tree-sitter and extracts symbols.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Language as WasmLanguage, Query, Tree } from "web-tree-sitter";
import type { LanguageDef } from "./languages/registry.js";
import { detectLanguage, getParser, getLoadedLanguage } from "./languages/registry.js";
import type { SymbolRecord } from "./store.js";

export interface IndexResult {
	symbols: Omit<SymbolRecord, "id">[];
	language: string;
	hash: string;
}

/**
 * Index a single file. Returns extracted symbols and metadata.
 * Returns undefined if the file can't be indexed (unsupported language, too large, etc.).
 */
export function indexFile(
	filePath: string,
	relativePath: string,
	maxFileSize: number = 1_000_000,
): IndexResult | undefined {
	const langDef = detectLanguage(filePath);
	if (!langDef) return undefined;

	const loaded = getLoadedLanguage(langDef);
	if (!loaded) return undefined;

	// Read and check file
	let source: string;
	try {
		const stat = fs.statSync(filePath);
		if (stat.size > maxFileSize) return undefined;
		source = fs.readFileSync(filePath, "utf8");
	} catch {
		return undefined;
	}

	const hash = hashContent(source);
	const parser = getParser();
	parser.setLanguage(loaded.lang);

	const tree = parser.parse(source);
	if (!tree) return undefined;

	const symbols = extractSymbols(tree, source, relativePath, langDef, loaded.queries);
	return { symbols, language: langDef.name, hash };
}

/**
 * Extract symbols from a parsed tree using language-specific queries.
 */
function extractSymbols(
	tree: Tree,
	source: string,
	filePath: string,
	langDef: LanguageDef,
	queries: Map<string, Query>,
): Omit<SymbolRecord, "id">[] {
	const symbols: Omit<SymbolRecord, "id">[] = [];

	for (const [kind, query] of queries) {
		try {
			const matches = query.matches(tree.rootNode);
			for (const match of matches) {
				const nameCapture = match.captures.find((c) => c.name === "name");
				const nodeCapture = match.captures.find((c) => c.name === "node");
				if (!nameCapture) continue;

				const nameNode = nameCapture.node;
				const node = nodeCapture?.node ?? nameNode;

				// Skip very short names (single chars, underscores)
				const name = nameNode.text;
				if (name.length < 2) continue;

				// Determine scope (parent class/function)
				const scope = findScope(node);

				// Extract signature (first line of the node text)
				const signature = extractSignature(node.text, kind);

				// Visibility
				const visibility = extractVisibility(node, langDef);
				const normalizedKind = normalizeKind(kind, node, langDef);

				symbols.push({
					file: filePath,
					name,
					kind: normalizedKind,
					line: node.startPosition.row + 1,
					column: node.startPosition.column,
					endLine: node.endPosition.row + 1,
					endColumn: node.endPosition.column,
					signature,
					scope,
					visibility,
					documentation: null,
					parentId: null,
				});
			}
		} catch {
			// Skip failing queries
		}
	}

	// Deduplicate by (file, name, kind, line)
	const seen = new Set<string>();
	const deduped: Omit<SymbolRecord, "id">[] = [];
	for (const sym of symbols) {
		const key = `${sym.file}:${sym.name}:${sym.kind}:${sym.line}`;
		if (!seen.has(key)) {
			seen.add(key);
			deduped.push(sym);
		}
	}

	return deduped;
}

/**
 * Find the enclosing scope (class, interface, etc.) for a node.
 */
function findScope(node: any): string | null {
	let current = node.parent;
	const parts: string[] = [];

	while (current) {
		const type = current.type;
		// Class-like containers
		if (
			type === "class_declaration" ||
			type === "interface_declaration" ||
			type === "trait_declaration" ||
			type === "enum_declaration"
		) {
			const nameNode = current.childForFieldName?.("name");
			if (nameNode) parts.unshift(nameNode.text);
		}
		// Python class
		if (type === "class_definition") {
			const nameNode = current.childForFieldName?.("name");
			if (nameNode) parts.unshift(nameNode.text);
		}
		current = current.parent;
	}

	return parts.length > 0 ? parts.join(".") : null;
}

/**
 * Extract a one-line signature from node text.
 */
function extractSignature(text: string, kind: string): string {
	const firstLine = text.split("\n")[0];
	// Trim to reasonable length
	if (firstLine.length > 120) {
		return firstLine.slice(0, 117) + "...";
	}
	return firstLine;
}

/**
 * Extract visibility modifier if present.
 */
function extractVisibility(node: any, langDef: LanguageDef): string | null {
	// For PHP, check for visibilityModifier child in parent
	if (langDef.name === "php") {
		// method_declaration has a visibility_modifier child
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i);
			if (child?.type === "visibility_modifier") {
				return child.text; // "public", "private", "protected"
			}
		}
	}

	// For TS/JS, check for accessibility modifier
	if (langDef.name === "typescript" || langDef.name === "tsx") {
		for (let i = 0; i < node.childCount; i++) {
			const child = node.child(i);
			if (
				child?.type === "accessibility_modifier" ||
				child?.text === "public" ||
				child?.text === "private" ||
				child?.text === "protected"
			) {
				return child.text;
			}
		}
	}

	// Python: check for "_" prefix convention
	if (langDef.name === "python") {
		const nameNode = node.childForFieldName?.("name");
		if (nameNode) {
			if (nameNode.text.startsWith("__") && nameNode.text.endsWith("__")) return null;
			if (nameNode.text.startsWith("__")) return "private";
			if (nameNode.text.startsWith("_")) return "protected";
		}
	}

	return null;
}

/**
 * Normalize query kind to a clean symbol kind.
 */
function normalizeKind(kind: string, node: any, langDef: LanguageDef): string {
	let normalized = kind;

	// Strip decorators
	if (normalized.startsWith("decorated_")) {
		normalized = normalized.slice("decorated_".length);
	}
	// Map arrow_function → function
	if (normalized === "arrow_function") {
		normalized = "function";
	}
	// Map enum_member → constant
	if (normalized === "enum_member") {
		normalized = "constant";
	}
	// Classify const declarations as constants for TS/TSX/JS
	if (normalized === "variable" && isConstDeclarator(node, langDef)) {
		normalized = "constant";
	}

	return normalized;
}

function isConstDeclarator(node: any, langDef: LanguageDef): boolean {
	if (
		langDef.name !== "typescript" &&
		langDef.name !== "tsx" &&
		langDef.name !== "javascript"
	) {
		return false;
	}

	const parent = node?.parent;
	if (!parent) return false;
	if (parent.type !== "lexical_declaration" && parent.type !== "variable_declaration") {
		return false;
	}

	return /^\s*const\b/.test(parent.text ?? "");
}

/**
 * Hash file content for change detection.
 */
export function hashContent(content: string): string {
	return crypto.createHash("md5").update(content).digest("hex").slice(0, 16);
}
