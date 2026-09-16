# AGENTS.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## 5. Pi Agent Config Layout (this machine)

**Source of truth is `~/.pi/agent-git/` (git-tracked).** `~/.pi/agent/`
is NOT the source — it holds symlinks into `agent-git/`, toggled by the
`/system` command (the `system-manager` extension).

When creating or editing agent config, write to `~/.pi/agent-git/`:
- Skills → `skills/<name>/`   • Extensions → `extensions/<name>.ts`
- Prompts → `prompts/`        • Utils → `utils/`
- Root config (AGENTS.md, SYSTEM.md, models.json, …) → repo root

**Never write directly to `~/.pi/agent/`** — those are symlinks that
`/system` will overwrite or remove. After adding a new item, tell the
user to run `/system`, toggle it active (✓), then `/reload`. This
AGENTS.md is itself symlinked, so editing the `agent-git` copy is enough.

---

## 6. Coding subagent routing

When spawning a coding subagent via the `Agent` tool, pick based on local time:

- **14:00–18:00** → `agent: "coding-peakhour"`
- **Otherwise**   → `agent: "coding-regular"`

---

## 7. Other subagents

Two non-coding subagents live in `agents/`. Pick by task type:

- **`agent: "code-review"`** — Review work a coding
  subagent just finished. Pass the original task and the git checkout; the
  agent reads `git diff` and returns a structured review (verdict +
  numbered findings with severity, file/line, and concrete fix). Use
  after non-trivial coding work, before declaring done. Read-only.

- **`agent: "planning"`** — Investigate then
  produce a plan. Writes the plan to `.pi/plan/<slug>.md`
  (auto-creates the directory) so other subagents can read it. Use when
  the user asks for a plan, or for "investigate then propose" tasks where
  the next step is decisions rather than edits.
