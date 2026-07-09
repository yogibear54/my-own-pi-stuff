# Part 4 — Log Snippet Injection & Cleanup

> Part of the [Pi AI Debugger](./ARCHITECTURE.md). Source requirements: `requirements.md` → "Log Snippet Code Injection" and "Log Snippet Code Cleanup".

## Purpose

The LLM adds targeted logging statements into source files to capture application state and
stream it to the log server. Snippets are wrapped in **identifiable delimiters** so they can be
removed precisely on cleanup. This part provides custom tools the model calls to add and remove
snippets safely.

## Delimiter format

```
/* AI_DEBUG_SNIPPET_START:ID=<n> NAME="<string>" */
<POST-to-server code in the target language>
/* AI_DEBUG_SNIPPET_END */
```

- `ID` — numeric, unique within a session; lets the agent target a specific snippet among many.
- `NAME` — short human label for the snippet's purpose.
- Block-comment delimiters work for C-family languages (JS/TS/Java/C/C++/Go/Rust/CSS/etc.).

### Per-language comments

Some languages lack block comments. Strategy:

- Default: block-comment form above.
- For line-comment-only languages (Python `#`, Ruby `#`, Shell `#`, etc.), emit paired
  single-line markers on their own lines:
    ```
    # AI_DEBUG_SNIPPET_START:ID=2 NAME="check token len"
    <POST code>
    # AI_DEBUG_SNIPPET_END
    ```
- The cleanup tool matches **both** forms, so the model may pick whichever is syntactically
  valid for the file.

## What the snippet body does

The model writes the actual HTTP POST (target language + libraries). Requirements leave this to
the agent. The snippet must POST a packet conforming to the Part 1 schema
(`log_id`, `event_timestamp`, `level`, `source{file,line,function}`, `message`, optional
`variables`/`stack_trace`) to the session telemetry target (`localhost:8866` local, or the
ngrok URL remote). `source.line` should be the line where the snippet sits.

## Custom tools (registered when debug mode active)

### `inject_snippet`

- Params: `path` (file), `line` (insert location), `id`, `name`, `language`, `code` (the body).
- Wraps `code` in the correct delimiters for `language` and inserts at `line`.
- **Must** run its read-modify-write inside `withFileMutationQueue(absPath, ...)` to avoid races
  with built-in `edit`/`write` running in parallel.
- Normalize a leading `@` on `path` (models sometimes prefix paths with `@`).
- Returns the inserted block text + resulting line number.

### `remove_snippet`

- Params: `path`, and one of `id` (preferred) or `all: true`.
- Finds the matching `START...END` span and removes it (and any blank line it leaves behind).
- Also `withFileMutationQueue`.

### `list_snippets`

- Params: optional `path` glob.
- Returns `{ id, name, file, line }[]` by scanning for delimiters. Useful before cleanup and to
  show the model what's instrumented.

### `cleanup_all_snippets`

- No params. Removes every tracked snippet in the session (called by `/debugger stop` and on fix
  acceptance). Keeps the actual fix code (snippets ≠ fix).

## Prompt guidance

Register `promptSnippet` + `promptGuidelines` on these tools so the model:

- Always wraps telemetry code in the `AI_DEBUG_SNIPPET_*` delimiters.
- Always POSTs packets matching the schema to the current telemetry target.
- Uses `inject_snippet`/`remove_snippet` rather than raw `edit` for telemetry, so cleanup is reliable.
- In **remote mode**, does not edit files — instead emits the snippet as a copy-paste patch.

## Tracking

Maintain a session map of `{ id → { file, name, line } }` so `/debugger stop` and "remove on failed
fix" are deterministic even if the model forgets a file. Persist via `appendEntry` (Part 5) so a
`/resume` can still clean up.

## Acceptance Criteria

1. `inject_snippet` adds a correctly-delimited block at the requested line in the right comment
   style for the language.
2. `remove_snippet({ id })` removes exactly that snippet and no surrounding code.
3. `cleanup_all_snippets` leaves the file byte-identical to its pre-instrumentation state
   **except** for any accepted fix (fixes are separate from snippets).
4. Concurrent `inject_snippet` + built-in `edit` on the same file do not corrupt each other
   (queue participation).
5. `list_snippets` accurately reports current snippets after add/remove.
6. Snippets POST a schema-valid packet that the Part 1 server accepts (200).

## Dependencies / Open Items

- Depends on Part 1 (server/schema) and Part 5 (state/session tracking).
- Decide how the model learns the exact `line` to report in `source.line` — simplest: the tool
  computes it from the insertion location and tells the model.
- Remote-mode patch format (unified diff vs fenced block) finalized here or in Part 2.
