# Tutorial Extension (`tutorial.ts`)

A pi extension for creating, expanding, and maintaining interactive codebase tutorials.
Uses a two-pass workflow: **Pass 1** generates a skeleton, **Pass 2** deep-dives into detailed content.

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

**Code:** `registerTutorialCreateCommand()` (line 337)

---

### `/tutorial:deep-dive <tutorial-dir> [chapter-id] [--concurrency N]`

Expands skeleton chapters with **detailed analysis** (Pass 2).

**Argument parsing:**
```
/tutorial:deep-dive ./my-tutorial                          # All chapters, concurrency 4
/tutorial:deep-dive ./my-tutorial architecture             # Single chapter (inline)
/tutorial:deep-dive ./my-tutorial --concurrency 2          # All chapters, 2 parallel
/tutorial:deep-dive ./my-tutorial --concurrency=8          # All chapters, 8 parallel
```

#### Execution Modes

| Condition | Mode | Behavior |
|-----------|------|----------|
| Single chapter | **Inline** | Sends `buildDeepDivePrompt()` to current pi session |
| No tmux available | **Inline** | Same as single chapter |
| Multi-chapter + tmux | **Parallel** | Spawns worker pool in tmux session |

**Code:** `registerTutorialDeepDiveCommand()` (line 356)

---

### `/tutorial:update <tutorial-dir> [source-code-dir] [base-commit]`

Detects **drift** between the tutorial's baseline commit and current source HEAD, then updates outdated chapters.

**Drift detection:**
1. Reads "Based On Commit" from `README.md`
2. Runs `git diff --name-status <base>..HEAD` on source codebase
3. Cross-references changed files against `chapters.json` chapter → source file mappings
4. Reports which chapters are outdated and which are up-to-date

**Code:** `registerTutorialUpdateCommand()` (line 854)

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

**Code:** `registerConfigureTutorialTool()` (line 1103)

### `check_tutorial_drift`

Detects which chapters are outdated by comparing README.md baseline against current git HEAD.

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tutorialDir` | string | ✓ | Tutorial directory with README.md + chapters.json |
| `sourceDir` | string | ✗ | Override source dir (else from README) |
| `baseCommit` | string | ✗ | Override baseline commit (else from README) |

**Code:** `registerCheckTutorialDriftTool()` (line 1221)

---

## Parallel Deep-Dive Architecture

When multiple chapters need expansion and tmux is available, the deep-dive command uses a **worker pool** pattern to process chapters concurrently.

### Overview

```
┌─────────────────────────────────────────────────────┐
│  Parent pi session (your terminal)                  │
│                                                     │
│  /tutorial:deep-dive ./my-tutorial                  │
│       │                                             │
│       ▼                                             │
│  runParallelDeepDive()                              │
│       │                                             │
│       ├── creates tmux session "tdd-my-tutorial"    │
│       ├── writes prompt files to /tmp/tdd-XXXXXX/   │
│       ├── writes wrapper scripts per chapter        │
│       │                                             │
│       ├── Worker 1 ──► tmux window "ch01-arch"     │
│       ├── Worker 2 ──► tmux window "ch02-modules"  │
│       ├── Worker 3 ──► tmux window "ch03-dataflow" │
│       └── Worker 4 ──► tmux window "ch04-patterns" │
│                                                     │
│       polls status-<id> files every 2s              │
│       updates TUI widget with progress              │
│       sends final summary when all complete         │
└─────────────────────────────────────────────────────┘
```

### Worker Lifecycle

```
1. Worker picks next queued chapter (nextIndex++)
2. Mark chapter status → "running"
3. tmux new-window → runs wrapper script:
     #!/bin/bash
     cd '<cwd>'
     pi -p --no-session --append-system-prompt '<prompt-file>' "task message"
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
| `prompt-<chapter-id>.md` | System prompt + task for this chapter |
| `run-<chapter-id>.sh` | Bash wrapper: cd, run pi, write exit code |
| `status-<chapter-id>` | Exit code written on completion (polled by parent) |

### TUI Progress Widget

Displayed via `ctx.ui.setWidget("tutorial-deep-dive", lines)`:

```
─── Deep Dive Progress ──────────────────
  ⏳ architecture        Architecture Overview
  ⏳ key-modules         Key Modules (12s)
  ·  data-flow           Data Flow Patterns
  ·  ts-patterns         TypeScript Patterns
─────────────────────────────────────────
  0/4 done  2 running  2 queued  0 failed
  tmux attach -t tdd-my-tutorial
```

Icons: ✓ done, ✗ failed, ⏳ running, · queued

### Cleanup & Error Handling

| Event | Behavior |
|-------|----------|
| `session_shutdown` | Kills active tmux session, clears `activeDeepDiveSession` |
| tmux not available | Falls back to inline mode (single prompt) |
| tmux session creation fails | Falls back to inline mode with warning |
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

## File Structure Reference

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

## Key Functions

| Function | Line | Purpose |
|----------|------|---------|
| `registerTutorialCreateCommand` | 337 | `/tutorial:create` handler |
| `registerTutorialDeepDiveCommand` | 356 | `/tutorial:deep-dive` handler with arg parsing |
| `checkTmuxAvailable` | 509 | Checks `which tmux` on PATH |
| `sanitizeTmuxName` | 518 | Cleans names for tmux session/window |
| `buildPerChapterSystemPrompt` | 522 | System prompt for parallel workers |
| `buildPerChapterTask` | 605 | Chapter-specific task text |
| `runParallelDeepDive` | 631 | Worker pool orchestrator |
| `registerTutorialUpdateCommand` | 854 | `/tutorial:update` handler |
| `detectDriftViaGit` | 963 | Cross-reference git changes against chapters |
| `registerConfigureTutorialTool` | 1103 | `configure_tutorial` tool |
| `registerCheckTutorialDriftTool` | 1221 | `check_tutorial_drift` tool |
| `buildTutorialPrompt` | 1464 | Pass 1 skeleton creation prompt |
| `buildDeepDivePrompt` | 1608 | Inline Pass 2 expansion prompt |
| `createTutorialTodos` | 1806 | Creates todo items for tracking |
| `generateTodoItems` | 1856 | Generates task list from config |
| `parseReadme` | 224 | Extracts commit/source from README.md |
| `addReadmeUpdateEntry` | 259 | Appends row to Update History table |
| `loadChaptersIndex` / `saveChaptersIndex` | 304 / 312 | JSON read/write for chapters.json |

---

## Dependencies

| Import | Usage |
|--------|-------|
| `@earendil-works/pi-coding-agent` | Extension API types (`ExtensionAPI`, `ExtensionContext`) |
| `typebox` | Runtime type schemas for tool parameters |
| `node:fs` | `existsSync`, `readFileSync`, `writeFileSync` |
| `node:fs/promises` | `mkdir`, `mkdtemp`, `writeFile` |
| `node:child_process` | `execSync` — git commands, tmux operations |
| `node:path` | Path manipulation |
| `node:crypto` | Todo ID generation |
| `node:os` | `os.tmpdir()` for temp directory |
| `tmux` (external) | Parallel deep-dive sessions (optional) |
| `pi` CLI (external) | Subprocess workers via `pi -p --no-session` |

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
