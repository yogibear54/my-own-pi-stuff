# Tutorial Extension

A pi extension for creating, expanding, and maintaining interactive codebase tutorials.
Uses a two-pass workflow: **Pass 1** generates a skeleton, **Pass 2** deep-dives into detailed content.

---

## Architecture

The extension is organized as a modular directory under `~/.pi/agent/extensions/tutorial/`:

```
tutorial/
├── index.ts                    # Entry point — registers all commands & tools
├── types.ts                    # All shared interfaces & type definitions
├── constants.ts                # Constants + shared mutable state (tmux session)
├── drift.ts                    # Git-based drift detection algorithm
├── todos.ts                    # Todo tracking (.pi/todos + TODO.md fallback)
│
├── utils/                      # Low-level I/O & system utilities
│   ├── git.ts                  #   Git operations (getGitCommit, getGitChanges)
│   ├── readme.ts               #   README parse/update/add history entry
│   ├── chapters.ts             #   chapters.json load/save
│   ├── tmux.ts                 #   tmux availability check, name sanitization
│   └── paths.ts                #   Path expansion, project name inference, glob→regex
│
├── prompts/                    # LLM prompt construction (pure functions, no side effects)
│   ├── tutorial-create.ts      #   Pass 1 skeleton prompt builder
│   ├── deep-dive.ts            #   Inline deep-dive prompt builder
│   ├── analysis.ts             #   Phase 1 parallel analysis prompt builder
│   └── worker.ts               #   Per-chapter worker task prompt builder
│
├── commands/                   # Slash command handlers
│   ├── create.ts               #   /tutorial:create
│   ├── deep-dive.ts            #   /tutorial:deep-dive + parallel orchestrator
│   └── update.ts               #   /tutorial:update
│
└── tools/                      # LLM-callable tool registrations
    ├── configure.ts            #   configure_tutorial tool
    └── check-drift.ts          #   check_tutorial_drift tool
```

### Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Prompts as pure functions** | All prompt builders take config + data, return strings — no side effects, easy to test |
| **Utils by resource** | Each utility file owns one resource (git, readme, chapters, tmux, paths) |
| **Drift detection isolated** | Pure algorithm (`detectDriftViaGit`) separated from git I/O |
| **Commands own their flow** | Each command file is self-contained — imports what it needs, registers itself |
| **Tools separate from commands** | Tools (LLM-callable) vs commands (user-invoked) have different contracts |
| **Types centralized** | All 12 interfaces in one `types.ts` — avoids circular import chains |

---

## Commands

### `/tutorial:create <tutorial-dir> [source-code-dir]`

Creates a **skeleton tutorial** (Pass 1) from a source codebase.

| Mode | Behavior |
|------|----------|
| Quick (args provided) | Uses defaults, runs immediately |
| Interactive (no args) | LLM gathers requirements via conversation |

**Defaults** (quick mode):
- Audience: Developers familiar with JavaScript but new to TypeScript
- Goals: Navigate the codebase, Understand architecture patterns, Make small changes, Debug common issues
- Scope: detailed
- Quizzes: Yes, Diagrams: Yes
- Tech stack: React

**Outputs:**
- Full tutorial app project (Vite + React/Vue/Svelte/HTML + TypeScript)
- `chapters.json` — index mapping chapters → source files + tutorial config
- `README.md` — with "Based On Commit", source location, status, update history
- Todo items (`.pi/todos/` or fallback `TODO.md`)

**Code:** `commands/create.ts` → `registerTutorialCreateCommand()`

---

### `/tutorial:deep-dive <tutorial-dir> [source-code-dir] [chapter-id] [--concurrency N]`

Expands skeleton chapters with **detailed analysis** (Pass 2).

**Argument parsing:**
```
/tutorial:deep-dive ./my-tutorial                          # All chapters, concurrency 4
/tutorial:deep-dive ./my-tutorial architecture             # Single chapter (inline)
/tutorial:deep-dive ./my-tutorial --concurrency 2          # All chapters, 2 parallel
/tutorial:deep-dive ./my-tutorial --concurrency=8          # All chapters, 8 parallel
/tutorial:deep-dive ./my-tutorial /src/path --source=/src  # Explicit source override
```

#### Execution Modes

| Condition | Mode | Behavior |
|-----------|------|----------|
| Single chapter | **Inline** | Sends `buildDeepDivePrompt()` to current pi session |
| No tmux available | **Inline** | Same as single chapter |
| Multi-chapter + tmux | **Parallel** | Two-phase: analysis → fork workers |

