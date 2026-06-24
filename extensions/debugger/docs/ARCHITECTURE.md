# Pi AI Debugger — Architecture Overview

> Design spec. Source of truth for the requirements: [`requirements.md`](./requirements.md).

## Goal

An autonomous, loop-based debugging agent integrated into the Pi TUI. It runs a local
HTTP log server, injects lightweight logging snippets into source files, streams the
captured telemetry into an instrumentation widget above the editor, and drives an
LLM debugging loop (context → hypothesis → test → fix → cleanup).

## Locked Decisions

| Decision | Value | Source |
|---|---|---|
| Server listening port | **8866** for both local and remote modes | Spec conflict resolved → Server section authoritative |
| Port configurability | Yes, overridable (e.g. env / settings) | Requirements |
| Log file model | **One file per `/debugger` session**, appended as JSONL at `.pi/logs/<random8>.log` | Spec ambiguity resolved |
| Widget placement | Above the editor (`ctx.ui.setWidget`, default placement) | Requirements |
| Command name | **`/debugger`** (not `/debug`) — pi's built-in `/debug` intercepts in the TUI before extensions run | Built-in conflict, pi 0.80.2 |

## Parts

The extension decomposes into 5 separable parts. Each has its own design doc:

1. **[HTTP Log Server](./01-log-server.md)** — receives POST telemetry, validates JSON, persists JSONL.
2. **[Slash Commands](./02-slash-commands.md)** — `/debugger`, `/debugger remote`, `/debugger stop`.
3. **[Instrumentation Widget](./03-instrumentation-widget.md)** — the 7-state live telemetry panel (⚠ blocked on wireframes).
4. **[Snippet Injection & Cleanup](./04-snippet-injection-cleanup.md)** — delimited logging snippets the LLM injects/removes.
5. **[Debugging Loop](./05-debugging-loop.md)** — the context→hypothesis→test→fix→cleanup state machine.

## Data Flow

```
target app (with injected snippet)
   │  HTTP POST (telemetry JSON)
   ▼
HTTP Log Server (:8866)  ──append──►  .pi/logs/<session>.log  (JSONL)
   │
   ├─ (in-memory) latest packets  ──►  Instrumentation Widget (TUI, above editor)
   │
   └─  LLM debugging loop reads logs + widget state to form/refine hypothesis & fix
```

- **Local mode** (`/debugger`): telemetry target is `http://localhost:8866`. Agent edits files directly.
- **Remote mode** (`/debugger remote`): an ngrok tunnel fronts `:8866`; the agent gives the user a public
  URL and provides **copy-pasteable patches** (it does not edit the remote codebase).
- **Stop** (`/debugger stop`): remove all injected snippets, stop server/tunnel, clear widget, exit loop.

## Proposed Extension Layout

```
debugger/
├── index.ts          # entry: wires commands, tools, events; owns session lifecycle
├── server.ts         # HTTP log server (node:http)
├── state.ts          # debug session state machine + persistence (appendEntry)
├── widget.ts         # instrumentation widget rendering + packet buffer
├── snippets.ts       # snippet delimiter parsing / generation helpers
├── tools.ts          # inject_snippet / remove_snippet / debug-state tools
└── skill/
    └── SKILL.md      # debugging-loop skill (LLM behavior + loop steps)
```

Standard Pi discovery locations: `~/.pi/agent/extensions/debugger/index.ts` (global) or
`.pi/extensions/debugger/index.ts` (project-local). Node built-ins (`node:http`, `node:fs`)
need no `package.json`; only add one if external deps are introduced.

## Architecture Pattern

The debugging loop is fundamentally **LLM behavior**, not hard-coded control flow. We mirror
the [`plan-mode`](../examples/extensions/plan-mode/index.ts) reference extension:

- **State machine** in `state.ts`, persisted via `pi.appendEntry` and restored on `session_start`.
- **LLM guidance** via a `skill/SKILL.md` loaded on demand + `before_agent_start` injection of the
  current state/goal (so the model knows which phase it is in).
- **Custom tools** (`tools.ts`) the model calls to report a hypothesis, request a user test,
  mark a bug fixed, etc. Tool results drive state transitions observed in `turn_end`.
- **Telemetry display** via `ctx.ui.setWidget`, fed by an in-memory ring buffer of received packets.

## Open Items / Blockers

- **Instrumentation widget wireframes** — required before finalizing the widget layout
  (see [03-instrumentation-widget.md](./03-instrumentation-widget.md)). A basic skeleton can be
  built now; visual design waits for the images.
- **ngrok availability** — `/debugger remote` assumes the `ngrok` binary is installed; behavior if
  absent needs defining (graceful fallback vs. error).
