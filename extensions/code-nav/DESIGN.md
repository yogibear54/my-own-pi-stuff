# code-nav: Symbol-Level Source Code Navigation for Pi

> Pi extension providing go-to-definition, find-references, and symbol listing
> powered by Tree-sitter, with a persistent index and custom TUI.

---

## Decisions

| Decision | Choice |
|---|---|
| Scope (v1) | Definitions, symbol listing, references |
| Engine | Tree-sitter via **web-tree-sitter** (WASM) |
| Format | Pi extension (custom tools + commands) |
| Index | Persistent (stored in `.pi/code-nav/`) |
| UI | Custom TUI component for symbol browsing |

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Pi Extension                    │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  Tools    │  │ Commands │  │  TUI Component│  │
│  │ (LLM)    │  │ (Human)  │  │  (Interactive) │  │
│  └────┬─────┘  └────┬─────┘  └───────┬───────┘  │
│       │             │                │           │
│       └─────────────┼────────────────┘           │
│                     ▼                            │
│            ┌────────────────┐                    │
│            │  Query Engine  │                    │
│            └───────┬────────┘                    │
│                    ▼                             │
│       ┌────────────────────────┐                 │
│       │    Symbol Index        │                 │
│       │  (persistent, .pi/)    │                 │
│       └───────────┬────────────┘                 │
│                   ▼                              │
│          ┌──────────────┐                        │
│          │   Indexer    │◄─── file watcher       │
│          │  (WASM/      │                        │
│          │  web-ts)     │                        │
│          └──────────────┘                        │
└─────────────────────────────────────────────────┘
```

---

## 1. Indexer

Parses source files with Tree-sitter and extracts symbol information.

### Symbol Extraction

For each source file, extract:

```typescript
interface SymbolInfo {
  name: string;                // e.g., "authenticate"
  kind: SymbolKind;            // function, class, method, variable, etc.
  file: string;                // absolute path
  line: number;                // 1-indexed
  column: number;              // 0-indexed
  endLine: number;
  endColumn: number;
  signature?: string;          // function signature, class heritage, etc.
  scope?: string;              // enclosing namespace/class (e.g., "AuthService.login")
  visibility?: "public" | "private" | "protected";
  documentation?: string;      // first line of JSDoc/docstring
  children?: SymbolInfo[];     // nested symbols (methods in a class)
}
```

### Symbol Kinds (v1)

```typescript
enum SymbolKind {
  Function, Method, Constructor,
  Class, Interface, Type, Enum,
  Variable, Constant, Property, Field,
  Module, Namespace,
  Import,
}
```

### Language Support (v1)

| Language | Grammar Package | WASM File | Tested |
|----------|----------------|-----------|--------|
| TypeScript | `tree-sitter-typescript` | `tree-sitter-typescript.wasm` | ✅ |
| TSX | `tree-sitter-typescript` | `tree-sitter-tsx.wasm` | ✅ |
| JavaScript | `tree-sitter-javascript` | `tree-sitter-javascript.wasm` | ✅ |
| Python | `tree-sitter-python` | `tree-sitter-python.wasm` | ✅ |
| PHP | `tree-sitter-php` | `tree-sitter-php.wasm` | ✅ |

### Tree-sitter Queries

Each language needs a set of Tree-sitter **queries** (S-expressions) to extract symbols.

```typescript
// TypeScript / JavaScript queries
(function_declaration name: (identifier) @name) @symbol
(class_declaration name: (type_identifier) @name) @symbol
(method_definition name: (property_identifier) @name) @symbol
(variable_declarator name: (identifier) @name) @symbol
(interface_declaration name: (type_identifier) @name) @symbol
(type_alias_declaration name: (type_identifier) @name) @symbol
(import_statement) @symbol
```

```typescript
// PHP queries
(class_declaration name: (name) @name) @symbol
(method_declaration name: (name) @name) @symbol
(function_definition name: (name) @name) @symbol
(interface_declaration name: (name) @name) @symbol
(const_element (name) @name) @symbol               // class & top-level constants
(property_element (variable_name) @name) @symbol     // class properties
(namespace_definition (namespace_name) @ns) @symbol
(namespace_use_declaration (namespace_use_clause (_) @import)) @symbol
```

```typescript
// Python queries
(function_definition name: (identifier) @name) @symbol
(class_definition name: (identifier) @name) @symbol
(assignment left: (identifier) @name) @symbol
(import_statement name: (dotted_name) @import) @symbol
(import_from_statement module_name: (dotted_name) @module name: (dotted_name) @import) @symbol
```

These queries are stored per-language in `queries/<lang>.scm`.

---

## 2. Persistent Symbol Index

### Storage Format

SQLite database at `.pi/code-nav/index.db`. Reasons:
- Fast queries (definitions by name, symbols in file, etc.)
- Handles large codebases (100k+ files)
- Atomic updates for incremental re-indexing
- Single file, easy to clean up

### Schema

```sql
-- Index metadata
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Stores: version, root_path, last_full_index_time