**Code:** `commands/deep-dive.ts` → `registerTutorialDeepDiveCommand()`

---

### `/tutorial:update <tutorial-dir> [source-code-dir] [base-commit]`

Detects **drift** between the tutorial's baseline commit and current source HEAD, then updates outdated chapters.

**Drift detection:**
1. Reads "Based On Commit" from `README.md`
2. Runs `git diff --name-status <base>..HEAD` on source codebase
3. Cross-references changed files against `chapters.json` chapter → source file mappings
4. Reports which chapters are outdated and which are up-to-date

**Code:** `commands/update.ts` → `registerTutorialUpdateCommand()`

---

## Tools (LLM-callable)

### `configure_tutorial`

Structured requirement gathering for tutorial creation. Accepts all configuration fields, creates todo items, and builds the creation prompt.

**Parameters:**
| Field | Type | Required | Default |
|-------|------|----------|---------|
| `tutorialDir` | string | ✓ | — |
| `sourceDir` | string | ✗ | `ctx.cwd` |
| `projectName` | string | ✗ | Inferred from dir name |
| `audience` | string | ✗ | "Developers familiar with JS but new to TS" |
| `goals` | string[] | ✗ | Navigate, Architecture, Changes, Debug |
| `scope` | "overview" \| "detailed" \| "comprehensive" | ✗ | "detailed" |
| `includeQuizzes` | boolean | ✗ | true |
| `includeDiagrams` | boolean | ✗ | true |
| `techStack` | "react" \| "vue" \| "svelte" \| "html" | ✗ | "react" |

**Code:** `tools/configure.ts` → `registerConfigureTutorialTool()`

### `check_tutorial_drift`

Detects which chapters are outdated by comparing README.md baseline against current git HEAD.

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tutorialDir` | string | ✓ | Tutorial directory with README.md + chapters.json |
| `sourceDir` | string | ✗ | Override source dir (else from README) |
| `baseCommit` | string | ✗ | Override baseline commit (else from README) |

**Code:** `tools/check-drift.ts` → `registerCheckTutorialDriftTool()`

---

## Parallel Deep-Dive Architecture

When multiple chapters need expansion and tmux is available, the deep-dive command uses a **two-phase approach** with a worker pool to process chapters concurrently.

### Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  Parent pi session (your terminal)                                   │
│                                                                      │
│  /tutorial:deep-dive ./my-tutorial                                   │
│       │                                                              │
│       ▼                                                              │
│  runParallelDeepDive()                                               │
│       │                                                              │
│       ├── Phase 1: Analysis                                          │
│       │   ├── creates tmux session "tdd-my-tutorial"                 │
│       │   ├── tmux window "analysis"                                 │
│       │   │   pi --session-dir /tmp/tdd-XXXX/sessions \              │
│       │   │      -p --stream=on @analysis-prompt.md                  │
│       │   └── polls analysis-status file                             │
│       │                                                              │
│       ├── Phase 2: Fork Workers (inherits analysis context)          │
│       │   ├── Worker 1 ──► tmux window "ch01-arch"                  │
│       │   │   pi --fork <session>.jsonl --no-session \               │
│       │   │      -p --stream=on @task-arch.md                        │
│       │   ├── Worker 2 ──► tmux window "ch02-modules"               │
│       │   ├── Worker 3 ──► tmux window "ch03-dataflow"              │
│       │   └── Worker 4 ──► tmux window "ch04-patterns"              │
│       │                                                              │
│       ├── polls status-<id> files every 2s                           │
│       ├── updates TUI widget with progress                           │
│       └── sends final summary when all complete                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Why Two Phases?

Phase 1 reads and analyzes every source file once. Phase 2 forks that analysis session so each chapter worker inherits the full codebase understanding — no redundant file reads. Workers are fully isolated via `--no-session` (ephemeral, no saved state).

### Worker Lifecycle

```
1. Worker picks next queued chapter (nextIndex++)
2. Mark chapter status → "running"
3. tmux new-window → runs wrapper script:
     #!/bin/bash
     cd '<cwd>'
     pi --fork '<analysis-session>.jsonl' --no-session \
        -p --stream=on @'<task-file>'
     echo "$EXIT_CODE" > '<status-file>'
4. Parent polls for status file (2s interval)
5. On status file appearance:
   - Read exit code
   - Mark → "done" (exit 0) or "failed" (non-zero)
   - Update widget
   - Worker picks next chapter
