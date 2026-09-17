# Subagent routing (when spawning subagents with the Agent tool)

For the full orchestrator workflow over a task list (todo → coding subagent →
code review → fix loop → commit), see `prompts/subagent-coding-flow.md`.

## Coding subagents

When spawning a coding subagent via the `Agent` tool, pick based on local time:

- **14:00–18:00** → `agent: "coding-peakhour"`
- **Otherwise**   → `agent: "coding-regular"`

Both share the same brief (focused, minimal, style-matching changes; verify and
report) and differ only in model and time window.

## Other subagents

Two non-coding subagents live in `agents/`. Pick by task type:

- **`agent: "code-review"`** — Review work a coding subagent just finished. Pass the original task and the git checkout; the agent reads `git status`/`git diff`, reads changed files in full, and runs tests/linters when present. Returns a structured review: verdict (`pass` / `pass with notes` / `needs changes` / `block`) + numbered findings with severity (`block` / `must-fix` / `nit`), file/line, and a concrete fix. Use after non-trivial coding work, before declaring done. Read-only. Act on `needs changes`/`block` by sending the findings back to a coding subagent, then re-review until the verdict is a pass.

- **`agent: "planning"`** — Investigate then produce a plan. Writes the plan to `.pi/plan/<slug>.md` (auto-creates the directory; that is the only file it writes) so coding and code-review subagents can read it later. Use when the user asks for a plan, or for "investigate then propose" tasks where the next step is decisions rather than edits.

The Agent tool also exposes built-in `general-purpose` and `Explore` agents; prefer the custom ones above for coding work.