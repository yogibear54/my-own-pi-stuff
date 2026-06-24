# Part 2 — Slash Commands

> Part of the [Pi AI Debugger](./ARCHITECTURE.md). Source requirements: `requirements.md` → "Application Environment Modes" table + "Command-Line Activation".

## Purpose

Three commands drive the debug lifecycle and select the telemetry/execution topology:

| Command | Mode | Telemetry target | Execution strategy |
|---|---|---|---|
| `/debugger` | Local | `http://localhost:8866` | **Automated** — agent edits files in the working dir |
| `/debugger remote` | Remote | ngrok public URL → `:8866` | **Instructional** — agent emits copy-pasteable patches |
| `/debugger stop` | All | — | Stops session, removes injected snippets, clears widget |

## API

`pi.registerCommand(name, { description, handler })`. Handler receives
`ExtensionCommandContext` (has `waitForIdle`, etc.).

## Behavior

### `/debugger` (local)

1. (Re)initialize debug state machine → enter `AWAITING CONTEXT` (see Part 5).
2. Start the log server on **8866** (lazy; Part 1).
3. Set telemetry target = `http://localhost:8866` (surfaced in the widget header + given to the
   LLM so injected snippets POST there).
4. Show the instrumentation widget (Part 3) in its initial state.
5. Activate the debugging tools (`inject_snippet`, `remove_snippet`, etc.) and ensure the
   debugging skill is available.
6. Notify the user the session is live and prompt for the bug/error context.

### `/debugger remote`

1. Same as local steps 1–2.
2. Verify `ngrok` is available (`pi.exec("ngrok", ["--version"])`). If missing → notify error
   with install hint and abort (no crash).
3. Start `ngrok http 8866` and scrape the public URL from its output/`ngrok api`.
4. Set telemetry target = the public ngrok URL.
5. Enter **instructional** mode: the agent must **not** edit the remote codebase. Instead it
   produces copy-pasteable patches the user applies on the remote host.
6. Surface the public URL prominently in the widget header and notify the user.

### `/debugger stop`

1. Run snippet cleanup: remove every `/* AI_DEBUG_SNIPPET_START... */ ... END */` block added
   during the session (Part 4), keeping any accepted fix.
2. Stop ngrok tunnel (if remote).
3. Close the log server (Part 1).
4. Clear the instrumentation widget (`ctx.ui.setWidget("debugger", undefined)`) and footer status.
5. Reset state machine; persist cleared state.
6. Notify "Debug session stopped."

## Argument handling

`/debugger` accepts an optional trailing arg: `local` (default) or `remote`, so `/debugger remote`
works. `/debugger stop` is a distinct command. Keep `/debugger` (no arg) = local to match the spec
table exactly.

## API touchpoints

- `pi.registerCommand("debugger", ...)` and `pi.registerCommand("debugger stop", ...)` — note: pi
  routes `/debugger stop` as args to `debugger` if only `debugger` is registered. To get a clean
  `/debugger stop`, register a dedicated `debugger` command that parses `args` (`local` | `remote` |
  `stop`), OR register `debugger` and `debugger-stop`. Confirm Pi's command-parsing behavior during
  implementation (likely parse `args` in a single `debugger` command for `/debugger remote`).
- `pi.exec` for ngrok.
- `pi.appendEntry` / state machine (Part 5) for session state.
- `ctx.ui.setWidget`, `ctx.ui.setStatus`, `ctx.ui.notify`.

## Acceptance Criteria

1. `/debugger` starts the server (port visible in widget header), enters debug mode, widget appears.
2. `/debugger remote` starts ngrok and shows a public URL; snippets target that URL.
3. `/debugger remote` errors gracefully (no crash) if `ngrok` is not installed.
4. `/debugger stop` removes injected snippets, stops server/tunnel, clears widget, restores normal tools.
5. `/debugger stop` is idempotent (calling when not debugging is a no-op with an info notify).
6. Stopping does **not** delete the session log file (logs persist per requirements).

## Dependencies / Open Items

- Depends on Part 1 (server), Part 3 (widget), Part 4 (cleanup), Part 5 (state machine).
- Verify how Pi tokenizes `/debugger remote` vs `/debugger stop` (single command w/ args vs. two).
- Decide remote-mode "instructional patch" format (unified diff? fenced code block?). Recommend
  fenced code block with file path header for copy-paste ergonomics; finalize in Part 4/5.
