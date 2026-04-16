/**
 * Language registry: detect language from file extension, load WASM grammars,
 * and provide symbol extraction queries per language.
 */
import path from "node:path";
import type { Language, Parser as WasmParser, Query } from "web-tree-sitter";

export interface LanguageDef {
	/** Human-readable language name */
	name: string;
	/** File extensions (with leading dot), e.g. [".ts", ".tsx"] */
	extensions: string[];
	/** WASM grammar file name relative to the grammar package root */
	wasmFile: string;
	/** npm package name that ships the WASM grammar */
	package: string;
	/** Symbol extraction queries keyed by symbol kind */
	queries: Record<string, string>;
	/** How to extract the "name" text from a capture in this language */
	nameField: string;
}

// --------------- Language definitions ---------------

const LANGUAGES: LanguageDef[] = [
	{
		name: "typescript",
		extensions: [".ts"],
		wasmFile: "tree-sitter-typescript.wasm",
		package: "tree-sitter-typescript",
		nameField: "name",
		queries: {
			function: "(function_declaration name: (identifier) @name) @node",
			arrow_function:
				"(variable_declarator name: (identifier) @name value: (arrow_function) @node)",
			class: "(class_declaration name: (type_identifier) @name) @node",
			interface: "(interface_declaration name: (type_identifier) @name) @node",
			type: "(type_alias_declaration name: (type_identifier) @name) @node",
			method: "(method_definition name: (property_identifier) @name) @node",
			variable: "(variable_declarator name: (identifier) @name) @node",
			enum: "(enum_declaration name: (identifier) @name) @node",
			enum_member: "(enum_assignment name: (property_identifier) @name) @node",
		},
	},
	{
		name: "tsx",
		extensions: [".tsx"],
		wasmFile: "tree-sitter-tsx.wasm",
		package: "tree-sitter-typescript",
		nameField: "name",
		queries: {
			function: "(function_declaration name: (identifier) @name) @node",
			arrow_function:
				"(variable_declarator name: (identifier) @name value: (arrow_function) @node)",
			class: "(class_declaration name: (type_identifier) @name) @node",
			interface: "(interface_declaration name: (type_identifier) @name) @node",
			type: "(type_alias_declaration name: (type_identifier) @name) @node",
			method: "(method_definition name: (property_identifier) @name) @node",
			variable: "(variable_declarator name: (identifier) @name) @node",
			enum: "(enum_declaration name: (identifier) @name) @node",
			enum_member: "(enum_assignment name: (property_identifier) @name) @node",
		},
	},
	{
		name: "javascript",
		extensions: [".js", ".jsx", ".mjs", ".cjs"],
		wasmFile: "tree-sitter-javascript.wasm",
		package: "tree-sitter-javascript",
		nameField: "name",
		queries: {
			function: "(function_declaration name: (identifier) @name) @node",
			arrow_function:
				"(variable_declarator name: (identifier) @name value: (arrow_function) @node)",
			class: "(class_declaration name: (identifier) @name) @node",
			method: "(method_definition name: (property_identifier) @name) @node",
			variable: "(variable_declarator name: (identifier) @name) @node",
		},
	},
	{
		name: "python",
		extensions: [".py", ".pyw"],
		wasmFile: "tree-sitter-python.wasm",
		package: "tree-sitter-python",
		nameField: "name",
		queries: {
			function: "(function_definition name: (identifier) @name) @node",
			class: "(class_definition name: (identifier) @name) @node",
			variable: "(assignment left: (identifier) @name) @node",
			decorated_function:
				"(decorated_definition (function_definition name: (identifier) @name) @node)",
			decorated_class:
				"(decorated_definition (class_definition name: (identifier) @name) @node)",
		},
	},
	{
		name: "php",
		extensions: [".php"],
		wasmFile: "tree-sitter-php.wasm",
		package: "tree-sitter-php",
		nameField: "name",
		queries: {
			function: "(function_definition name: (name) @name) @node",
			class: "(class_declaration name: (name) @name) @node",
			interface: "(interface_declaration name: (name) @name) @node",
			trait: "(trait_declaration name: (name) @name) @node",
			method: "(method_declaration name: (name) @name) @node",
			constant: "(const_element (name) @name) @node",
			property: "(property_element (variable_name) @name) @node",
			enum: "(enum_declaration name: (name) @name) @node",
		},
	},
];

