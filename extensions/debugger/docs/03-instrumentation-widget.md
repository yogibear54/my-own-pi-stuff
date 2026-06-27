# Part 3 — Instrumentation Widget

> Part of the [Pi AI Debugger](./ARCHITECTURE.md). Source requirements: `requirements.md` → "Instrumentation", "Instrumentation States", "Instrumentation Layout Requirements".

## Placement

Above the editor via `ctx.ui.setWidget("debugger", renderFn)` (default `placement: "aboveEditor"`).
The requirements describe this as "inline, right above the bottom two status and command bars",
which matches the default above-editor widget region.

## Layout regions (per requirements)

1. **Header** — current debug status state, `LIVE LOGGING` indicator (when packets are flowing),
   inbound port info (and ngrok URL in remote mode). For local frontend JS/TS the user can
   `fetch()` the endpoint directly — surface that hint.
2. **Bug summary** — a `BUG` label on its own line followed by one or more indented lines
   summarizing the bug under investigation. Empty (placeholder) until the bug is described.
   The summary may span multiple lines (`DebugSnapshot.bug: string[]`).
3. **Hypothesis statement** — static display of the current hypothesis under test + a hypothesis
   counter (increments each time a fix fails and a new hypothesis is formed). The hypothesis may
   span multiple lines (`DebugSnapshot.hypothesis: string[]`); the label + counter sit on the
   header line, each hypothesis line indented below.
4. **Log stream** — pretty-printed recent packets; scrollable, can scroll back to review history.
   Only shown when injected snippets are active and emitting.
5. **Body** — multi-purpose scrollable area: LLM questions, next-step prompts, and response
   confirmation affordances ("Bug Fixed" / "Continue to Debug").

## Instrumentation States (7)

| State | Meaning | Widget shows |
|---|---|---|
| `AWAITING CONTEXT` | No bug context yet | Header + prompt for error/trace/screenshot |
| `AWAITING CONTEXT: AMBIGUOUS` | Context too vague | Header + LLM's clarifying questions |
| `PARSING ASSET` | User uploaded image/pdf | Header + "parsing…" + extracted summary |
| `HYPOTHESIS & BUG VALIDATION` | Enough context; forming hypothesis | Hypothesis + counter + (log stream when snippets live) |
| `FIXING BUG` | Fix deployed; awaiting user test | Fix summary + "Bug Fixed / Continue" affordance |
| `BUG FIXED` | Accepted; cleaning up telemetry | Cleanup progress + final test prompt |
| `DEBUG SUMMARY` | Done | Summary of bug + fixes applied |

## Rendering approach

- Use the `setWidget` callback form returning `{ render(width), invalidate() }` so content can be
  rebuilt on theme change and on each new packet.
- Theme via the callback's `theme` arg (`theme.fg(...)`, `theme.bg(...)`) — never import a theme
  globally.
- Rebuild themed content in `invalidate()` (see TUI docs: components that pre-bake colors must
  rebuild on invalidate).
- Wire packet buffer from Part 1 (`onPacket`) → `requestRender`/invalidate the widget.

## Scroll-back (resolved)

Always-on widgets are hard-capped at `MAX_WIDGET_LINES = 10` and are **never focusable**
(the editor always holds focus), so they cannot capture scroll keystrokes. The log stream
is therefore split into two surfaces, both now implemented:

- **In-widget tail** (`widget.ts`): the last `TAIL_LIMIT` (3) packets as compact one-liners
  (`LEVEL file:line fn — message`), newest at the bottom, plus a hint line
  `↑ /debugger logs to scroll history (N total)`. Shares the 10-line widget budget with the
  header/hypothesis/body, so in practice 2–3 packets fit.
- **Scroll overlay** (`logstream.ts`): a focusable `ctx.ui.custom({ overlay: true })` component
  (`LogStreamOverlay` implements pi-tui `Focusable`) showing **expanded** packets with full
  session history. Opened via `/debugger logs` and auto-opened on `/debugger` start.
  Keys: `↑/↓` line, `PgUp/PgDn` page, `Home/End` jump, `q/Esc` close. **Live-follow**: when
  pinned to the bottom (default) the view advances as new packets arrive; scrolling up pauses
  follow so the view stays put. New packets live-refresh the open overlay via `tui.requestRender()`
  (called from `onPacket`).

## API touchpoints

- `ctx.ui.setWidget("debugger", lines)` (string-array form) for the always-on widget.
- `ctx.ui.custom((tui, theme, kb, done) => component, { overlay: true, overlayOptions })` for the
  scroll overlay; `done()` closes it. See `examples/extensions/overlay-test.ts` / `snake.ts`.
- `ctx.ui.setStatus("debugger", ...)` for a footer chip.
- `/debugger` starts the log server (`server.ts`) and opens the overlay; `/debugger logs` reopens
  it; `/debugger stop` closes server + overlay + widget.
- The server's `onPacket(packet)` callback pushes to the session packet buffer, repaints the
  widget tail, and calls `overlay.refresh()` when open. UI context is captured on `session_start`
  (the safe place for out-of-command repaints).

## Acceptance Criteria

1. Widget renders above the editor only while a debug session is active; gone after `/debugger stop`.
2. Header shows current state, port (8866 or ngrok URL), and a `LIVE LOGGING` indicator that
   appears while packets are arriving.
3. Bug summary region shows the current bug description; placeholder until the bug is described,
   and supports multi-line summaries.
4. Hypothesis region shows the current hypothesis + counter; counter increments on failed fixes.
   The hypothesis may span multiple lines.
5. Log stream shows pretty-printed packets (compact one-liner tail in-widget; expanded block
   in the `/debugger logs` overlay) and updates live as packets arrive.
6. The overlay scrolls back through full history (`↑/↓`, `PgUp/PgDn`, `Home/End`),
   live-follows while pinned to the bottom, and closes with `q`/`Esc`.
7. Body shows the LLM's current question/affordance appropriate to the state.
8. Theme changes (e.g. `/theme`) update the widget without artifacts.
9. State transitions (Part 5) immediately update the rendered widget.

## Dependencies / Open Items

- **Wireframes** (final layout/sizing/color emphasis) — functional skeleton + scroll overlay
  are in place; visual polish follows the wireframes.
- The in-widget tail shares pi's 10-line widget cap (2–3 packets); the overlay is the full
  viewer. No line-wrapping in the overlay yet (long `message`/`stack_trace` may clip).
- The overlay captures its theme at open time; a live `/theme` switch mid-overlay won't restyle
  it (reopen to refresh).