```

### Per-Chapter Files (in `/tmp/tdd-XXXXXX/`)

| File | Purpose |
|------|---------|
| `analysis-prompt.md` | Phase 1 prompt — comprehensive codebase analysis |
| `analyze.sh` | Bash wrapper for Phase 1 analysis |
| `analysis-status` | Phase 1 exit code |
| `analysis-session-path` | Path to the `.jsonl` session file (for forking) |
| `task-<chapter-id>.md` | Phase 2 task prompt for this chapter |
| `run-<chapter-id>.sh` | Bash wrapper: fork session, run pi, write exit code |
| `status-<chapter-id>` | Exit code written on completion (polled by parent) |

### TUI Progress Widget

Displayed via `ctx.ui.setWidget("tutorial-deep-dive", ...)`:

```
--- Deep Dive Progress ---
  ... analysis        Codebase analysis (45s)
  OK  arch            Architecture Overview (32s)
  OK  modules         Key Modules (28s)
  ... dataflow        Data Flow Patterns
  .   patterns        TypeScript Patterns
---
  Phase 2: Expanding  2/4 done  1 running  1 queued  0 failed
  tmux attach -t tdd-my-tutorial
```

### Cleanup & Error Handling

| Event | Behavior |
|-------|----------|
| `session_shutdown` | Kills active tmux session, clears `activeDeepDiveSession` |
| tmux not available | Falls back to inline mode (single prompt) |
| tmux session creation fails | Falls back to inline mode with warning |
| Analysis fails | Falls back to inline mode with warning |
| Analysis session file not found | Falls back to inline mode with warning |
| Worker spawn fails | Marks chapter as "failed", continues with next |
| Chapter pi subprocess fails | Exit code written to status file, reported in summary |
| All complete | Summary sent to parent, widget cleared after 30s |

### Concurrency Control

- Default: `DEFAULT_CONCURRENCY = 4`
- Override: `--concurrency N` flag
- Worker pool size: `min(concurrency, chapters.length)`
- Each worker processes chapters sequentially from a shared `nextIndex` counter (no lock needed — JS is single-threaded for the increment)

---

## Data Types

All types are defined in `types.ts`.

### `TutorialConfig`
```typescript
interface TutorialConfig {
  tutorialDir: string;       // Where tutorial files are created
  sourceDir: string;         // Source codebase being documented
  projectName: string;       // Display name
  audience: string;          // Target audience description
  goals: string[];           // Learning objectives
  scope: "overview" | "detailed" | "comprehensive";
  includeQuizzes: boolean;
  includeDiagrams: boolean;
  techStack: "react" | "vue" | "svelte" | "html";
}
```

### `ChaptersIndex`
```typescript
interface ChaptersIndex {
  version: number;
  updatedAt: string;         // ISO timestamp
  config?: TutorialConfig;   // Saved during /tutorial:create
  chapters: ChapterEntry[];
}
```

### `ChapterEntry`
```typescript
interface ChapterEntry {
  id: string;                // kebab-case identifier
  title: string;             // Display title
  sourceFiles: string[];     // Relative paths from sourceDir (supports globs)
  chapterFile?: string;      // Relative path to chapter component in tutorialDir
}
```

### `DriftResult`
```typescript
interface DriftResult {
  outdatedChapters: OutdatedChapter[];  // Chapters with changed source files
  upToDateChapters: UpToDateChapter[];  // Chapters with no changes
}
```

### `DeepDiveChapterStatus` (parallel mode only)
```typescript
interface DeepDiveChapterStatus {
  chapter: ChapterEntry;
  status: "queued" | "running" | "done" | "failed";
  exitCode?: number;
  startTime?: number;        // Unix ms
  endTime?: number;          // Unix ms
}
```

---

## Generated Tutorial Structure

The extension generates these files in the tutorial directory:

```
my-tutorial/
├── README.md                  # Project details, based-on commit, update history
├── chapters.json              # Chapter index + config for drift detection
├── package.json               # Vite + React/Vue/Svelte/HTML
├── src/
│   ├── App.tsx                # Main app with navigation
│   ├── chapters/
│   │   ├── ChapterArchitecture.tsx
│   │   ├── ChapterModules.tsx
│   │   └── ...
│   └── main.tsx
└── index.html
```

---

## Module Reference

### Entry Point (`index.ts`)

| Function | Purpose |
|----------|---------|
| `createTutorialExtension` | Default export — registers all commands, tools, and shutdown handler |

### Commands (`commands/`)

| Function | File | Purpose |
|----------|------|---------|
| `registerTutorialCreateCommand` | `create.ts` | `/tutorial:create` handler |
| `registerTutorialDeepDiveCommand` | `deep-dive.ts` | `/tutorial:deep-dive` with arg parsing + parallel orchestrator |
| `registerTutorialUpdateCommand` | `update.ts` | `/tutorial:update` drift detection + update prompt |

### Tools (`tools/`)

| Function | File | Purpose |
|----------|------|---------|
| `registerConfigureTutorialTool` | `configure.ts` | `configure_tutorial` tool |
| `registerCheckTutorialDriftTool` | `check-drift.ts` | `check_tutorial_drift` tool |

### Prompts (`prompts/`)

| Function | File | Purpose |
|----------|------|---------|
| `buildTutorialPrompt` | `tutorial-create.ts` | Pass 1 skeleton creation prompt |
| `gatherRequirementsAndPrompt` | `tutorial-create.ts` | Quick/interactive mode dispatch |
| `buildDeepDivePrompt` | `deep-dive.ts` | Inline Pass 2 expansion prompt |
| `buildAnalysisPrompt` | `analysis.ts` | Phase 1 codebase analysis prompt |
| `buildWorkerTaskPrompt` | `worker.ts` | Per-chapter fork worker task prompt |

### Utilities (`utils/`)

| Function | File | Purpose |
|----------|------|---------|
| `getGitCommit` | `git.ts` | Get HEAD commit hash |
| `getGitChanges` | `git.ts` | Diff files between base commit and HEAD |
| `parseReadme` | `readme.ts` | Extract commit/source from README.md |
| `updateReadmeCommit` | `readme.ts` | Update "Based On Commit" in README |
| `addReadmeUpdateEntry` | `readme.ts` | Append row to Update History table |
| `loadChaptersIndex` | `chapters.ts` | Read `chapters.json` |
| `saveChaptersIndex` | `chapters.ts` | Write `chapters.json` |
| `checkTmuxAvailable` | `tmux.ts` | Check `which tmux` on PATH |
| `sanitizeTmuxName` | `tmux.ts` | Clean names for tmux session/window |
| `expandTildePath` | `paths.ts` | Expand `~` to home directory |
| `inferProjectName` | `paths.ts` | Derive project name from path |
| `globToRegex` | `paths.ts` | Convert glob pattern to RegExp |

### Core Modules

| Function | File | Purpose |
|----------|------|---------|
| `detectDriftViaGit` | `drift.ts` | Cross-reference git changes against chapters (supports globs) |
| `createTutorialTodos` | `todos.ts` | Create todo items (`.pi/todos/` or fallback `TODO.md`) |
| `generateTodoItems` | `todos.ts` | Build task list from tutorial config |

---

## Dependencies

| Import | Usage |
|--------|-------|
| `@mariozechner/pi-coding-agent` | Extension API types (`ExtensionAPI`, `ExtensionContext`) |
| `@sinclair/typebox` | Runtime type schemas for tool parameters |
| `node:fs` | `existsSync`, `readFileSync`, `writeFileSync` |
| `node:fs/promises` | `mkdir`, `mkdtemp`, `writeFile` |
| `node:child_process` | `execSync` — git commands, tmux operations |
| `node:path` | Path manipulation |
| `node:crypto` | Todo ID generation |
| `node:os` | `os.tmpdir()` for temp directory |
| `tmux` (external) | Parallel deep-dive sessions (optional) |
| `pi` CLI (external) | Subprocess workers via `pi --fork ... --no-session` |

---

## Commit History

| Commit | Description |
|--------|-------------|
| `bae6609` | Initial deep-dive command for tutorial expansion |
| `ecb5bc7` | Tmux-based parallel deep-dive for multi-chapter expansion |
| `e3fd591` | Fix: deduplicate changed files in `detectDriftViaGit` |
| `8ef74e0` | Refactor: deduplicate quick-mode prompt via `buildTutorialPrompt` |
| `1182543` | Cleanup: remove redundant `readFileSync`/`writeFileSync` polyfills |
| `1ab480a` | Fix: rewrite `addReadmeUpdateEntry` separator-tracking logic |
| — | Refactor: split monolithic `tutorial.ts` into 19-file modular architecture |
