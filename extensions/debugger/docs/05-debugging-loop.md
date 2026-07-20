# Part 5 — The Debugging Loop

> Part of the [Pi AI Debugger](./ARCHITECTURE.md). Source requirements: `requirements.md` → "Core Automation Loops" (Phases 1–3), "Testing Loop Steps", and "Instrumentation States".
>
> **Status: Implemented** in `state.ts` (state machine + persisted snippet map), `tools.ts`
> (transition tools), and `index.ts` (persistence, `session_start` restore, `before_agent_start`
> phase injection, widget sync). Transitions are **tool-driven** (inside `execute`), not
> `turn_end` introspection. **No `skill/SKILL.md`** — pi exposes no extension skill API, so loop
> guidance is delivered via the `before_agent_start` injection + tool `promptGuidelines`.

## Purpose

Orchestrate the LLM through the debug lifecycle: gather context → form a hypothesis → validate
via telemetry → fix → confirm → cleanup. This is **LLM behavior**, so it is implemented as a
state machine + custom tools + event hooks — **not** procedural control flow.

## Architecture (mirrors `plan-mode`)

- **`state.ts`** — canonical, persisted debug state: `{ active, mode, state, bug, hypothesis,
  hypothesisCount, attempts, snippetMap: {id→{file,name,line}}, telemetryTarget }`. Self-contained
  via `init({ persist, onChange })`: every mutator updates `current`, then persists
  (`pi.appendEntry("debugger", serialize())`) and notifies (→ widget sync). Restored on
  `session_start`. `report_bug` now writes persisted `state.bug` (no longer ephemeral).
- **`before_agent_start`** — each turn, injects a `display:false` context message with the current
  phase, bug, hypothesis #n, attempts/MAX, telemetry target, and a one-line loop protocol. This
  **is** the "skill": pi has no extension skill API (`loadSkillsFromDir` only auto-discovers from
  the skills directory, not extension dirs), so guidance is delivered in-code, not via a file.
- **`turn_end`** — *not used*. Transitions happen inside each tool's `execute` (mutate state →
  persist → sync widget), which is cleaner and more reliable than parsing tool results.
- **Custom tools** (below) — the model's handles for state transitions.

## The 7 states (from requirements)

```
AWAITING CONTEXT
   │  (some, vague context)
   ▼
AWAITING CONTEXT: AMBIGUOUS  ──(clarifying Qs)──►  back to AWAITING CONTEXT / forward
   │  (asset uploaded)
   ▼
PARSING ASSET ──(extracted)──► AWAITING CONTEXT
   │  (enough context)
   ▼
HYPOTHESIS & BUG VALIDATION  ◄──────┐  (fix failed; new hypothesis, attempts++)
   │  inject snippets, ask user to reproduce   │
   ▼                                        │
FIXING BUG ──(still broken)──► remove fix+snippets, back to HYPOTHESIS
   │  (max attempts, e.g. 3, reached) ──► back to AWAITING CONTEXT for more info
   │  (fixed)
   ▼
BUG FIXED  (remove telemetry, keep fix, final validate)
   │
   ▼
DEBUG SUMMARY  (ask: exit debug mode or continue)
```

> Note: `AWAITING CONTEXT: AMBIGUOUS` and `PARSING ASSET` are defined in the type but not yet
> auto-driven — the model can call `report_hypothesis` directly when it has enough context. Full
> Phase 1 heuristics are a future enhancement.

## Testing-loop protocol (from requirements §Phase 2)

1. **Hypothesis**: model states the suspected cause + the file(s)/function(s).
2. **Fix**: model implements a fix, then gives the user step-by-step reproduction instructions
   and asks for one of two responses: **"Bug Fixed"** or **"Continue to Debug"**.
3. **Continue** (still broken): telemetry snippets are removed automatically (`cleanupAllSnippets`);
   the model reverts its own fix code, then loops back to step 1 (new `report_hypothesis`,
   `hypothesisCount++`). The log file may remain.
4. **Fixed**: enter cleanup — remove all telemetry/logging code, **keep the fix**, final validate.
5. After cleanup, ask the user: **exit Debug mode** or **Continue**.

## Custom tools (state-transition handles)

