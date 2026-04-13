# code-nav

Symbol-level source code navigation for [Pi](https://github.com/MarioZechner/pi-coding-agent). Provides go-to-definition, find-references, and symbol listing powered by [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) with a persistent SQLite index.

## Languages

| Language | Extensions |
|---|---|
| TypeScript | `.ts`, `.tsx` |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` |
| Python | `.py`, `.pyw` |
| PHP | `.php` |

## Installation

Add to your project's `.pi/config.json`:

```json
{
  "extensions": ["/path/to/this/extensions/code-nav"]
}
```

Or globally via `~/.pi/config.json` to make it available in every project.

Then install dependencies:

```bash
cd /path/to/this/extensions/code-nav
npm install
```

## Tools

Three tools are registered with Pi. You can invoke them by asking in natural language or the LLM will use them automatically.

### `code_nav_definition` — Go to Definition

Find where a symbol (function, class, variable, type, method) is defined.

```
"Where is UserService defined?"
"Find the definition of findOrder"
```

**Parameters:**
- `symbol` (required) — Symbol name to look up
- `file` (optional) — Current file path, for context-aware resolution

Returns file path, line number, kind, scope, visibility, and signature.

### `code_nav_references` — Find References

Find all usages of a symbol across the codebase.

```
"Find all references to authenticate"
"Where is Session used?"
```

**Parameters:**
- `symbol` (required) — Symbol name
- `definitionFile` (optional) — File where the symbol is defined, improves accuracy

Returns file paths, line numbers, and source lines grouped by file. Definitions are marked.

### `code_nav_symbols` — List / Search Symbols

List symbols in a file (outline view) or search workspace symbols by name prefix.

```
"Show me the outline of src/auth.ts"
"Search for symbols starting with session"
```

**Parameters:**
- `file` (optional) — File path to list symbols for
- `query` (optional) — Search query (name prefix); use without `file`

Calling with neither returns index stats (symbol count, file count).

## Command

### `/reindex`

Force a full re-index of the project. Useful after large refactors or if the index seems stale.

```
/reindex
```

## How It Works

1. **On session start**, the extension walks your project and parses all supported files using Tree-sitter WASM grammars
2. Symbols are extracted via language-specific queries and stored in a SQLite database at `.pi/code-nav/index.db`
3. Unchanged files (content hash match) are skipped on subsequent runs — repeat session starts are near-instant
4. The index is queried by the tools when invoked by the LLM

### Skipped Directories

The indexer skips: `node_modules`, `vendor`, `dist`, `build`, `.git`, `__pycache__`, and any hidden directory (starting with `.`).

### Large Files

Files over 100 KB are skipped.

## Dependencies

- **web-tree-sitter** — WASM-based Tree-sitter bindings (zero native dependencies)
- **tree-sitter-\*** — Grammar packages for each supported language
- **better-sqlite3** — Persistent SQLite index

## License

MIT
