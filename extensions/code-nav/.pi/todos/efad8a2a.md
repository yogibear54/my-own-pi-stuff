{
  "id": "efad8a2a",
  "title": "Phase 5: Externalize indexer.* behavior settings",
  "tags": [
    "settings-refactor",
    "phase-5"
  ],
  "status": "done",
  "created_at": "2026-04-15T16:50:09.949Z"
}

Phase 5 complete. Changes:

**`src/config.ts`**
- Added `IndexerConfig` interface with `minNameLength` and `maxSignatureLength`
- Added `DEFAULT_INDEXER` defaults and `resolveIndexerConfig()` resolver
- `CodeNavToolsConfig` now includes `indexer` section

**`src/indexer.ts`**
- Added exported `IndexerConfig` interface
- `indexFile()` accepts optional `indexerConfig?: IndexerConfig`
- `extractSymbols()` accepts optional config, uses `minNameLength` instead of hardcoded `2`
- `extractSignature()` accepts `maxSignatureLength` param instead of hardcoded `120`, uses dynamic truncation (`length - 3 + "..."`)

**`src/engine.ts`**
- `FullIndexOptions` now includes optional `indexer?: IndexerConfig`
- `fullIndex()` passes `options.indexer` to `indexFile()`
- `reindexFile()` pick type updated to include `"indexer"`, passes to `indexFile()`
- `refreshStaleContent()` left unchanged — uses defaults (matches original behavior)

**`index.ts`**
- `DEFAULT_INDEX_OPTIONS` includes `indexer` default
- `getFullIndexOptions()` resolves `indexer` from `resolveToolsConfig(settings).indexer`
- `/code-nav-config` shows indexer settings

**SETTINGS.md**
- Marked `indexer` as ✅ Implemented