// --------------- Extension → language map ---------------

const extensionMap = new Map<string, LanguageDef>();
for (const lang of LANGUAGES) {
	for (const ext of lang.extensions) {
		extensionMap.set(ext, lang);
	}
}

/** Set of currently enabled language names. null = all enabled. */
let enabledLanguages: Set<string> | null = null;

/**
 * Restrict which languages are considered active.
 * Affects `getSupportedExtensions()` (used by fullIndex file walking)
 * and `detectLanguage()` for indexing purposes.
 * `detectLanguage()` still returns the LanguageDef for disabled languages
 * when called directly (e.g., for re-indexing existing files).
 */
export function setEnabledLanguages(names: string[]): void {
	if (names.length === ALL_LANGUAGE_NAMES_REF.length) {
		// Check if it's all languages (common case = no filter)
		const allPresent = ALL_LANGUAGE_NAMES_REF.every(n => names.includes(n));
		if (allPresent) {
			enabledLanguages = null;
			return;
		}
	}
	enabledLanguages = new Set(names);
}

const ALL_LANGUAGE_NAMES_REF = LANGUAGES.map(l => l.name);

/**
 * Detect language from a file path. Returns undefined if not supported.
 */
export function detectLanguage(filePath: string): LanguageDef | undefined {
	const ext = path.extname(filePath).toLowerCase();
	return extensionMap.get(ext);
}

/** Get all supported file extensions (filtered by enabled languages). */
export function getSupportedExtensions(): string[] {
	if (!enabledLanguages) return [...extensionMap.keys()];
	const result: string[] = [];
	for (const [ext, lang] of extensionMap) {
		if (enabledLanguages.has(lang.name)) result.push(ext);
	}
	return result;
}

/** All language definitions */
export function getAllLanguages(): LanguageDef[] {
	return LANGUAGES;
}

// --------------- Grammar loading ---------------

let parserInstance: WasmParser | undefined;
let QueryClass: typeof Query | undefined;
const languageCache = new Map<string, { lang: Language; queries: Map<string, InstanceType<typeof Query>> }>();

/**
 * Initialize web-tree-sitter. Must be called once before any parsing.
 * Resolves WASM files relative to this extension's node_modules.
 */
export async function initParser(
	extDir: string,
	enabledLangs?: string[],
): Promise<WasmParser> {
	const { Parser, Language, Query: Q } = await import("web-tree-sitter");
	await Parser.init();

	const parser = new Parser();
	parserInstance = parser;
	QueryClass = Q;

	// Determine which languages to load
	const enabledSet = enabledLangs ? new Set(enabledLangs) : null;

	// Pre-load all enabled languages
	for (const langDef of LANGUAGES) {
		if (enabledSet && !enabledSet.has(langDef.name)) continue;
		const wasmPath = path.resolve(extDir, "node_modules", langDef.package, langDef.wasmFile);
		try {
			const lang = await Language.load(wasmPath);
			const queryMap = new Map<string, Query>();
			for (const [kind, pattern] of Object.entries(langDef.queries)) {
				try {
					queryMap.set(kind, new QueryClass!(lang, pattern));
				} catch (e: any) {
					console.warn(`[code-nav] Query failed for ${langDef.name}/${kind}: ${e.message}`);
				}
			}
			languageCache.set(langDef.name, { lang, queries: queryMap });
		} catch (e: any) {
			console.warn(`[code-nav] Failed to load grammar ${langDef.name}: ${e.message}`);
		}
	}

	return parser;
}

/** Get the shared parser instance */
export function getParser(): WasmParser {
	if (!parserInstance) throw new Error("[code-nav] Parser not initialized");
	return parserInstance;
}

/** Get a loaded language + its compiled queries */
export function getLoadedLanguage(
	langDef: LanguageDef,
): { lang: Language; queries: Map<string, Query> } | undefined {
	return languageCache.get(langDef.name);
}
