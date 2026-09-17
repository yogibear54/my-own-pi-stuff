# Subagent routing (when spawning subagents with the Agent tool)

## Coding subagents

When spawning a coding subagent via the `Agent` tool, pick based on local time:

- **14:00–18:00** → `agent: "coding-peakhour"`
- **Otherwise**   → `agent: "coding-regular"`

## Other subagents

Two non-coding subagents live in `agents/`. Pick by task type:

- **`agent: "code-review"`** — Review work a coding subagent just finished. Pass the original task and the git checkout; the agent reads `git diff` and returns a structured review (verdict + numbered findings with severity, file/line, and concrete fix). Use after non-trivial coding work, before declaring done. Read-only.

- **`agent: "planning"`** — Investigate then produce a plan. Writes the plan to `.pi/plan/<slug>.md` (auto-creates the directory) so other subagents can read it. Use when the user asks for a plan, or for "investigate then propose" tasks where the next step is decisions rather than edits.