-- Tracked files (for incremental updates)
CREATE TABLE files (
  path TEXT PRIMARY KEY,       -- relative to project root
  language TEXT NOT NULL,
  hash TEXT NOT NULL,          -- content hash for change detection
  last_indexed_at INTEGER NOT NULL
);

-- Symbols
CREATE TABLE symbols (
  id INTEGER PRIMARY KEY,
  file TEXT NOT NULL REFERENCES files(path),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,          -- SymbolKind enum value
  line INTEGER NOT NULL,
  column INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  end_column INTEGER NOT NULL,
  signature TEXT,
  scope TEXT,                  -- e.g., "AuthService.login"
  visibility TEXT,
  documentation TEXT,
  parent_id INTEGER REFERENCES symbols(id)
);

-- For fast lookups
CREATE INDEX idx_symbols_name ON symbols(name);
CREATE INDEX idx_symbols_file ON symbols(file);
CREATE INDEX idx_symbols_scope ON symbols(scope);
CREATE INDEX idx_symbols_kind ON symbols(kind);

-- Import table (for cross-file resolution)
CREATE TABLE imports (
  id INTEGER PRIMARY KEY,
  file TEXT NOT NULL REFERENCES files(path),
  imported_name TEXT NOT NULL,  -- what's being imported
  source_path TEXT,             -- resolved absolute path (or NULL if unresolvable)
  is_default INTEGER,           -- default import?
  line INTEGER NOT NULL
);

CREATE INDEX idx_imports_file ON imports(file);
CREATE INDEX idx_imports_name ON imports(imported_name);
```

### Index Lifecycle

1. **First startup:** Walk project, parse all files, build full index
2. **Subsequent startups:** Check file hashes, re-index changed files only
3. **During session:** Watch for file changes (via `fs.watch` or polling), re-index incrementally
4. **On demand:** Re-index a specific file when a query returns stale results

### Incremental Re-indexing

```
1. Hash all tracked files (fast, just MD5 of content)
2. Compare hashes to stored hashes
3. For changed files:
   a. DELETE symbols WHERE file = ?
   b. DELETE imports WHERE file = ?
   c. Re-parse with Tree-sitter
   d. INSERT new symbols/imports
   e. UPDATE files SET hash = ?
4. For deleted files:
   a. DELETE symbols, imports, files entries
5. For new files:
   a. Detect language from extension
   b. Parse and insert
```

---

## 3. Query Engine

### Operations

#### `findDefinition(name, context?)` → `DefinitionResult[]`

1. Look up symbols where `name` matches (exact or fuzzy)
2. Use import tables to resolve cross-file definitions
3. If `context` (current file) is provided, prefer local definitions

Resolution strategy:
```
Given: name = "authenticate", current file = "src/routes/login.ts"

1. Search symbols WHERE name = "authenticate"
2. Check current file imports for "authenticate"
   - If imported from "src/auth.ts", boost that result
3. Return ranked results:
   - Same-file definitions first
   - Imported definitions second
   - Other definitions last
```

#### `findReferences(name, definitionFile, definitionLine)` → `ReferenceResult[]`

Tree-sitter doesn't do true reference resolution, so we use a pragmatic approach:

1. Get the definition's canonical name and scope
2. Search all files for the identifier `name`
3. Filter using import analysis:
   - A file can only reference `name` if it imports it (or is in the same package/module)
4. Rank by likelihood (exact scope match > imported > possible)

This gives ~80-90% accuracy for most codebases. False positives are manageable — the LLM can read the specific lines to verify.

```typescript
interface ReferenceResult {
  file: string;
  line: number;
  column: number;
  lineText: string;        // the full source line for context
  isDefinition: boolean;   // true for the definition site itself
  confidence: "high" | "medium" | "low";
}
```

#### `listSymbols(file?)` → `SymbolInfo[]`

- If `file` given: return all symbols in that file (outline view)
- If no file: return all workspace symbols (for search)

#### `searchSymbols(query)` → `SymbolInfo[]`

- Fuzzy match against symbol names
- Rank by: exact match > prefix > fuzzy > kind priority (class > function > variable)

---

## 4. Pi Extension Interface

### Custom Tools (LLM-facing)

```typescript
// Tool 1: Find definition
pi.registerTool({
  name: "code_nav_definition",
  label: "Go to Definition",
  description: "Find where a symbol (function, class, variable, type) is defined. " +
    "Returns file path, line number, signature, and documentation. " +
    "Use when you need to understand what a symbol IS.",
  promptSnippet: "Find symbol definitions (go-to-definition)",
  promptGuidelines: [
    "Use code_nav_definition instead of grep when you need to find where something is defined.",
    "Provide the symbol name and optionally the current file for context-aware resolution."
  ],
  parameters: Type.Object({
    symbol: Type.String({ description: "Symbol name to find the definition of" }),
    file: Type.Optional(Type.String({ description: "Current file context for import resolution" })),
  }),
  // ...
});

