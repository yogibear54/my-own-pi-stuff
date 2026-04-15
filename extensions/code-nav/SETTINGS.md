# Code-Nav Settings Reference

All settings live under the `"codeNav"` key in your `.pi/settings.json` (project-level) or `~/.pi/agent/settings.json` (global). Project-level settings override global settings. Nested objects are merged.

## Implementation Status

| Section | Status |
|---|---|
| [`enabled`](#enabled) | ✅ Implemented |
| [`indexing`](#indexing) | ✅ Implemented |
| [`tools`](#tools) | ✅ Implemented |
| [`search`](#search) | ✅ Implemented |
| [`fetchContext`](#fetchcontext) | ✅ Implemented |
| [`database`](#database) | ✅ Implemented |
| [`languages`](#languages) | ✅ Implemented |
| [`indexer`](#indexer) | ✅ Implemented |

## Minimal Configuration

```json
{
  "codeNav": {
    "enabled": true
  }
}
```

## Full Configuration (All Defaults Shown)

```json
{
  "codeNav": {
    "enabled": true,

    "indexing": {
      "includeHiddenPaths": true,
      "maxFileSizeBytes": 1000000,
      "excludedDirectories": [
        "node_modules", "vendor", "dist", "build",
        ".git", ".pi", "__pycache__"
      ]
    },

    "tools": {
      "definitionMaxResults": 20,
      "referenceMaxFiles": 15,
      "referenceMaxPerFile": 10,
      "symbolSearchLimit": 50,
      "searchDefaultLimit": 30
    },

    "search": {
      "defaultScanMultiplier": 50,
      "defaultMaxCandidateFiles": 10000,
      "defaultMaxLinesScanned": null
    },

    "fetchContext": {
      "defaultBefore": 5,
      "defaultAfter": 5,
      "defaultMaxLines": 100,
      "maxLinesCap": 200,
      "containerDeclMaxLines": 10,
      "signatureDisplayLength": 80
    },

    "database": {
      "journalMode": "WAL",
      "synchronous": "NORMAL",
      "cacheSizeMB": 32
    },

    "languages": {
      "enabled": ["typescript", "tsx", "javascript", "python", "php"]
    },

    "indexer": {
      "minNameLength": 2,
      "maxSignatureLength": 120
    }
  }
}
```

---

## `enabled` ✅

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `false` |
| **Scope** | Global or project |

Whether code-nav is active. When `false`, all code-nav tools are removed from the tool list and no indexing occurs. Must be explicitly set to `true` per project (or globally).

---

## `indexing` ✅

Controls which files are walked and parsed during indexing.

### `indexing.includeHiddenPaths`

| | |
|---|---|
| **Type** | `boolean` |
| **Default** | `true` |

Include dot-prefixed files and directories (e.g., `.eslintrc.js`, `.config/`) during indexing. Set to `false` to skip all hidden entries.

### `indexing.maxFileSizeBytes`

| | |
|---|---|
| **Type** | `number` |
| **Default** | `1000000` (1 MB) |
| **Minimum** | `10000` |

Maximum file size (in bytes) to parse for symbols. Files exceeding this limit are skipped. Useful for excluding generated or minified files that happen to have a supported extension.

### `indexing.excludedDirectories`

| | |
|---|---|
| **Type** | `string[]` |
| **Default** | `["node_modules", "vendor", "dist", "build", ".git", ".pi", "__pycache__"]` |

Directory names to skip while walking the project tree. Matched by name (not path), so `"dist"` excludes *any* directory named `dist` at any depth. Empty strings are ignored.

---

## `tools` ✅

Controls output limits for the tools the LLM sees. These cap how many results are returned in the text output to save tokens.

### `tools.definitionMaxResults`

| | |
|---|---|
| **Type** | `number` |
| **Default** | `20` |

Maximum number of definitions returned by `code_nav_definition`. When a symbol name matches more than this many definitions, the rest are summarized as "... and N more."

### `tools.referenceMaxFiles`

| | |
|---|---|
| **Type** | `number` |
| **Default** | `15` |

Maximum number of distinct files shown in `code_nav_references` output. Additional files are summarized as "... and N more file(s)."

### `tools.referenceMaxPerFile`

| | |
|---|---|
| **Type** | `number` |
| **Default** | `10` |

Maximum reference lines shown per file in `code_nav_references` output. Additional references in the same file are summarized as "... and N more."

### `tools.symbolSearchLimit`

| | |
|---|---|
| **Type** | `number` |
| **Default** | `50` |

Maximum number of symbols returned by `code_nav_symbols` when using the `query` (workspace search) mode.

### `tools.searchDefaultLimit`

| | |
|---|---|
| **Type** | `number` |
| **Default** | `30` |

Default result limit for `code_nav_search` when the caller does not specify an explicit `limit` parameter. The per-query `limit` parameter (range 10–100) always overrides this.

---

## `search` ✅

Default values for search tuning knobs. These serve as the baseline when a `code_nav_search` call does not specify per-query overrides. Per-query parameters always take precedence.

### `search.defaultScanMultiplier`

| | |
|---|---|
| **Type** | `number` |
| **Default** | `50` |
| **Range** | `1`–`200` |

Multiplier applied to the result limit when fetching candidate files from the FTS index before line-level filtering. Higher values retrieve more candidate files, reducing the chance of missing matches at the cost of more I/O.

**Example:** With `limit=30` and `scanMultiplier=50`, up to `30 × 50 = 1500` candidate files are fetched from FTS before line-level filtering narrows them down.

### `search.defaultMaxCandidateFiles`

| | |
|---|---|
| **Type** | `number` |
| **Default** | `10000` |
| **Range** | `100`–`100000` |

Hard cap on the number of candidate files fetched from FTS, regardless of `scanMultiplier`. Prevents excessive I/O on very large codebases with broad queries.

### `search.defaultMaxLinesScanned`

| | |
|---|---|
| **Type** | `number` or `null` |
| **Default** | `null` (unlimited) |
| **Range** | `1000`–`10000000` |

Total line-scan budget across all candidate files. When the budget is exhausted, remaining candidate files are skipped. Set to a finite value to cap search time on large repos. `null` means no limit.

---

## `fetchContext` ✅

Controls the behavior of `code_nav_fetch_context`, which retrieves source code around a symbol definition.

### `fetchContext.defaultBefore`

| | |
|---|---|
| **Type** | `number` |
| **Default** | `5` |
| **Range** | `0`–`100` |

Default number of lines included before the symbol definition when the caller does not specify `before`.

### `fetchContext.defaultAfter`

| | |
|---|---|
| **Type** | `number` |
| **Default** | `5` |
| **Range** | `0`–`100` |

Default number of lines included after the symbol's end line when the caller does not specify `after`.

### `fetchContext.defaultMaxLines`

| | |
|---|---|
| **Type** | `number` |
| **Default** | `100` |
| **Range** | `10`–`200` |

Default total line cap for context output. The function body is always shown in full; this limit only affects padding lines. Overridden by the per-call `maxLines` parameter.

### `fetchContext.maxLinesCap`

| | |
|---|---|
| **Type** | `number` |
| **Default** | `200` |
| **Range** | `10`–`200` |

Absolute upper bound on `maxLines`, regardless of what the caller requests. This is a safety cap to prevent accidentally returning very large outputs.

### `fetchContext.containerDeclMaxLines`

| | |
|---|---|
| **Type** | `number` |
| **Default** | `10` |

For container types (classes, interfaces, enums, traits), the maximum number of declaration lines shown before the member summary begins. If the class declaration spans more lines than this, it is truncated to this many lines.

### `fetchContext.signatureDisplayLength`

| | |
|---|---|
| **Type** | `number` |
| **Default** | `80` |

Maximum character length for signature text displayed in the member summary of container types. Signatures longer than this are omitted from the summary view (but are still stored in the index).

---

## `database` ✅

SQLite pragma settings for the index database at `.pi/code-nav/index.db`.

> ⚠️ **Changing these settings can affect index durability and performance.** The defaults are tuned for developer workstations. Only change these if you understand the tradeoffs.

### `database.journalMode`

| | |
|---|---|
| **Type** | `string` |
| **Default** | `"WAL"` |
| **Values** | `"DELETE"`, `"TRUNCATE"`, `"PERSIST"`, `"MEMORY"`, `"WAL"`, `"OFF"` |

SQLite [journal mode](https://www.sqlite.org/pragma.html#pragma_journal_mode). `WAL` (Write-Ahead Logging) is recommended for concurrent read/write performance. Use `MEMORY` or `OFF` for ephemeral use; use `DELETE` for maximum compatibility (e.g., network filesystems where WAL lock files cause issues).

### `database.synchronous`

| | |
|---|---|
| **Type** | `string` |
| **Default** | `"NORMAL"` |
| **Values** | `"OFF"`, `"NORMAL"`, `"FULL"`, `"EXTRA"` |

SQLite [synchronous mode](https://www.sqlite.org/pragma.html#pragma_synchronous). `NORMAL` is safe with WAL mode and provides good performance. `FULL` is safest but slower. `OFF` risks index corruption on crashes (acceptable since the index can always be rebuilt with `/reindex`).

### `database.cacheSizeMB`

| | |
|---|---|
| **Type** | `number` |
| **Default** | `32` |

SQLite page cache size in megabytes. Larger values improve query performance on big indexes at the cost of memory. Set lower on memory-constrained systems.

---

## `languages` ✅

Controls which language grammars are loaded and which file extensions are indexed.

### `languages.enabled`

| | |
|---|---|
| **Type** | `string[]` |
| **Default** | `["typescript", "tsx", "javascript", "python", "php"]` |

List of language names to activate. Only languages in this list will have their WASM grammars loaded and their file extensions indexed. Disabling unused languages reduces startup time and memory usage.

**Available languages:**

| Name | Extensions | Grammar Package |
|---|---|---|
| `typescript` | `.ts` | `tree-sitter-typescript` |
| `tsx` | `.tsx` | `tree-sitter-typescript` |
| `javascript` | `.js`, `.jsx`, `.mjs`, `.cjs` | `tree-sitter-javascript` |
| `python` | `.py`, `.pyw` | `tree-sitter-python` |
| `php` | `.php` | `tree-sitter-php` |

**Example — TypeScript-only project:**

```json
{
  "codeNav": {
    "enabled": true,
    "languages": {
      "enabled": ["typescript", "tsx"]
    }
  }
}
```

---

## `indexer` ✅

Internal knobs for the symbol extraction pipeline. These rarely need changing but are exposed for edge cases.

### `indexer.minNameLength`

| | |
|---|---|
| **Type** | `number` |
| **Default** | `2` |

Minimum identifier length to be included in the symbol index. Identifiers shorter than this (e.g., single-character loop variables like `i`, `x`) are skipped during indexing. Set to `1` to index all identifiers.

### `indexer.maxSignatureLength`

| | |
|---|---|
| **Type** | `number` |
| **Default** | `120` |

Maximum character length for extracted signature text. Signatures longer than this are truncated with `...` during indexing. Longer values preserve more detail at the cost of larger index size.

---

## Settings Precedence

Settings are resolved with the following precedence (highest to lowest):

1. **Per-query parameters** — e.g., the `limit` parameter on `code_nav_search`
2. **Project `.pi/settings.json`** — `"codeNav": { ... }` in the project root
3. **Global `~/.pi/agent/settings.json`** — `"codeNav": { ... }`
4. **Built-in defaults** — the values listed in this document

Nested objects (`indexing`, `tools`, `search`, etc.) are **shallow-merged** between global and project settings. For example:

```jsonc
// Global: ~/.pi/agent/settings.json
{ "codeNav": { "tools": { "definitionMaxResults": 30 } } }

// Project: .pi/settings.json
{ "codeNav": { "tools": { "referenceMaxFiles": 20 } } }

// Effective: both values apply (30 definitions, 20 reference files)
```

## Viewing Effective Settings

Use the `/code-nav-config` command in Pi to display the merged configuration and current index status.
