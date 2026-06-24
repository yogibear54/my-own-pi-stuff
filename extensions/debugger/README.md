# Pi AI Debugger

An autonomous, loop-based debugging agent for the [Pi coding agent](https://github.com/earendil-works/pi-mono).
It runs a local HTTP telemetry server, lets the LLM inject lightweight logging
snippets into source files, streams captured telemetry into an instrumentation
widget above the editor, and drives a context → hypothesis → test → fix → cleanup
debugging loop.

> Spec & design: [`docs/requirements.md`](docs/requirements.md) and the part docs in [`docs/`](docs/).

## Status

| Part | Module | Status |
|---|---|---|
| 1. HTTP log server | `server.ts` | ✅ done + tested |
| 2. Slash commands `/debug` `/debug remote` `/debug stop` | `index.ts` | ✅ done (local + stop tested in pi; remote needs `ngrok`) |
| 3. Instrumentation widget | `widget.ts` | 🟡 **skeleton done + tested; visual design pending wireframes** |
| 4. Snippet injection & cleanup tools | `snippets.ts` + `index.ts` | ✅ done + tested |
| 5. Debugging loop (state machine + skill + tools) | `state.ts`, `skill/SKILL.md`, `index.ts` | ✅ done + tested |

**Blocked:** the widget's final visual layout is waiting on the wireframe images
referenced in the requirements. The current renderer implements all 7 states and
regions functionally; sizing/colour emphasis will be refined once the wireframes
arrive. See [`docs/03-instrumentation-widget.md`](docs/03-instrumentation-widget.md).

## Install

Copy this directory into a Pi discovery location:

```bash
# global (all projects)
cp -r . ~/.pi/agent/extensions/debugger

# or project-local
cp -r . <project>/.pi/extensions/debugger
```

No `package.json` is required — only Node built-ins and Pi packages are used.
After installing, `/reload` in Pi (or restart) to pick it up.

## Usage

| Command | Effect |
|---|---|
| `/debug` | Start a **local** session. Server on `:8866`; snippets target `http://localhost:8866`. Agent edits files directly. |
| `/debug remote` | Start with an **ngrok** tunnel. Snippets target the public URL. Agent gives copy-paste patches (no remote edits). |
| `/debug stop` | Stop the session: remove all telemetry snippets, stop server/tunnel, clear widget. **Keeps the fix and the log file.** |

The port is configurable via the `PI_DEBUG_PORT` env var.

The agent drives the loop with custom tools (`report_hypothesis`,
`request_user_test`, `mark_bug_fixed`, `debug_summary`, `inject_snippet`,
`remove_snippet`, `list_snippets`, `cleanup_all_snippets`) and the
`debugger` skill (`/skill:debugger`). Current state is always visible in the
instrumentation widget and injected into the LLM context each turn.

## Telemetry packet schema

Injected snippets POST JSON to the server:

```json
{
  "log_id": "1698844392123-4",
  "event_timestamp": "2023-11-01T14:53:12.123Z",
  "level": "ERROR",
  "source": { "file": "auth_controller.py", "line": 145, "function": "validate_user_token" },
  "message": "Failed to decrypt user token. Token length mismatch.",
  "variables": { "token_length": 12, "expected_length": 256 },
  "stack_trace": "Traceback (most recent call last):\n  ..."
}
```

Required: `log_id`, `event_timestamp`, `level`, `source{file,line,function}`, `message`.
Optional: `variables`, `stack_trace`.

## Snippet format

```
/* AI_DEBUG_SNIPPET_START:ID=1 NAME="check token" */
<POST-to-server code>
/* AI_DEBUG_SNIPPET_END */
```

`#`-comment languages (Python/Ruby/Shell) use the line style (`# AI_DEBUG_SNIPPET_…`).
The `inject_snippet` tool handles this; `cleanup_all_snippets` removes every
snippet while **preserving applied fixes**.

## Tests

Pure modules and the integrated tool/command flow are tested with Node's built-in
TypeScript type-stripping (no deps needed):

```bash
node --experimental-strip-types scripts/smoke-test.ts        # server: 200/400/405, JSONL append
node --experimental-strip-types scripts/state-test.ts        # state machine + attempt cap + serialize
node --experimental-strip-types scripts/snippets-test.ts     # delimiters + byte-clean round-trip
node --experimental-strip-types scripts/widget-test.ts       # 7-state widget rendering
node --experimental-strip-types scripts/integration-test.ts  # full /debug flow via mock ExtensionAPI
```

The integration test bootstraps module resolution with transient symlinks and
cleans them up afterward, so it leaves no `node_modules` behind.

## Layout

```
index.ts        entry: commands, tools, events, lifecycle, widget wiring
server.ts       HTTP log server (node:http) — Part 1
state.ts        DebugSession state machine — Part 5 core
snippets.ts     snippet delimiters: generate/parse/remove — Part 4 core
widget.ts       instrumentation widget renderer — Part 3
skill/SKILL.md  debugging-loop skill (LLM guidance)
docs/           requirements + per-part design docs
scripts/        test harnesses
```
