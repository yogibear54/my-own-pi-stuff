---
description: Execute a coding session as a todo-driven orchestrator loop with coding + code-review subagents
argument-hint: "[plan-file or todo-scope]"
---
# Subagent coding flow — orchestrator loop over a task list

Work through the defined task list (${@:-all open todos for the current plan}) using
the loop below. You are the **orchestrator**: you never edit feature code yourself.
All code changes are made by a **coding subagent** and gated by a **code-review
subagent**. One task at a time, from first TODO to last.

## Phase 0 — Plan & tasks (skip if tasks already exist)

1. If no plan exists yet, dispatch the `planning` subagent to investigate and write
   `.pi/plan/<slug>.md` with sections: **A** decisions (with alternatives), **B**
   numbered implementation steps, **C** risks, **D** verification checklist.
2. Surface plan decisions that need a user call (naming, schema, tradeoffs) to the
   user **before** creating tasks. Don't pick silently.
3. Create one TODO per plan step: `todo create` with a short title and a body
   containing context, concrete steps, **verify criteria**, and a reference to the
   plan section. Tag by area (frontend/backend/tests/docs).

## Phase 1 — Per-task loop

For each TODO, in order:

### 1. Pick up
`todo list-all` → take the next open task → `todo claim <id>`.

### 2. Dispatch coding subagent
Agent selection by local time: **14:00–18:00 → `coding-peakhour`**, otherwise
**`coding-regular`** (see `prompts/subagents.md`).

The prompt must be **self-contained** (the subagent cannot see this conversation):

- Goal in one line ("You are implementing one TODO…").
- The TODO body verbatim: context, steps, verify criteria, plan reference.
- **Scope guardrail**: "Do not make changes outside the scope of this TODO."
- Exact file paths to touch, and what to change (code sketches where design matters).
- Style requirements (match existing conventions; note any project rules, e.g. no
  inline JS in Blade, per-feature Request subdirs, test dir conventions).
- **Verify before done**: lint, targeted tests, full suite or build — actual
  commands with expected outcomes.
- **Reporting format**: one-line summary, the key diff/chunks, verification output
  last lines.
- Always end with: **"Do NOT commit — the orchestrator commits after code review."**

### 3. Stage and confirm what actually changed
`git add <files>`, then read `git diff --cached`. Subagents sometimes claim a fix
they left unstaged, or touch files outside the stated scope — verify before review.

### 4. Dispatch code-review subagent
`agent: "code-review"` (read-only). Give it:

- What changed and why (for bugfixes: the root cause).
- How to view it (`git diff --cached <paths>`).
- **Explicit, checkable criteria** — not "review this" but a checklist: correct
  branching, no regressions in other consumers of shared code, naming/style match,
  tests still green, edge cases the diff might break.
- Required output: **Verdict: PASS / NEEDS-CHANGES**; if NEEDS-CHANGES, numbered
  findings with severity (must-fix / nit), `file:line`, and a concrete fix.

### 5. Fix loop (until PASS)
If NEEDS-CHANGES:

- Send findings back to a **fresh coding subagent** (same agent-selection rule)
  with the findings verbatim, plus any newly discovered context (e.g. other
  consumers of the code being changed). Must-fixes are mandatory; apply nits when
  cheap. Re-state the scope guardrail and the no-commit rule.
- Re-stage, then **re-review with fresh eyes** (new `code-review` dispatch on the
  updated diff). Never let a coding agent self-approve.
- Repeat until PASS. Do not commit with open must-fix findings.

### 6. Commit and close
- Orchestrator commits: one descriptive conventional commit per task
  (`feat:`/`fix:`/`test:`/`docs:` + scope + why).
- If a fix belongs to an already-committed task, `git commit --fixup` +
  `git rebase --autosquash` instead of a stray fix commit.
- `todo update <id> --status closed`. Give the user a one-line progress note.
- Next TODO.

## Final task — verification & report

Make the last TODO a verification pass: `npm run build` (or equivalent), fresh
migrate + seed, **full** test suite, route/config checks, then write a report
marking auto-verified items ✅ and flagging anything needing a human (browser
flows, external services, multi-page/edge rendering). Also flag test-coverage
gaps noticed along the way as candidate follow-ups — don't fix them unbidden.

## Rules that keep the loop honest

- **One task at a time.** No batching, no speculative work.
- **Every changed line traces to the task.** Reviewers reject drive-by refactors.
- **Reviewers get fresh eyes and explicit criteria.** Generic reviews are useless.
- **Trust but verify.** Read the staged diff yourself before review; check claims
  (a reviewer may invent a consumer — confirm `file:line` before acting on it).
- **Self-contained subagent prompts.** Paths, line numbers, root cause, expected
  behavior — assume no shared context.
- **Orchestrator owns commits.** Subagents never commit.
- **Scope discoveries become new TODOs**, not silent expansion of the current one.
