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
4. Delete the per-session JSONL log file created for this session.
5. Clear the instrumentation widget (`ctx.ui.setWidget("debugger", undefined)`) and footer status.
6. Reset state machine; persist cleared state.
7. Notify "Debug session stopped."

## Argument handling

`/debugger` accepts an optional trailing arg: `local` (default) or `remote`, so `/debugger remote`
works. `/debugger stop` is handled as a trailing arg in the same handler. Keep `/debugger` (no arg)
= local to match the spec table exactly.

## API touchpoints

- `pi.registerCommand("debugger", ...)` — single command; the handler parses `args`
  (`local` | `remote` | `stop`). Confirmed: pi routes trailing words after a slash command as the
  `args` string, so `/debugger remote` and `/debugger stop` both reach the one handler.
- The command name is `debugger`, **not** `debug` — see Open Items (built-in `/debug` conflict).
- `pi.exec` for ngrok.
- `pi.appendEntry` / state machine (Part 5) for session state.
- `ctx.ui.setWidget`, `ctx.ui.setStatus`, `ctx.ui.notify`.

## Acceptance Criteria

1. `/debugger` starts the server (port visible in widget header), enters debug mode, widget appears.
2. `/debugger remote` starts ngrok and shows a public URL; snippets target that URL.
3. `/debugger remote` errors gracefully (no crash) if `ngrok` is not installed.
4. `/debugger stop` removes injected snippets, stops server/tunnel, clears widget, restores normal tools.
5. `/debugger stop` is idempotent (calling when not debugging is a no-op with an info notify).
6. `/debugger stop` deletes the per-session JSONL log file created for the session.

## Dependencies / Open Items

- Depends on Part 1 (server), Part 3 (widget), Part 4 (cleanup), Part 5 (state machine).
- **Command name is `/debugger`, not `/debug`.** Pi reserves a built-in `/debug`
  command (writes a screen-capture debug log). The TUI intercepts it in its command
  router (`if (text === "/debug")`) *before* extension commands are consulted, so an
  extension registering `debug` can never receive `/debug`. Confirmed in pi 0.80.2.
  The extension therefore registers `debugger` and the command parses trailing args
  (`remote` | `stop`) in a single handler. (The requirements table originally said
  `/debug`; this is the reason it was renamed.)
- Decide remote-mode "instructional patch" format (unified diff? fenced code block?). Recommend
  fenced code block with file path header for copy-paste ergonomics; finalize in Part 4/5.
