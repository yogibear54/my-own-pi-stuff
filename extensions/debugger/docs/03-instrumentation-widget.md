# Part 3 — Instrumentation Widget

> Part of the [Pi AI Debugger](./ARCHITECTURE.md). Source requirements: `requirements.md` → "Instrumentation", "Instrumentation States", "Instrumentation Layout Requirements".

## ⚠ Blocked on wireframes

The requirements explicitly state wireframes exist and should be requested. The **visual
layout is provisional** until those images are provided. A functional skeleton (correct
placement + state-aware content) can be built now; final styling/scrolled windows follow the
wireframes.

## Placement

Above the editor via `ctx.ui.setWidget("debugger", renderFn)` (default `placement: "aboveEditor"`).
The requirements describe this as "inline, right above the bottom two status and command bars",
which matches the default above-editor widget region.

## Layout regions (per requirements)

1. **Header** — current debug status state, `LIVE LOGGING` indicator (when packets are flowing),
   inbound port info (and ngrok URL in remote mode). For local frontend JS/TS the user can
   `fetch()` the endpoint directly — surface that hint.
2. **Hypothesis statement** — static display of the current hypothesis under test + a hypothesis
   counter (increments each time a fix fails and a new hypothesis is formed).
3. **Log stream** — pretty-printed recent packets; scrollable, can scroll back to review history.
   Only shown when injected snippets are active and emitting.
4. **Body** — multi-purpose scrollable area: LLM questions, next-step prompts, and response
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

## Scroll-back constraint (design note)

`setWidget` render objects support `{ render, invalidate }` but **not** `handleInput`, so the
widget itself can't capture keystrokes for scrolling. Options:

- **A (default skeleton):** fixed tail window — show the last N pretty-printed packets, newest
  at the bottom; auto-scrolls. Simple, ships now, no scroll-back.
- **B (full scroll-back, post-wireframes):** take over with `ctx.ui.custom()` / an overlay when
  the user wants to scroll, or reserve a key that pops the log stream into a scrollable custom
  component. Decide after seeing wireframes.

Recommend **A now**, upgrade to **B** once the wireframes clarify how scroll-back is meant to
feel.

## API touchpoints

- `ctx.ui.setWidget("debugger", fn)` / `ctx.ui.setWidget("debugger", undefined)` to clear.
- `ctx.ui.setStatus("debugger", ...)` for a footer chip.
- State machine (Part 5) drives which region/state renders.
- Packet buffer (Part 1) feeds the log stream.

## Acceptance Criteria

1. Widget renders above the editor only while a debug session is active; gone after `/debugger stop`.
2. Header shows current state, port (8866 or ngrok URL), and a `LIVE LOGGING` indicator that
   appears while packets are arriving.
3. Hypothesis region shows the current hypothesis + counter; counter increments on failed fixes.
4. Log stream shows pretty-printed packets (level, source, message, key variables) and updates live.
5. Body shows the LLM's current question/affordance appropriate to the state.
6. Theme changes (e.g. `/theme`) update the widget without artifacts.
7. State transitions (Part 5) immediately update the rendered widget.

## Dependencies / Open Items

- **Wireframes** (layout, sizing, color emphasis).
- Deciding option A vs B for scroll-back.
- Pretty-print format for a packet (compact one-liner vs. expanded block) — pending wireframes.
