/**
 * Indexer: parses source files with web-tree-sitter and extracts symbols.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Language as WasmLanguage, Query, Tree } from "web-tree-sitter";
import type { LanguageDef } from "./languages/registry.js";
import { detectLanguage, getParser, getLoadedLanguage } from "./languages/registry.js";
import type { SymbolRecord, EdgeRecord } from "./store.js";

export interface IndexResult {
	symbols: Omit<SymbolRecord, "id">[];
	edges: Omit<EdgeRecord, "id">[];
	language: string;
	hash: string;
}

export interface IndexerConfig {
	/** Min identifier length to index. Default: 2. */
	minNameLength: number;
	/** Max signature text length before truncation. Default: 120. */
	maxSignatureLength: number;
}

/**
 * Index a single file. Returns extracted symbols, edges, and metadata.
 * Returns undefined if the file can't be indexed (unsupported language, too large, etc.).
 */
export function indexFile(
	filePath: string,
	relativePath: string,
	maxFileSize: number = 1_000_000,
	indexerConfig?: IndexerConfig,
	projectRoot?: string,
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

	const symbols = extractSymbols(tree, source, relativePath, langDef, loaded.queries, indexerConfig);
	const edges = extractEdges(tree, source, relativePath, langDef, projectRoot);
	return { symbols, edges, language: langDef.name, hash };
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
	indexerConfig?: IndexerConfig,
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
				if (name.length < (indexerConfig?.minNameLength ?? 2)) continue;

				// Determine scope (parent class/function)
				const scope = findScope(node);

				// Extract signature (first line of the node text)
				const signature = extractSignature(node.text, kind, indexerConfig?.maxSignatureLength);

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
function extractSignature(text: string, kind: string, maxSignatureLength: number = 120): string {
	const firstLine = text.split("\n")[0];
	// Trim to reasonable length
	if (firstLine.length > maxSignatureLength) {
		return firstLine.slice(0, maxSignatureLength - 3) + "...";
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

// ---- Edge extraction ----

type EdgeData = Omit<EdgeRecord, "id">;

/**
 * Extract relationship edges (imports, extends, implements) from a parsed tree.
 * Dispatches to language-specific extractors.
 */
function extractEdges(
	tree: Tree,
	source: string,
	relativePath: string,
	langDef: LanguageDef,
	projectRoot?: string,
): EdgeData[] {
	const langName = langDef.name;
	if (langName === "typescript" || langName === "tsx" || langName === "javascript") {
		return extractJsTsEdges(tree, relativePath, langDef, projectRoot);
	}
	if (langName === "python") {
		return extractPythonEdges(tree, relativePath, langDef, projectRoot);
	}
	if (langName === "php") {
		return extractPhpEdges(tree, relativePath, langDef, projectRoot);
	}
	return [];
}

// ---- TS / JS edge extraction ----

/** Extensions to try when resolving relative imports. */
const TS_RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function extractJsTsEdges(
	tree: Tree,
	relativePath: string,
	langDef: LanguageDef,
	projectRoot?: string,
): EdgeData[] {
	const edges: EdgeData[] = [];
	const root = tree.rootNode;

	// Walk all top-level and export_statement-wrapped children
	for (let i = 0; i < root.childCount; i++) {
		const node = root.child(i);
		if (!node) continue;

		if (node.type === "import_statement") {
			edges.push(...extractTsImportEdges(node, relativePath, langDef, projectRoot));
		} else if (node.type === "export_statement") {
			// export_statement may contain a declaration (class, function) or re-exports
			// Check for re-exports first
			const sourceNode = node.childForFieldName?.("source");
			const rawPath = extractStringContent(sourceNode);
			if (rawPath) {
				// Re-export: export { X } from './y' or export * from './y'
				edges.push(...extractTsReExportEdges(node, relativePath, langDef, projectRoot));
			} else {
				// Wrapped declaration: export class X extends Y { ... }
				const decl = node.childForFieldName?.("declaration");
				if (decl?.type === "class_declaration") {
					edges.push(...extractTsClassHeritage(decl, relativePath));
				}
			}
		} else if (node.type === "class_declaration") {
			edges.push(...extractTsClassHeritage(node, relativePath));
		}
	}

	return edges;
}

/**
 * Extract edges from a TS/JS import statement.
 *
 * Handles:
 *   import { a, b } from './x'   → one edge per specifier
 *   import Default from './x'     → one edge (sourceSymbol = "Default")
 *   import * as ns from './x'     → one edge (sourceSymbol = "ns", targetSymbol = null)
 *   import './x'                  → one edge (sourceSymbol = null)
 */
function extractTsImportEdges(
	node: any,
	relativePath: string,
	langDef: LanguageDef,
	projectRoot?: string,
): EdgeData[] {
	const sourceNode = node.childForFieldName?.("source");
	const rawPath = extractStringContent(sourceNode);
	if (!rawPath) return [];

	const resolvedTarget = projectRoot
		? resolveImportPath(relativePath, rawPath, projectRoot, TS_RESOLVE_EXTENSIONS)
		: null;
	const line = node.startPosition.row + 1;

	// Find the import_clause by type (not by field name — TS grammar doesn't use "clause")
	const clause = findChildByType(node, "import_clause");
	if (!clause) {
		// Side-effect import: import './x'
		return [{ sourceFile: relativePath, sourceSymbol: null, targetFile: resolvedTarget, targetSymbol: null, relationship: "imports", line, rawSource: rawPath }];
	}

	const edges: EdgeData[] = [];

	// Named imports: { a, b, c }
	const namedImports = findDescendantsByType(clause, "import_specifier");
	if (namedImports.length > 0) {
		for (const spec of namedImports) {
			const nameNode = spec.childForFieldName?.("name");
			const name = nameNode?.text;
			if (!name) continue;
			// Check for alias: import { a as b }
			const aliasNode = spec.childForFieldName?.("alias");
			const localName = aliasNode?.text ?? name;
			edges.push({ sourceFile: relativePath, sourceSymbol: localName, targetFile: resolvedTarget, targetSymbol: name, relationship: "imports", line, rawSource: rawPath });
		}
		return edges;
	}

	// Default import: import Default from './x'
	// The import_clause may directly contain an identifier for default imports
	for (let i = 0; i < clause.childCount; i++) {
		const child = clause.child(i);
		if (child?.type === "identifier") {
			edges.push({ sourceFile: relativePath, sourceSymbol: child.text, targetFile: resolvedTarget, targetSymbol: null, relationship: "imports", line, rawSource: rawPath });
			return edges;
		}
	}

	// Namespace import: import * as ns from './x'
	const nsImport = findDescendantByType(clause, "namespace_import");
	if (nsImport) {
		// The identifier inside namespace_import is the alias
		for (let i = 0; i < nsImport.childCount; i++) {
			const child = nsImport.child(i);
			if (child?.type === "identifier") {
				edges.push({ sourceFile: relativePath, sourceSymbol: child.text, targetFile: resolvedTarget, targetSymbol: null, relationship: "imports", line, rawSource: rawPath });
				return edges;
			}
		}
		// Fallback: no identifier found
		edges.push({ sourceFile: relativePath, sourceSymbol: null, targetFile: resolvedTarget, targetSymbol: null, relationship: "imports", line, rawSource: rawPath });
		return edges;
	}

	// Fallback: couldn't parse specifiers, record as file-level import
	return [{ sourceFile: relativePath, sourceSymbol: null, targetFile: resolvedTarget, targetSymbol: null, relationship: "imports", line, rawSource: rawPath }];
}

/**
 * Extract edges from a TS/JS re-export statement.
 *
 * Handles:
 *   export { a } from './x'
 *   export * from './x'
 */
function extractTsReExportEdges(
	node: any,
	relativePath: string,
	langDef: LanguageDef,
	projectRoot?: string,
): EdgeData[] {
	// Only handle re-exports that have a source (string)
	const sourceNode = node.childForFieldName?.("source");
	const rawPath = extractStringContent(sourceNode);
	if (!rawPath) return [];

	const resolvedTarget = projectRoot
		? resolveImportPath(relativePath, rawPath, projectRoot, TS_RESOLVE_EXTENSIONS)
		: null;
	const line = node.startPosition.row + 1;

	const edges: EdgeData[] = [];

	// Named re-exports: export { a, b } from './x'
	const exportSpecifiers = findDescendantsByType(node, "export_specifier");
	if (exportSpecifiers.length > 0) {
		for (const spec of exportSpecifiers) {
			const nameNode = spec.childForFieldName?.("name");
			const name = nameNode?.text;
			if (!name) continue;
			const aliasNode = spec.childForFieldName?.("alias");
			const localName = aliasNode?.text ?? name;
			edges.push({ sourceFile: relativePath, sourceSymbol: localName, targetFile: resolvedTarget, targetSymbol: name, relationship: "re_exports", line, rawSource: rawPath });
		}
		return edges;
	}

	// Star re-export: export * from './x'
	if (node.text?.includes("*")) {
		return [{ sourceFile: relativePath, sourceSymbol: null, targetFile: resolvedTarget, targetSymbol: null, relationship: "re_exports", line, rawSource: rawPath }];
	}

	return [];
}

/**
 * Extract extends/implements edges from a TS/JS class declaration.
 */
function extractTsClassHeritage(
	node: any,
	relativePath: string,
): EdgeData[] {
	const edges: EdgeData[] = [];
	const nameNode = node.childForFieldName?.("name");
	const className = nameNode?.text;
	const line = node.startPosition.row + 1;

	// Walk children for heritage clauses
	for (let i = 0; i < node.childCount; i++) {
		const child = node.child(i);
		if (!child) continue;

		if (child.type === "class_heritage") {
			for (let j = 0; j < child.childCount; j++) {
				const heritageChild = child.child(j);
				if (!heritageChild) continue;

				if (heritageChild.type === "extends_clause") {
					// Get the first type_identifier or identifier
					const extended = findFirstIdentifier(heritageChild);
					if (extended) {
						edges.push({ sourceFile: relativePath, sourceSymbol: className ?? null, targetFile: null, targetSymbol: extended, relationship: "extends", line, rawSource: null });
					}
				}

				if (heritageChild.type === "implements_clause") {
					// May implement multiple interfaces
					const typeIds = findDescendantsByType(heritageChild, "type_identifier");
					for (const tid of typeIds) {
						edges.push({ sourceFile: relativePath, sourceSymbol: className ?? null, targetFile: null, targetSymbol: tid.text, relationship: "implements", line, rawSource: null });
					}
				}
			}
		}
	}

	return edges;
}

// ---- Python edge extraction ----

function extractPythonEdges(
	tree: Tree,
	relativePath: string,
	langDef: LanguageDef,
	projectRoot?: string,
): EdgeData[] {
	const edges: EdgeData[] = [];
	const root = tree.rootNode;

	for (let i = 0; i < root.childCount; i++) {
		const node = root.child(i);
		if (!node) continue;

		if (node.type === "import_statement") {
			// import X, Y
			const dottedNames = findDescendantsByType(node, "dotted_name");
			for (const dn of dottedNames) {
				const rawPath = dn.text;
				const resolved = projectRoot ? resolvePythonImport(rawPath, projectRoot) : null;
				edges.push({ sourceFile: relativePath, sourceSymbol: null, targetFile: resolved, targetSymbol: null, relationship: "imports", line: node.startPosition.row + 1, rawSource: rawPath });
			}
		} else if (node.type === "import_from_statement") {
			// from X import a, b
			const moduleNode = node.childForFieldName?.("module_name");
			const rawModule = moduleNode?.text;
			if (rawModule) {
				const resolved = projectRoot ? resolvePythonImport(rawModule, projectRoot) : null;
				// Extract imported names
				const importedNames = extractPythonImportedNames(node);
				if (importedNames.length > 0) {
					for (const name of importedNames) {
						edges.push({ sourceFile: relativePath, sourceSymbol: name, targetFile: resolved, targetSymbol: name, relationship: "imports", line: node.startPosition.row + 1, rawSource: rawModule });
					}
				} else {
					// from X import * or couldn't parse names
					edges.push({ sourceFile: relativePath, sourceSymbol: null, targetFile: resolved, targetSymbol: null, relationship: "imports", line: node.startPosition.row + 1, rawSource: rawModule });
				}
			}
		} else if (node.type === "class_definition") {
			edges.push(...extractPythonClassHeritage(node, relativePath));
		}
		// Also handle decorated classes
		if (node.type === "decorated_definition") {
			for (let j = 0; j < node.childCount; j++) {
				const inner = node.child(j);
				if (inner?.type === "class_definition") {
					edges.push(...extractPythonClassHeritage(inner, relativePath));
				}
			}
		}
	}

	return edges;
}

function extractPythonImportedNames(node: any): string[] {
	const names: string[] = [];
	// Skip children whose field name is 'module_name' — those are the source module, not imported names
	for (let i = 0; i < node.childCount; i++) {
		const child = node.child(i);
		if (!child) continue;

		// Skip the module_name field (the source module)
		const fieldName = node.fieldNameForChild?.(i);
		if (fieldName === "module_name") continue;

		if (child.type === "identifier") {
			names.push(child.text);
		} else if (child.type === "dotted_name") {
			// from X import Y.Z → get the first identifier
			const firstId = child.child(0);
			if (firstId?.type === "identifier") {
				names.push(firstId.text);
			}
		} else if (child.type === "aliased_import") {
			// from X import Y as Z → name is first child
			const firstChild = child.child(0);
			if (firstChild) {
				// Could be dotted_name or identifier
				const nameText = firstChild.type === "dotted_name"
					? firstChild.child(0)?.text
					: firstChild.text;
				if (nameText) names.push(nameText);
			}
		} else if (child.type === "wildcard_import") {
			// from X import *
			return []; // Wildcard — treat as whole-module import
		}
	}
	return names;
}

function extractPythonClassHeritage(
	node: any,
	relativePath: string,
): EdgeData[] {
	const edges: EdgeData[] = [];
	const nameNode = node.childForFieldName?.("name");
	const className = nameNode?.text;
	const line = node.startPosition.row + 1;

	// Python inheritance is in the argument_list: class Dog(Animal, Base):
	const argList = findDescendantByType(node, "argument_list");
	if (argList) {
		for (let i = 0; i < argList.childCount; i++) {
			const child = argList.child(i);
			if (child?.type === "identifier" || child?.type === "attribute") {
				edges.push({ sourceFile: relativePath, sourceSymbol: className ?? null, targetFile: null, targetSymbol: child.text, relationship: "extends", line, rawSource: null });
			}
		}
	}

	return edges;
}

/**
 * Resolve a Python module path to a file.
 * E.g., "utils" → "utils.py", "a.b" → "a/b.py" or "a/b/__init__.py"
 */
function resolvePythonImport(modulePath: string, projectRoot: string): string | null {
	const parts = modulePath.split(".");
	const relPath = parts.join("/");

	// Try as file: a/b.py
	const asFile = relPath + ".py";
	if (fs.existsSync(path.resolve(projectRoot, asFile))) return asFile;

	// Try as package: a/b/__init__.py
	const asPkg = path.join(relPath, "__init__.py");
	if (fs.existsSync(path.resolve(projectRoot, asPkg))) return asPkg;

	// Try relative to common source dirs
	for (const srcDir of ["src", "lib"]) {
		const withSrc = path.join(srcDir, asFile);
		if (fs.existsSync(path.resolve(projectRoot, withSrc))) return withSrc;
		const withSrcPkg = path.join(srcDir, asPkg);
		if (fs.existsSync(path.resolve(projectRoot, withSrcPkg))) return withSrcPkg;
	}

	return null;
}

// ---- PHP edge extraction ----

function extractPhpEdges(
	tree: Tree,
	relativePath: string,
	langDef: LanguageDef,
	projectRoot?: string,
): EdgeData[] {
	const edges: EdgeData[] = [];
	const root = tree.rootNode;

	// PHP has a namespace_declaration wrapping the program, or the program directly
	// Walk all top-level and namespace-level nodes
	walkPhpNodes(root, relativePath, edges);

	return edges;
}

function walkPhpNodes(node: any, relativePath: string, edges: EdgeData[]) {
	for (let i = 0; i < node.childCount; i++) {
		const child = node.child(i);
		if (!child) continue;

		if (child.type === "namespace_use_declaration") {
			edges.push(...extractPhpUseStatement(child, relativePath));
		} else if (child.type === "class_declaration") {
			edges.push(...extractPhpClassHeritage(child, relativePath));
		} else if (child.type === "namespace_definition") {
			// Recurse into namespace body
			walkPhpNodes(child, relativePath, edges);
		} else if (child.type === "program") {
			// Top-level program node
			walkPhpNodes(child, relativePath, edges);
		}
	}
}

function extractPhpUseStatement(
	node: any,
	relativePath: string,
): EdgeData[] {
	const edges: EdgeData[] = [];
	const line = node.startPosition.row + 1;

	// use Namespace\Class;
	// use Namespace\Class as Alias;
	const useClauses = findDescendantsByType(node, "namespace_use_clause");
	for (const clause of useClauses) {
		const nameNodes = findDescendantsByType(clause, "name");
		const fullName = nameNodes.map((n: any) => n.text).join("\\");
		if (!fullName) continue;

		// Last part is the short name
		const shortName = nameNodes.length > 0 ? nameNodes[nameNodes.length - 1].text : null;
		// Check for alias
		const aliasNode = findDescendantByType(clause, "namespace_aliasing_clause");
		const localName = aliasNode ? findDescendantByType(aliasNode, "name")?.text : shortName;

		edges.push({
			sourceFile: relativePath,
			sourceSymbol: localName ?? null,
			targetFile: null, // Can't resolve PHP namespaces without autoloader config
			targetSymbol: fullName,
			relationship: "imports",
			line,
			rawSource: fullName,
		});
	}

	// use function Namespace\func; (function imports)
	const funcClauses = findDescendantsByType(node, "namespace_use_function_clause");
	for (const clause of funcClauses) {
		const nameNodes = findDescendantsByType(clause, "name");
		const fullName = nameNodes.map((n: any) => n.text).join("\\");
		if (fullName) {
			const shortName = nameNodes.length > 0 ? nameNodes[nameNodes.length - 1].text : null;
			edges.push({ sourceFile: relativePath, sourceSymbol: shortName ?? null, targetFile: null, targetSymbol: fullName, relationship: "imports", line, rawSource: fullName });
		}
	}

	// Group use: use Namespace\{ClassA, ClassB}
	const useGroupClauses = findDescendantsByType(node, "namespace_use_group");
	if (useGroupClauses.length > 0) {
		// Already handled via namespace_use_clause inside the group
	}

	// If no specific clauses found, try extracting the raw name
	if (edges.length === 0) {
		const nameNodes = findDescendantsByType(node, "name");
		if (nameNodes.length >= 1) {
			const fullName = nameNodes.map((n: any) => n.text).join("\\");
			const shortName = nameNodes[nameNodes.length - 1].text;
			edges.push({ sourceFile: relativePath, sourceSymbol: shortName, targetFile: null, targetSymbol: fullName, relationship: "imports", line, rawSource: fullName });
		}
	}

	return edges;
}

function extractPhpClassHeritage(
	node: any,
	relativePath: string,
): EdgeData[] {
	const edges: EdgeData[] = [];
	const nameNode = node.childForFieldName?.("name");
	const className = nameNode?.text;
	const line = node.startPosition.row + 1;

	// extends
	const baseClause = findDescendantByType(node, "base_clause");
	if (baseClause) {
		const nameNodes = findDescendantsByType(baseClause, "name");
		for (const name of nameNodes) {
			edges.push({ sourceFile: relativePath, sourceSymbol: className ?? null, targetFile: null, targetSymbol: name.text, relationship: "extends", line, rawSource: null });
		}
	}

	// implements
	const interfaceClause = findDescendantByType(node, "class_interface_clause")
		?? findDescendantByType(node, "interface_clause");
	if (interfaceClause) {
		const nameNodes = findDescendantsByType(interfaceClause, "name");
		for (const name of nameNodes) {
			edges.push({ sourceFile: relativePath, sourceSymbol: className ?? null, targetFile: null, targetSymbol: name.text, relationship: "implements", line, rawSource: null });
		}
	}

	return edges;
}

// ---- Shared AST helpers ----

/** Extract text content from a string node (strips quotes). */
function extractStringContent(node: any): string | null {
	if (!node) return null;
	if (node.type === "string") {
		// Get the string_fragment child
		const fragment = findDescendantByType(node, "string_fragment");
		if (fragment) return fragment.text;
		// Fallback: strip quotes from the node text
		const text = node.text;
		if (text.length >= 2 && (text.startsWith("'") || text.startsWith('"') || text.startsWith("`"))) {
			return text.slice(1, -1);
		}
		return text;
	}
	return node.text;
}

/** Find a direct child node by type (non-recursive). */
function findChildByType(node: any, type: string): any {
	if (!node) return null;
	for (let i = 0; i < node.childCount; i++) {
		const child = node.child(i);
		if (child?.type === type) return child;
	}
	return null;
}

/** Find a descendant node by type (BFS). */
function findDescendantByType(node: any, type: string): any {
	const queue: any[] = [node];
	while (queue.length > 0) {
		const current = queue.shift();
		if (current?.type === type) return current;
		if (current?.childCount) {
			for (let i = 0; i < current.childCount; i++) {
				queue.push(current.child(i));
			}
		}
	}
	return null;
}

/** Find all descendant nodes of a given type. */
function findDescendantsByType(node: any, type: string): any[] {
	const results: any[] = [];
	const queue: any[] = [node];
	while (queue.length > 0) {
		const current = queue.shift();
		if (current?.type === type) {
			results.push(current);
			// Don't recurse into matches to avoid nested duplicates
			continue;
		}
		if (current?.childCount) {
			for (let i = 0; i < current.childCount; i++) {
				queue.push(current.child(i));
			}
		}
	}
	return results;
}

/** Find the first identifier or type_identifier child. */
function findFirstIdentifier(node: any): string | null {
	for (let i = 0; i < node.childCount; i++) {
		const child = node.child(i);
		if (child?.type === "identifier" || child?.type === "type_identifier") {
			return child.text;
		}
	}
	// Try deeper
	for (let i = 0; i < node.childCount; i++) {
		const child = node.child(i);
		if (child?.childCount) {
			const found = findFirstIdentifier(child);
			if (found) return found;
		}
	}
	return null;
}

// ---- Import path resolution ----

/**
 * Resolve a relative import path to an actual file in the project.
 *
 * E.g., importerFile = "src/main.ts", importPath = "./utils"
 *   → tries "src/utils.ts", "src/utils.tsx", "src/utils/index.ts", etc.
 *
 * Returns a project-root-relative path, or null if unresolvable.
 */
function resolveImportPath(
	importerRelativePath: string,
	importPath: string,
	projectRoot: string,
	extensions: string[],
): string | null {
	// Only resolve relative imports
	if (!importPath.startsWith(".")) return null;

	const importerDir = path.dirname(importerRelativePath);
	const targetRel = path.normalize(path.join(importerDir, importPath));

	// Try exact file with each extension
	for (const ext of extensions) {
		const candidate = targetRel + ext;
		if (fs.existsSync(path.resolve(projectRoot, candidate))) return candidate;
	}

	// Try as directory with index file
	for (const ext of extensions) {
		const candidate = path.join(targetRel, "index" + ext);
		if (fs.existsSync(path.resolve(projectRoot, candidate))) return candidate;
	}

	return null;
}
