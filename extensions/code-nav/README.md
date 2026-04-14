# code-nav

A [Pi](https://github.com/badlogic/pi-coding-agent) extension providing symbol-level source code navigation powered by [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) with a persistent SQLite index.

Gives the LLM (and you) **go-to-definition**, **find-references**, **symbol listing**, **source context fetching**, and **full-text search** — all without leaving the terminal.

---

## Features

- **Go to Definition** — find where a function, class, variable, or type is declared, with import-aware resolution across files.
- **Find References** — locate every usage of a symbol across the entire codebase, grouped by file with confidence indicators.
- **List Symbols** — outline view of a file's structure, or workspace-wide symbol search by name prefix.
- **Fetch Context** — retrieve source code around a symbol definition with configurable padding; container types (classes, interfaces, enums) show a member summary instead of dumping the full body.
- **Search Codebase** — full-text search across all indexed files using SQLite FTS5, with enclosing-symbol metadata and relevance ranking.
- **Persistent Index** — symbols are stored in a local SQLite database (`.pi/code-nav/index.db`); incremental re-indexing only processes changed files.
- **`/reindex` Command** — force a full re-index from the Pi command line at any time.

---

## Supported Languages

| Language   | Extensions         |
|------------|--------------------|
| TypeScript | `.ts`              |
| TSX        | `.tsx`             |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` |
| Python     | `.py`, `.pyw`      |
| PHP        | `.php`             |

---

## Installation

1. Install dependencies inside the extension directory:

   ```bash
   cd path/to/code-nav
   npm install
   ```

2. Add the extension to your Pi configuration (e.g. `.pi/settings.json`):

   ```json
   {
     "extensions": ["./path/to/code-nav"]
   }
   ```

3. Start (or restart) Pi.

## Enabling Per Project

Code-nav is **disabled by default** — it only creates an index in projects where it is explicitly enabled. This prevents unwanted `index.db` files in every directory where you run Pi.

To enable, add to your project's `.pi/settings.json`:

```json
{
  "codeNav": {
    "enabled": true
  }
}
```

To enable for **all** projects, add the same to your global settings at `~/.pi/agent/settings.json`. Project-level settings override global settings.

When disabled, the code-nav tools are deactivated and won't appear in the tool list. A notification is shown on session start with setup instructions.

---

## Tools Provided

The extension registers five tools available to the LLM:

### `code_nav_definition`

Find where a symbol is defined.

| Parameter | Type     | Required | Description                                |
|-----------|----------|----------|--------------------------------------------|
| `symbol`  | `string` | Yes      | Symbol name to look up                     |
| `file`    | `string` | No       | Current file path for import-aware ranking |

### `code_nav_references`

Find all usages of a symbol across the codebase.

| Parameter        | Type     | Required | Description                       |
|------------------|----------|----------|-----------------------------------|
| `symbol`         | `string` | Yes      | Symbol name to find references for |
| `definitionFile` | `string` | No       | File where the symbol is defined (improves accuracy) |

### `code_nav_symbols`

List symbols in a file (outline) or search the workspace by name prefix.

| Parameter | Type     | Required | Description                     |
|-----------|----------|----------|---------------------------------|
| `file`    | `string` | No       | File to list symbols for        |
| `query`   | `string` | No       | Name-prefix search (workspace-wide) |

Provide `file` **or** `query` (not both). Omitting both returns index stats.

### `code_nav_fetch_context`

Fetch source code around a symbol definition with configurable padding.

| Parameter  | Type     | Required | Description                                  |
|------------|----------|----------|----------------------------------------------|
| `symbol`   | `string` | Yes      | Symbol name to fetch context for             |
| `file`     | `string` | No       | Current file path (helps resolve ambiguity)  |
| `before`   | `number` | No       | Lines before the symbol (default 5, max 100) |
| `after`    | `number` | No       | Lines after the symbol (default 5, max 100)  |
| `maxLines` | `number` | No       | Total line cap (default 100, max 200)        |

### `code_nav_search`

Search file contents for arbitrary text across the codebase.

| Parameter | Type     | Required | Description                                  |
|-----------|----------|----------|----------------------------------------------|
| `query`   | `string` | Yes      | Search terms (implicit AND, supports quoted phrases) |
| `limit`   | `number` | No       | Max results (default 30, range 10–100)       |

---

## How It Works

```
Extension startup
  │
  ├─ Load Tree-sitter WASM grammars for all supported languages
  ├─ Open/create SQLite index at .pi/code-nav/index.db
  └─ Walk project tree → parse files → extract & store symbols
        (skips node_modules, vendor, dist, build, .git, __pycache__)

Subsequent sessions
  └─ Hash-compare tracked files → only re-index what changed
```

Symbol extraction uses [Tree-sitter queries](https://tree-sitter.github.io/tree-sitter/using-parsers/queries) — language-specific S-expression patterns that match declarations, class definitions, methods, etc. — to populate the SQLite index with names, kinds, locations, scopes, signatures, and visibility.

Full-text search is powered by SQLite FTS5 with camelCase/PascalCase splitting, so sub-words in identifiers like `findDefinitions` become independently searchable (`find`, `Definitions`).

---

## Architecture

```
index.ts          Extension entry point — registers tools, commands, lifecycle hooks
src/
  tools.ts        Pi tool definitions (the 5 tools above)
  engine.ts       Query engine — combines store + indexer for high-level queries
  indexer.ts      Tree-sitter parsing & symbol extraction
  store.ts        SQLite persistence layer (schema, CRUD, FTS5)
  languages/
    registry.ts   Language detection, WASM grammar loading, query definitions
```

---

## Commands

| Command    | Description                                        |
|------------|----------------------------------------------------|
| `/reindex` | Force a full re-index of the project               |

---

## Index Storage

The SQLite database lives at `.pi/code-nav/index.db` inside your project. It is self-contained and can be safely deleted — the extension will rebuild it on the next session start.

---

## Dependencies

| Package                   | Purpose                          |
|---------------------------|----------------------------------|
| `web-tree-sitter`         | WASM-based Tree-sitter parser    |
| `tree-sitter-javascript`  | JavaScript grammar               |
| `tree-sitter-typescript`  | TypeScript & TSX grammars        |
| `tree-sitter-python`      | Python grammar                   |
| `tree-sitter-php`         | PHP grammar                      |
| `better-sqlite3`          | SQLite database driver           |
