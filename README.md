# My Pi Extensions & Skills

This is my personal [Pi coding agent](https://pi.dev) configuration — extensions, skills, packages, and settings that I use day-to-day.

> **tl;dr** — Most of the good stuff here originated from [Armin's agent-stuff](https://github.com/mitsuhiko/agent-stuff) or [Mario's pi-mono / pi-skills](https://github.com/badlogic/pi-mono). I've adapted some of Armin's Mac-specific bits for Linux and written a handful of things myself. Pi modifying Pi is remarkably effective.

---

## Extensions

Extensions live in `extensions/`. They're TypeScript files (or directories with an `index.ts`) that register commands and tools into the Pi agent session.

### Commands & Tools

| Extension | Type | Description |
|---|---|---|
| **answer** | Command (`/answer`) | Extracts questions from the last assistant response and presents an interactive TUI to navigate and answer them |
| **balance-sheet** | Command + Tool (`/balance-sheet`, `balance_sheet` tool) | Extracts accounting PDFs via the pdf-extractor skill and generates structured balance sheets |
| **btw** | Session hook | Enriches the system prompt with contextual project/session information |
| **code-nav** | Tools | Symbol-level source code navigation (go-to-definition, find-references, symbol listing) powered by Tree-sitter with a persistent SQLite index |
| **context** | Command (`/context`) | TUI dashboard showing loaded extensions, skills, project context files, and context window usage (tokens/cost) |
| **files** | Command (`/files`, `/diff`) | File picker for the current git tree + session-referenced files, with quick actions (reveal, open, edit, diff) |
| **loop** | Command (`/loop`) | Starts a follow-up loop that keeps sending a prompt on turn end until a breakout condition is met |
| **multi-edit** | Tool (replaces built-in `edit`) | Enhanced file editing supporting `multi` (array of edits) and `patch` (Codex-style `apply_patch`) payloads |
| **notify** | Hook | Sends a native desktop notification (via `notify-send` / D-Bus) when the agent finishes and is waiting for input |
| **questionnaire** | Tool | Unified tool for asking the user single or multiple questions with interactive tab-based navigation |
| **quick-review** | Command (`/quick-review`) | *(mine)* Code review for bugs, security issues, and error handling gaps with optional model switching |
| **review** | Command (`/review`) | Full code review extension supporting GitHub PRs, branch diffs, uncommitted changes, and specific commits |
| **split-fork** | Tool | Opens a new terminal split/pane (Ghostty, tmux) running a separate Pi session |
| **stream-output** | Flag (`--stream`) | Streams thinking, text, and tool content to stderr with formatted prefixes for programmatic consumption |
| **system-manager** | Command (`/system`) | Enable/disable skills, extensions, utils, and root config files via symlink management between `agent-git/` and `agent/` |
| **todos** | Tool + Command (`/todos`) | File-based todo management (`.pi/todos/`) with lock-based concurrency for multi-session use |
| **tools** | Command (`/tools`) | Interactive tool selector to enable/disable tools with persistence across sessions |
| **tutorial** | Commands (`/tutorial:create`, `/tutorial:deep-dive`, etc.) | Creates and manages interactive codebase tutorials with multi-pass generation |
| **whimsical** | Hook | Replaces the standard "Thinking…" indicator with random whimsical messages |

---

## Skills

Skills live in `skills/`. Each is a `SKILL.md` file (with optional supporting scripts) that provides specialized instructions the agent loads when relevant.

| Skill | Description |
|---|---|
| **brave-search** | Web search and content extraction via the Brave Search API. Lightweight, no browser required |
| **frontend-design** | Design and implement distinctive, production-ready frontend interfaces with strong aesthetic direction |
| **pdf-extractor** | Extract and analyze content from PDF files using vision AI — supports full text, structured, markdown, HTML, and custom prompt modes |
| **web-browser** | Remote-control Chrome/Chromium via CDP for interactive web browsing (navigate, screenshot, evaluate JS, pick elements, dismiss cookies) |
| **web-search** | Web search via DuckDuckGo (primary) and Brave Search (fallback) using the web-browser skill |

---

## Packages

| Package | Description |
|---|---|
| **pi-diff-review** ([GitHub](https://github.com/yogibear54/pi-diff-review)) | Native diff review window for Pi, powered by Glimpse + Monaco — adds `/diff-review` with git diff, last commit, and all-files scopes, collapsible sidebar, lazy loading, and inline commenting |

---

## Utilities

| File | Description |
|---|---|
| **utils/config-utils.ts** | Shared utilities for loading/saving JSON config files with project-level precedence and global fallback |

---

## Configuration

| File | Purpose |
|---|---|
| `settings.json` | Pi agent settings — default provider/model, enabled models, thinking level, packages |
| `models.json` | Custom provider and model definitions (API endpoints, pricing, context windows) |
| `auth.json` | API keys (git-ignored) |
| `AGENTS.md` | Behavioral guidelines for the coding agent |

---

## Default Setup

I'm currently running:
- **Provider:** `zai` / **Model:** `glm-5.1`
- **Thinking level:** high
- **Other enabled models:** DeepSeek V4 Flash/Pro, Kimi K2.5/K2.6, MiniMax M2.7, Qwen 3.5+/3.6+, GLM variants, Mimo V2/V2.5
