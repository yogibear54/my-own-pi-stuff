# Part 5 — The Debugging Loop

> Part of the [Pi AI Debugger](./ARCHITECTURE.md). Source requirements: `requirements.md` → "Core Automation Loops" (Phases 1–3), "Testing Loop Steps", and "Instrumentation States".

## Purpose

Orchestrate the LLM through the debug lifecycle: gather context → form a hypothesis → validate
via telemetry → fix → confirm → cleanup. This is **LLM behavior**, so it is implemented as a
state machine + a skill + custom tools + event hooks — **not** procedural control flow.

## Architecture (mirrors `plan-mode`)

- **`state.ts`** — debug session state: `{ active, mode, state, hypothesis, hypothesisCount,
  attempts, snippetIds, telemetryTarget }`. Persisted with `pi.appendEntry("debugger", state)`;
  restored on `session_start`.
- **`skill/SKILL.md`** — loaded on demand; teaches the model the loop, the snippet format, the
  packet schema, and when to call which tool.
- **`before_agent_start`** — inject a short, `display:false` context message telling the model
  the current state + goal + telemetry target, so it knows which phase it's in.
- **`turn_end`** — inspect tool results to advance the state machine (e.g. a `report_hypothesis`
  call → `HYPOTHESIS & BUG VALIDATION`; a `mark_bug_fixed` call → cleanup).
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

## Testing-loop protocol (from requirements §Phase 2)

1. **Hypothesis**: model states the suspected cause + the file(s)/function(s).
2. **Fix**: model implements a fix, then gives the user step-by-step reproduction instructions
   and asks for one of two responses: **"Bug Fixed"** or **"Continue to Debug"**.
3. **Continue** (still broken): model removes the failed fix **and** its logging snippets (log
   file may remain), then loops back to step 1 (new hypothesis, `hypothesisCount++`).
4. **Fixed**: enter cleanup — remove all telemetry/logging code, **keep the fix**, final validate.
5. After cleanup, ask the user: **exit Debug mode** or **Continue**.

## Custom tools (state-transition handles)

| Tool | Effect |
|---|---|
| `report_hypothesis(hypothesis, files[], functions[])` | Records hypothesis, sets `hypothesisCount`, transitions to `HYPOTHESIS & BUG VALIDATION`. |
| `request_user_test(steps)` | Renders reproduction steps in the widget body + the "Bug Fixed / Continue to Debug" affordance; waits for the user's answer. |
| `record_test_result(result)` | `fixed` → BUG FIXED/cleanup; `continue` → remove failed fix+snippets, back to HYPOTHESIS (or AWAITING CONTEXT if attempts ≥ max). |
| `mark_bug_fixed()` | Triggers telemetry cleanup (Part 4) keeping the fix, then final validation. |
| `debug_summary(text)` | Transitions to `DEBUG SUMMARY`; renders summary; asks exit vs continue. |

Max fix attempts default **3** (configurable). On exhaustion, go back to `AWAITING CONTEXT` for
more information (per requirements).

## User response affordance

The "Bug Fixed / Continue to Debug" choice is surfaced in the widget body (Part 3) and via
`ctx.ui.select`. The selection feeds `record_test_result`. This keeps the loop deterministic and
user-gated rather than the model guessing.

## Context gathering (Phase 1)

- High-context input (stack trace / clear snippet) → skip follow-ups, draft hypothesis directly.
- Vague input → ask hyper-targeted follow-ups (`AWAITING CONTEXT: AMBIGUOUS`).
- Uploaded files (images/PDFs) → `PARSING ASSET`; extract text via the model/skills; surface
  extracted summary as analysis source.

## API touchpoints

- `pi.appendEntry` / `pi.on("session_start")` for state persistence.
- `pi.on("before_agent_start")` for per-turn state injection.
- `pi.on("turn_end")` to advance state from tool results.
- `pi.registerTool` for the state-transition tools.
- `ctx.ui.select` for the Bug-Fixed/Continue affordance.
- Widget (Part 3) renders state.

## Acceptance Criteria

1. Starting `/debug` with no context lands the widget in `AWAITING CONTEXT`.
2. A pasted stack trace skips ambiguity and lets the model report a hypothesis directly.
3. Each failed fix increments `hypothesisCount`, removes the prior fix+snippets, and forms a new
   hypothesis.
4. After 3 failed attempts the loop returns to `AWAITING CONTEXT` requesting more info.
5. A user "Bug Fixed" choice triggers telemetry removal while preserving the fix, then a final
   validation, then `DEBUG SUMMARY`.
6. State survives `/resume` (snippets list + hypothesis reconstructed so cleanup still works).
7. The skill is discoverable and the model follows the loop without bespoke prompting.

## Dependencies / Open Items

- Depends on Parts 1 (schema/target), 3 (widget states), 4 (snippet cleanup).
- Decide where `maxAttempts` is configured (settings.json key; default 3).
- "Final validation" mechanics (re-run snippets once more after telemetry removal?) — confirm intent.