| Tool | Effect |
|---|---|
| `report_bug(summary)` | Records the bug summary in persisted `state.bug` (also editable via `/debugger bug`). |
| `report_hypothesis(hypothesis, files?, functions?)` | Records hypothesis, `hypothesisCount++`, `attempts = 0`, → `HYPOTHESIS & BUG VALIDATION`. |
| `request_user_test(steps)` | Renders steps in the widget body + opens `ctx.ui.select("Reproduced?", ["Bug Fixed","Continue to Debug"])`, then advances: **Bug Fixed** → `cleanupAllSnippets` (fix kept) → `BUG FIXED` (then call `debug_summary`); **Continue** → `cleanupAllSnippets` + `attempts++` → `HYPOTHESIS & BUG VALIDATION`, or `AWAITING CONTEXT` at `≥ MAX`. *(Folds the doc's `record_test_result` + `mark_bug_fixed` into one user-gated tool.)* |
| `debug_summary(summary)` | → `DEBUG SUMMARY`, renders summary, `ctx.ui.select` Exit/Continue → Exit runs `/debugger stop`; Continue resets to `AWAITING CONTEXT` for a new bug. |

Max fix attempts: `DEFAULT_MAX_ATTEMPTS = 3` (constant in `state.ts`). On exhaustion →
`AWAITING CONTEXT` for more information (per requirements).

## User response affordance

The "Bug Fixed / Continue to Debug" choice is surfaced in the widget body (Part 3) and via
`ctx.ui.select`; the selection drives `request_user_test`'s transition directly. This keeps the
loop deterministic and user-gated rather than the model guessing.

## Context gathering (Phase 1)

- High-context input (stack trace / clear snippet) → skip follow-ups, draft hypothesis directly.
- Vague input → ask hyper-targeted follow-ups (`AWAITING CONTEXT: AMBIGUOUS`).
- Uploaded files (images/PDFs) → `PARSING ASSET`; extract text via the model/skills; surface
  extracted summary as analysis source.

## API touchpoints

- `pi.appendEntry("debugger", …)` / `pi.on("session_start")` for state persistence + restore.
- `pi.on("before_agent_start")` for per-turn phase injection (the loop-guidance channel).
- `pi.registerTool` for the transition tools.
- `ctx.ui.select` for the Bug-Fixed/Continue and Exit/Continue affordances.
- Widget (Part 3) renders state via `syncSnapshot` (state.ts → snapshot).

## Acceptance Criteria

1. ✅ `/debugger` with no context lands the widget in `AWAITING CONTEXT`.
2. ⚠️ A pasted stack trace skips ambiguity and lets the model report a hypothesis directly. *(Phase 1
   ambiguity/asset states are defined but not auto-driven yet — the model calls `report_hypothesis`
   directly. Full heuristics are future work.)*
3. ✅ Each failed fix (`request_user_test` "Continue") clears telemetry + `attempts++` and expects a
   new `report_hypothesis`.
4. ✅ After 3 failed attempts the loop returns to `AWAITING CONTEXT` requesting more info.
5. ✅ A "Bug Fixed" choice removes telemetry while preserving the fix → `BUG FIXED` →
   `debug_summary`. *(Final validation is a user-gated manual confirm in `debug_summary`, not an
   automatic snippet re-injection.)*
6. ✅ State survives `/resume`: `session_start` restores state + snippet map; `serialize`/`deserialize`
   normalize numeric snippet keys across JSON. Best-effort server restart so resumed telemetry flows.
7. ✅ The model is kept phase-aware every turn via the `before_agent_start` injection + tool
   `promptGuidelines` (no bespoke prompting needed). *(No `SKILL.md` — see Architecture.)*

## Dependencies / Open Items

- Depends on Parts 1 (schema/target) ✅, 3 (widget states) ✅, 4 (snippet cleanup) ✅.
- ✅ `maxAttempts` = `DEFAULT_MAX_ATTEMPTS` constant (3) in `state.ts`. A `settings.json` key can wrap it later.
- ✅ "Final validation" = user-gated manual confirm in `debug_summary` (no automatic re-injection after cleanup).
- Future: auto-drive `AWAITING CONTEXT: AMBIGUOUS` / `PARSING ASSET` (Phase 1 heuristics).