// Tool 2: Find references
pi.registerTool({
  name: "code_nav_references",
  label: "Find References",
  description: "Find all usages of a symbol across the codebase. " +
    "Returns file paths, line numbers, and surrounding context. " +
    "Use when you need to understand the IMPACT of changing something.",
  promptSnippet: "Find all references to a symbol across the codebase",
  promptGuidelines: [
    "Use code_nav_references before refactoring to understand the full impact of changes."
  ],
  parameters: Type.Object({
    symbol: Type.String({ description: "Symbol name to find references for" }),
    definitionFile: Type.Optional(Type.String({ description: "File where the symbol is defined (improves accuracy)" })),
  }),
  // ...
});

// Tool 3: List symbols
pi.registerTool({
  name: "code_nav_symbols",
  label: "List Symbols",
  description: "List symbols in a file (outline view) or search across the workspace. " +
    "Use to quickly understand a file's structure without reading the whole file.",
  promptSnippet: "List symbols in a file or search workspace symbols",
  promptGuidelines: [
    "Use code_nav_symbols to get a quick overview of a file's structure before reading it."
  ],
  parameters: Type.Object({
    file: Type.Optional(Type.String({ description: "File to list symbols for. Omit to search all files." })),
    query: Type.Optional(Type.String({ description: "Fuzzy search query for workspace symbols" })),
  }),
  // ...
});
```

### Commands (Human-facing)

```
/go-def <symbol>       Jump to definition (shows in TUI)
/refs <symbol>         Show all references
/symbols [file]        Show file outline or workspace symbols
/reindex               Force full re-index
/code-nav              Open the interactive TUI symbol browser
```

### TUI Component

An interactive symbol browser using `ctx.ui.custom()`:

```
┌─── Code Navigation ──────────────────────────────────────┐
│ Search: [authenticate          ]                          │
│                                                           │
│ ── Definitions ─────────────────────────────────────────  │
│   fn authenticate(user: User, pass: string): Token        │
│     src/auth.ts:45                  [public]              │
│                                                           │
│   fn authenticate(token: Token): User                     │
│     src/middleware.ts:12            [public]              │
│                                                           │
│ ── References (12) ─────────────────────────────────────  │
│   src/routes/login.ts:23    result = await authenticate(  │
│   src/routes/signup.ts:89   const token = authenticate(   │
│   src/middleware.ts:45       req.user = authenticate(     │
│   ...                                                     │
│                                                           │
│ ↑↓ navigate  Enter=open  Tab=refs  Esc=close             │
└───────────────────────────────────────────────────────────┘
```

Features:
- Fuzzy search input at top
- Split view: definitions on top, references on bottom
- Arrow keys to navigate, Enter to open file (via `read` tool or editor)
- Tab to toggle between definitions and references
- Syntax highlighting via Tree-sitter (stretch goal)

---

## 5. File Structure

```
code-nav/
├── index.ts                 # Extension entry point
├── package.json             # Dependencies (tree-sitter, better-sqlite3)
├── src/
│   ├── indexer.ts           # web-tree-sitter parsing & symbol extraction
│   ├── store.ts             # SQLite persistence layer
│   ├── resolver.ts          # Cross-file reference resolution
│   ├── engine.ts            # Query engine (combines store + resolver)
│   ├── watcher.ts           # File change detection & incremental re-index
│   ├── languages/
│   │   ├── registry.ts      # Language detection & WASM grammar loading
│   │   ├── typescript.ts    # TS/JS/TSX query definitions
│   │   ├── python.ts
│   │   └── php.ts
│   ├── tools.ts             # Pi tool definitions
│   ├── commands.ts          # Pi command definitions
│   └── tui.ts               # Custom TUI component
├── queries/                 # Tree-sitter query files per language
│   ├── typescript.scm
│   ├── python.scm
│   └── php.scm
└── DESIGN.md                # This file
```

---

## 6. Dependencies

```json
{
  "dependencies": {
    "web-tree-sitter": "^0.26.8",
    "tree-sitter-javascript": "^0.25.0",
    "tree-sitter-typescript": "^0.23.2",
    "tree-sitter-python": "^0.25.0",
    "tree-sitter-php": "^0.24.2",
    "better-sqlite3": "^11.x"
  }
}
```

---

## 7. Implementation Plan

### Phase 1: Core Indexer + Definitions (MVP)
1. Set up extension scaffolding with `package.json` and dependencies
2. Implement `languages/registry.ts` — detect language from file extension
3. Implement `indexer.ts` — parse files with web-tree-sitter, extract symbols
4. Implement `store.ts` — SQLite schema, insert/query operations
5. Implement `engine.ts` — `findDefinition()` and `listSymbols()`
6. Implement `tools.ts` — `code_nav_definition` and `code_nav_symbols` tools
7. Include queries for **TypeScript/JS, Python, and PHP**
8. **Verify:** LLM can find definitions in real projects for each language

### Phase 2: References
1. Implement `resolver.ts` — import table population, cross-file resolution
2. Implement `engine.ts` — `findReferences()` with import-aware filtering
3. Implement `tools.ts` — `code_nav_references` tool
4. **Verify:** Reference queries return accurate results across files

### Phase 3: Persistence + Incremental Updates
1. Implement file hashing and change detection
2. Implement incremental re-indexing (changed files only)
3. Implement file watcher for live updates
4. Add `session_start` handler to check index freshness
5. **Verify:** Re-opening a project is fast (no full re-index)

### Phase 4: TUI Component
1. Implement interactive symbol browser with `ctx.ui.custom()`
2. Add fuzzy search
3. Add keyboard navigation (arrows, enter, tab, esc)
4. Register `/code-nav` command to open it
5. **Verify:** Full interactive browsing experience

### Phase 5: Polish
1. Add `/go-def`, `/refs`, `/symbols` commands
2. Add error handling for missing grammars, corrupt index, etc.
3. Add `promptGuidelines` to steer the LLM toward using the tools
4. Performance testing on large codebases
5. Documentation

---

## 8. Resolved Design Decisions

### Tree-sitter Binding: web-tree-sitter (WASM)

**Decision:** Use `web-tree-sitter` (WASM), not the native `tree-sitter` addon.

| Factor | Native (`tree-sitter`) | WASM (`web-tree-sitter`) |
|---|---|---|
| Install | Requires C compiler + node-gyp | Always works (pure WASM) |
| Grammar loading | `require()` prebuilt `.node` per platform | `Language.load('.wasm')` — universal |
| Speed | ~15% faster (79ms vs 88ms for 518KB) | Slightly slower |
| ABI compatibility | Must match grammar ABI exactly | Handles ABI 14 + 15 gracefully |
| Distribution | Platform-specific native addons | Zero native deps |

Rationale:
- ~15% performance difference is negligible for on-demand parsing (1-5ms for typical files)
- Eliminates install failures on any platform (no C compiler needed)
- All grammar packages already ship `.wasm` files alongside native prebuilds
- `Parser.init()` is a one-time async cost at extension startup
- Simpler distribution and fewer support issues

Grammar packages and tested versions:

| Grammar | Version | WASM ABI |
|---|---|---|
| tree-sitter-javascript | 0.25.0 | 15 |
| tree-sitter-typescript | 0.23.2 | 14 |
| tree-sitter-python | 0.25.0 | 15 |
| tree-sitter-php | 0.24.2 | 15 |

API differences from native:
- `Parser.init()` must be called once before use (async, loads WASM runtime)
- Language loading: `Language.load('path.wasm')` instead of `require()`
- Query creation: `new Query(lang, pattern)` instead of `lang.query(pattern)`
- Grammar packages export WASM files at `tree-sitter-<lang>.wasm` in their root

## 9. Remaining Open Questions

1. **Import resolution depth:** For references, how deep do we resolve imports?
   - Re-export chains (`export { foo } from './bar'`) 
   - Barrel files (`index.ts` re-exporting everything)
   - Package.json "main"/"exports" resolution
   - Recommendation: handle direct imports + one level of re-exports for v1

2. **Index storage location:** `.pi/code-nav/index.db` at project root
   - Add `.pi/code-nav/` to `.gitignore` automatically?
   - Or use a global cache keyed by project path?
   - Recommendation: project-local (`.pi/code-nav/`), auto-gitignored

3. **Large file/project limits:** Skip files over N lines? Skip `node_modules`, `vendor/`, etc.?
   - Use `.gitignore` awareness to skip ignored files
   - Skip binary files
   - Configurable max file size (default: 100KB)
