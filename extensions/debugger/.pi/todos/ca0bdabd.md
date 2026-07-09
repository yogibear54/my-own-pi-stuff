{
  "id": "ca0bdabd",
  "title": "Slash commands /debugger, /debugger stop (Part 2) — DONE",
  "tags": [
    "debugger",
    "part-2",
    "commands"
  ],
  "status": "done",
  "created_at": "2026-06-24T00:53:43.432Z"
}

**Status: DONE — closing.** Part-2-resident work (local + stop core) is implemented
and verified in `index.ts`; bonus `/debugger logs`, `/debugger bug`, and the
`report_bug` tool shipped alongside. `/debugger remote` is **deferred**
(low priority → separate todo). Cross-part wiring on `stop()` (snippet cleanup,
state-machine reset+persist) is owned by Parts 4/5 — see Deferred.

**Reference: [docs/02-slash-commands.md](docs/02-slash-commands.md).**

> **Command name is `/debugger`, not `/debug`.** pi reserves a built-in `/debug`
> command (screen-capture debug log); the TUI intercepts it before extension
> commands run. Confirmed in pi 0.80.2. The extension registers `debugger` and
> parses trailing args in one handler.

## Shipped (implemented in index.ts)
- `/debugger` (local): start server on 8866, telemetry target
  `http://localhost:8866`, widget + red "debug" footer status, auto-open the live
  log overlay, notify. ✅ (AC1)
- `/debugger stop`: close server, **delete the per-session JSONL log file**
  (`rmSync`), clear widget + footer status, close overlay, reset snapshot.
  Idempotent (no-session → info notify). ✅ (AC4-partial, AC5, AC6)
- `/debugger logs`: open the scrollable telemetry overlay. ✅ (bonus)
- `/debugger bug [text]` + `report_bug` tool: set/edit/clear the bug summary; the
  same field is updated by both. ✅ (AC7, bonus)

## Deferred
- **`/debugger remote`** (ngrok, public-URL scrape, instructional mode, graceful
  missing-ngrok error) — reprioritized below Parts 4–5. Tracked in its own
  low-priority todo. (AC2, AC3 not met.)
- **Snippet cleanup on `stop()`** — owned by Part 4. (AC4 remainder.)
- **State-machine reset + `pi.appendEntry` persist on `stop()`** — owned by Part 5.
- "Prompt for bug context" on local start: passive widget hint + notify is
  sufficient (no active `ui.input` prompt). Decision recorded.

## Resolved (contradiction fixed)
- **Log file on stop: DELETE, not keep.** Original body said "keep the log file";
  code + AC6 + docs/02 §stop step 4 all delete. Corrected here.
