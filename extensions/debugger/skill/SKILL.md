---
name: debugger
description: Autonomous debugging loop for the Pi AI Debugger extension. Use when a debug session is active (/debugger) to gather context, form a hypothesis, validate it via injected telemetry, fix the bug, and clean up. Provides the telemetry packet schema and snippet format.
---

# Pi AI Debugger — Debugging Loop Skill

Use this skill **only while a debug session is active** (started with `/debugger` or
`/debugger remote`). The extension keeps the live state (current phase, hypothesis
counter, attempts left, telemetry target) and shows it in the instrumentation
widget above the editor.

## The loop

Follow these phases in order. The custom tools drive the state machine; **call
the tool that matches your current goal**.

### 1. Context gathering (`AWAITING CONTEXT` / `AWAITING CONTEXT: AMBIGUOUS` / `PARSING ASSET`)
- If the user gave a stack trace or clear error, skip to step 2.
- If vague, ask hyper-targeted questions (which file/function, exact symptom).
- If the user shared an image/PDF path, read/extract it and summarize findings.

### 2. Hypothesis (`HYPOTHESIS & BUG VALIDATION`)
- Call `report_hypothesis` with the suspected cause + the file(s)/function(s).
- Inject telemetry with `inject_snippet` around the suspected failure point to
  validate the hypothesis, then ask the user to reproduce.

### 3. Fix (`FIXING BUG`)
- Implement the fix (normal `edit`/`write`).
- Call `request_user_test` with step-by-step reproduction instructions. The user
  answers **"Bug Fixed"** or **"Continue to Debug"**:
  - **Bug Fixed** → `mark_bug_fixed` (removes telemetry, keeps the fix), then
    `debug_summary`.
  - **Continue to Debug** → first `remove_snippet`/`cleanup_all_snippets` for the
    failed attempt's telemetry AND revert the failed fix, then go back to step 2
    with a new hypothesis (counter increments).
- After `maxAttempts` (default 3) failed fixes, the loop returns to step 1 for
  more context.

## Telemetry packet schema (POST body)

Every injected snippet must POST a JSON object matching this shape to the
session **telemetry target** (shown in the widget header: `http://localhost:8866`
for local, or the ngrok URL for remote):

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

Required: `log_id`, `event_timestamp` (ISO 8601), `level`, `source{file,line,function}`,
`message`. Optional: `variables`, `stack_trace`. Set `source.line` to the line
where the snippet sits.

## Snippet format

Always wrap telemetry code in these delimiters (the `inject_snippet` tool does
this for you — prefer it over manual `edit`):

```
/* AI_DEBUG_SNIPPET_START:ID=1 NAME="check token" */
<POST-to-server code>
/* AI_DEBUG_SNIPPET_END */
```

For `#`-comment languages (Python/Ruby/Shell) use the line style:

```
# AI_DEBUG_SNIPPET_START:ID=1 NAME="check token"
<POST-to-server code>
# AI_DEBUG_SNIPPET_END
```

`ID` is the unique snippet id used by `remove_snippet`. Snippets are sequential,
never nested. `cleanup_all_snippets` removes every snippet but **never** your fix
(fixes are separate edits).

## Remote mode

In `/debugger remote` the codebase is **not** local — do not edit files directly.
Instead emit copy-pasteable patches (a fenced code block with the target file
path) and ask the user to apply them on the remote host.
