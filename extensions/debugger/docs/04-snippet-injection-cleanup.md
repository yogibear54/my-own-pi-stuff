# Part 4 — Log Snippet Injection & Cleanup

> Part of the [Pi AI Debugger](./ARCHITECTURE.md). Source requirements: `requirements.md` → "Log Snippet Code Injection" and "Log Snippet Code Cleanup".
>
> **Status: Implemented** in `snippets.ts` (pure helpers) + `tools.ts` (tool factory + registry), wired into `index.ts`. Id policy = **hybrid** (model may pass an `id`; tool auto-assigns if omitted/collides). Registry is **ephemeral** for now — Part 5 makes it resume-safe via `appendEntry`.

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

- `ID` — numeric, unique within a session. **Hybrid policy:** the model may pass an `id`; if omitted or already used, `inject_snippet` auto-assigns the next free session id and returns it. Lets the agent target a specific snippet among many.
- `NAME` — short human label for the snippet's purpose.
- Block-comment delimiters work for C-family languages (JS/TS/Java/C/C++/Go/Rust/CSS/etc.).

### Per-language comments

`commentStyleFor(language)` dispatches one of three styles (unknown → block default):

- **block** (default) — C-family block comments: JS/TS/JSX/TSX/Java/C/C++/C#/Go/Rust/Swift/Kotlin/CSS/SCSS/**PHP** (+ `phtml`), …:
    ```
    /* AI_DEBUG_SNIPPET_START:ID=1 NAME="probe" */
    <POST code>
    /* AI_DEBUG_SNIPPET_END */
    ```
- **hash** — `#` line comments: Python, Ruby, Shell/Bash/Zsh, YAML, TOML, Perl, R, Dockerfile, …:
    ```
    # AI_DEBUG_SNIPPET_START:ID=2 NAME="check token len"
    <POST code>
    # AI_DEBUG_SNIPPET_END
    ```
- **liquid** — Shopify Liquid `{% comment %}` tags (`liquid`, `shopify_liquid`):
    ```
    {% comment %} AI_DEBUG_SNIPPET_START:ID=3 NAME="marker" {% endcomment %}
    <POST code or host-app hook>
    {% comment %} AI_DEBUG_SNIPPET_END {% endcomment %}
    ```
    Liquid is a server-rendered template language and **cannot POST telemetry itself** — any
    telemetry must be emitted by the surrounding host app (Ruby/Rails, Node, …). The delimiters
    keep the template syntactically valid and act as markers.

`findSnippets` matches the style-agnostic `AI_DEBUG_SNIPPET_START…END` core, so cleanup works
regardless of which style was used.

## What the snippet body does

The model writes the actual HTTP POST (target language + libraries). Requirements leave this to
the agent. The snippet must POST a packet conforming to the Part 1 schema
(`log_id`, `event_timestamp`, `level`, `source{file,line,function}`, `message`, optional
`variables`/`stack_trace`) to the session telemetry target (`localhost:8866` local, or the
ngrok URL remote). `source.line` should be the line where the snippet sits.

## Custom tools (registered when debug mode active)

### `inject_snippet`

- Params: `path`, `line` (1-based insert location), `name`, `language`, `code` (the body),
  optional `id`.
- Wraps `code` in the correct delimiters for `language` and inserts at `line`.
- Read-modify-write runs inside `withFileMutationQueue(absPath, ...)` to avoid races with the
  built-in `edit`/`write` (they share the same per-file queue).
- Normalizes a leading `@` on `path`.
- **Hybrid id:** uses a passed `id` if free, else auto-assigns the next session id. **Returns the
  assigned id + resulting line** — the model echoes this back as `source.line` in its packets.

### `remove_snippet`

- Params: `path`, and one of `id` (preferred) or `all: true`.
- Finds the matching `START...END` span and removes it (and any blank line it leaves behind).
- Also `withFileMutationQueue`.

### `list_snippets`

- Params: optional `path` glob.
- Returns `{ id, name, file, line }[]` by scanning for delimiters. Useful before cleanup and to
  show the model what's instrumented.

### `cleanup_all_snippets`

- No params. Removes every tracked snippet in the session. Called by `/debugger stop` (wired)
  and on fix acceptance (Part 5's `mark_bug_fixed`). Keeps the actual fix code (snippets ≠ fix).
  Best-effort: returns a per-file error list rather than throwing.

## Prompt guidance

Register `promptSnippet` + `promptGuidelines` on these tools so the model:

- Always wraps telemetry code in the `AI_DEBUG_SNIPPET_*` delimiters.
- Always POSTs packets matching the schema to the current telemetry target.
- Uses `inject_snippet`/`remove_snippet` rather than raw `edit` for telemetry, so cleanup is reliable.
- In **remote mode**, does not edit files — instead emits the snippet as a copy-paste patch.

## Tracking

An in-memory session registry `{ id → { file, name, line } }` (in `tools.ts`) makes
`/debugger stop` and "remove on failed fix" deterministic even if the model forgets a file.
**Persistence is deferred to Part 5** (`appendEntry`) so a `/resume` can still clean up; today the
registry is ephemeral and reset on start/stop.

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

- Depends on Part 1 (server/schema) ✅ and Part 5 (state/session tracking) for resume-safe persistence.
- ✅ `source.line`: `inject_snippet` computes and returns the resulting line; the model echoes it.
- ✅ `id` policy: hybrid (model may pass; tool auto-assigns if omitted/collides).
- Remote-mode patch format (unified diff vs fenced block) finalized when `/debugger remote` is built.
- AC4 concurrency is verified via two parallel `withFileMutationQueue` mutations; full parity with
  the built-in `edit` holds because both share the same per-file queue.
