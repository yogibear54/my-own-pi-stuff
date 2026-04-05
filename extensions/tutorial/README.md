# Tutorial Extension

Create, manage, and update codebase tutorials with interactive learning experiences. This extension provides commands and tools to generate tutorial skeletons, perform deep-dive analysis, detect code drift, and keep tutorials up-to-date.

---

## 🚀 Quick Start

### Available Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `/tutorial:create` | Create a skeleton tutorial (Pass 1) | `/tutorial:create <tutorial-dir> [source-code-dir]` |
| `/tutorial:deep-dive` | Expand skeleton with detailed analysis | `/tutorial:deep-dive <tutorial-dir> [chapter-id]` |
| `/tutorial:update` | Detect drift and update outdated chapters | `/tutorial:update <tutorial-dir> [source-code-dir] [base-commit]` |

### Available Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `configure_tutorial` | Gather tutorial requirements | `tutorialDir`, `sourceDir`, `projectName`, `audience`, `goals`, `scope`, `includeQuizzes`, `includeDiagrams`, `techStack` |
| `check_tutorial_drift` | Check for chapter drift | `tutorialDir`, `sourceDir`, `baseCommit` |

---

## 📖 Commands

### `/tutorial:create`

Creates a skeleton tutorial for a codebase. This is Pass 1 of the tutorial creation process.

**Quick Mode:**
```bash
/tutorial:create my-tutorial
/tutorial:create my-tutorial /path/to/source-code
```

**Interactive Mode:**
```bash
/tutorial:create
```
Follow the prompts to specify:
- Tutorial directory path
- Source code directory (optional, defaults to current)
- Target audience
- Learning goals
- Tutorial scope (overview/detailed/comprehensive)
- Include quizzes
- Include diagrams
- Tech stack (react/vue/svelte/html/markdown)

**What it creates:**
1. Tutorial project structure:
   - **HTML**: Vite + React + TypeScript + prism-react-renderer
   - **Markdown**: Markdown files with INDEX.md containing auto-generated table of contents
2. SKELETON chapters with:
   - Title and 1-2 paragraph overview
   - "Files Covered" section (for HTML)
   - For Markdown: links to related files
3. `chapters.json` file mapping chapters to source files
4. `README.md` with project details and update history
5. `TODO.md` to track creation progress

**Example Output:**
```
Tutorial configuration complete. Now analyze the codebase and create a SKELETON tutorial (Pass 1).

Configuration:
- Target: my-tutorial
- Source: /path/to/source-code
- Project: MyProject
- Audience: JavaScript developers new to TypeScript
- Scope: detailed
- Quizzes: Yes
- Diagrams: Yes
- Tech Stack: react
```

---

### `/tutorial:deep-dive`

Performs deep code analysis to expand skeleton tutorials with rich, detailed content. This is Pass 2.

**Expand all chapters:**
```bash
/tutorial:deep-dive my-tutorial
```

**Expand a specific chapter:**
```bash
/tutorial:deep-dive my-tutorial architecture-overview
```

**What it does:**
1. Analyzes source files deeply for each chapter
2. Generates code walkthroughs with explanations
3. Adds quizzes with explanations
4. Creates diagrams (if enabled)
5. Removes skeleton placeholders
6. Updates `chapters.json` if new files are discovered

**Content added in Pass 2:**
- ✅ Detailed code walkthroughs (line-by-line explanations)
- ✅ Pattern explanations (WHY not just WHAT)
- ✅ Data flow analysis with concrete examples
- ✅ Cross-references to related chapters
- ✅ Multiple-choice quizzes with explanations
- ✅ Diagrams: SVG for React/Vue/Svelte, Mermaid for Markdown
- ✅ Key takeaways summary
- ✅ Progressive complexity (simple → advanced)

---

### `/tutorial:update`

Detects changes in the source codebase and identifies which tutorial chapters are outdated.

```bash
/tutorial:update my-tutorial
/tutorial:update my-tutorial /path/to/source-code
/tutorial:update my-tutorial /path/to/source-code abc123def456
```

**What it detects:**
1. Modified, deleted, or new files since baseline commit
2. Which chapters reference those files
3. Whether chapters are up-to-date or need regeneration

**Output:**
```
**3 file(s)** changed since baseline.

Based on commit: `def456abc123`
Current commit: `987654def321`

Changed files:
  - [M] src/utils.ts (modified)
  - [A] src/api/client.ts (new)
  - [D] src/api/errors.ts (deleted)

### Outdated Chapters (1)

**Data Flow** (data-flow)
  Changed files:
  - `src/api/client.ts` (new)

### Up-to-date Chapters (2)

- **Architecture Overview** (architecture-overview) ✓
- **Key Modules** (key-modules) ✓

### Instructions

Please update the outdated chapters in "my-tutorial" based on the current source files.
Only regenerate the chapters listed above. Preserve any manual edits in up-to-date chapters.
```

**After detecting drift, update the chapters:**
```bash
/tutorial:update my-tutorial
```
The tool will then provide specific instructions for updating each outdated chapter.

---

## 🛠️ Tools

### `configure_tutorial`

Tool for structured tutorial configuration gathering. Call this after you've collected requirements from the user.

**Parameters:**
| Parameter | Type | Required | Default |
|-----------|------|----------|---------|
| `tutorialDir` | string | ✅ | - |
| `sourceDir` | string | ❌ | current working directory |
| `projectName` | string | ❌ | inferred from tutorialDir |
| `audience` | string | ❌ | "Developers familiar with JavaScript but new to TypeScript" |
| `goals` | string[] | ❌ | ["Navigate the codebase", "Understand architecture patterns"] |
| `scope` | string | ❌ | "detailed" |
| `includeQuizzes` | boolean | ❌ | true |
| `includeDiagrams` | boolean | ❌ | true |
| `techStack` | string | ❌ | "react" |

**Example:**
```typescript
configure_tutorial({
  tutorialDir: "my-tutorial",
  sourceDir: "/path/to/source-code",
  projectName: "MyProject",
  audience: "Frontend developers",
  goals: ["Understand React patterns", "Learn TypeScript", "Build real apps"],
  scope: "comprehensive",
  includeQuizzes: true,
  includeDiagrams: true,
  techStack: "markdown"
})
```

### `check_tutorial_drift`

Tool to detect which chapters are outdated by comparing git commits.

**Parameters:**
| Parameter | Type | Required | Default |
|-----------|------|----------|---------|
| `tutorialDir` | string | ✅ | - |
| `sourceDir` | string | ❌ | from README.md |
| `baseCommit` | string | ❌ | from README.md |

**Returns:**
- File changes since baseline
- Outdated chapters (with changed files)
- Up-to-date chapters
- Recommendations for updates

**Example:**
```typescript
check_tutorial_drift({
  tutorialDir: "my-tutorial",
  sourceDir: "/path/to/source-code",
  baseCommit: "abc123def456"
})
```

---

## 📁 Tutorial Structure

### Generated Files

```
my-tutorial/
├── src/
│   ├── App.tsx                      # Tutorial app
│   ├── chapters/
│   │   ├── Chapter1.tsx            # Chapter components
│   │   ├── Chapter2.tsx
│   │   └── ...
│   └── ...
├── chapters.json                    # Chapters index (auto-generated)
├── README.md                        # Tutorial overview (auto-generated)
├── TODO.md                          # Creation progress tracker (auto-generated)
└── package.json                     # Tutorial project
```

### chapters.json Format

```json
{
  "version": 1,
  "updatedAt": "2024-04-05T20:00:00.000Z",
  "config": {
    "tutorialDir": "my-tutorial",
    "sourceDir": "/path/to/source-code",
    "projectName": "MyProject",
    "audience": "JavaScript developers",
    "goals": ["Navigate the codebase", "Learn TypeScript"],
    "scope": "detailed",
    "includeQuizzes": true,
    "includeDiagrams": true,
    "techStack": "react"
  },
  "chapters": [
    {
      "id": "architecture-overview",
      "title": "Architecture Overview",
      "sourceFiles": ["src/App.tsx", "src/components/Button.tsx"],
      "chapterFile": "src/chapters/Chapter1.tsx"
    }
  ]
}
```

### README.md Format

```markdown
# MyProject - Tutorial

## Project Details

| Property | Value |
|----------|-------|
| **Source Project** | MyProject |
| **Source Location** | `/path/to/source-code` |
| **Based On Commit** | `abc123def456` |
| **Status** | 🏗️ Skeleton (Pass 1) — use `/tutorial:deep-dive` to expand |

---

## Table of Contents

<!-- AUTO-GENERATED: Chapters will be listed here -->

---

## Update History

| Date | Version | Update Details |
|------|---------|----------------|
| 2024-04-05 | 0.1.0 | Skeleton tutorial created (Pass 1) |

---

*This README is automatically generated. For interactive tutorial experience, run the tutorial app.*
```

---

## 🎨 Tech Stack Options

The extension supports these tutorial formats:

| Stack | Description | Template |
|-------|-------------|----------|
| **react** | Vite + React + TypeScript | Most popular choice |
| **vue** | Vite + Vue + TypeScript | Great for Vue developers |
| **svelte** | Vite + Svelte | Modern, lightweight |
| **html** | Static HTML + Prism.js | Simple, no build tool |
| **markdown** | Vite + Markdown + Auto-generated TOC | Text-based, TOC connects all chapters |


### Pass 1: Skeleton Creation

```
1. Run /tutorial:create my-tutorial
   ↓
2. Explore source codebase
   ↓
3. Generate SKELETON chapters (minimal content)
   ↓
4. Create chapters.json with file mappings
   ↓
5. Create README.md
   ↓
6. Run /tutorial:deep-dive my-tutorial
```

### Markdown Tutorials

When using the **markdown** tech stack:

- An `INDEX.md` file is created with an auto-generated table of contents
- Each chapter is a separate `.md` file (e.g., `Chapter1.md`, `Chapter2.md`)
- The TOC in `INDEX.md` links to all chapter files
- Chapters use relative links to navigate between them
- No build step required - open directly in a browser
- **Mermaid.js diagrams** for architecture, data flow, and component relationships
- Mermaid supports flowcharts, sequence diagrams, class diagrams, Gantt charts, and more
- All diagrams are embedded as code blocks and rendered automatically by supported markdown viewers
- **Multiple-choice quizzes** using simple checkbox format:
  ```markdown
  **Question**: What is the purpose of TypeScript interfaces?
  
  **Select your answer**:
  - [ ] A. To add compile-time type checking to JavaScript
  - [ ] B. To create database connections
  - [ ] C. To execute database queries
  
  **Correct Answer**: A. TypeScript interfaces define the structure of objects and provide compile-time type safety.
  ```
- **Multiple-answer questions** (for select all that apply):
  ```markdown
  **Question**: Which of the following are valid TypeScript types? (Select all that apply)
  
  - [ ] number
  - [ ] string
  - [ ] database
  - [ ] function
  
  **Correct Answers**: number, string, function
  ```
- Lightweight and easy to edit directly in markdown files

### Pass 2: Deep-Dive Expansion

```
1. Run /tutorial:deep-dive my-tutorial
   ↓
2. Read source files for each chapter
   ↓
3. Analyze design patterns, data flow, abstractions
   ↓
4. Generate detailed code walkthroughs
   ↓
5. Create quizzes with explanations
   ↓
6. Add diagrams (if enabled)
   ↓
7. Update chapters.json if needed
   ↓
8. Mark tutorial as complete (version 1.0.0)
```

### Maintenance: Drift Detection

```
1. Source code changes are made
   ↓
2. Run /tutorial:update my-tutorial
   ↓
3. Check which chapters are outdated
   ↓
4. Regenerate only outdated chapters
   ↓
5. Update chapters.json
   ↓
6. Update README.md with new commit hash
```

---

## 🎯 Best Practices

### For Tutorial Authors

1. **Keep chapters focused** - Each chapter should cover one clear topic
2. **Use progressive complexity** - Start simple, build to advanced
3. **Explain the WHY** - Not just what the code does, but why it's designed that way
4. **Provide context** - Every code snippet should have context
5. **Add quizzes** - Help learners test understanding
6. **Include diagrams** - Visuals aid understanding of architecture
7. **Cross-reference chapters** - Link related topics

### For Maintainers

1. **Run /tutorial:update regularly** - Keep tutorials in sync with code
2. **Update chapters.json** - Add new source files when they're relevant
3. **Version your tutorials** - Track changes in Update History
4. **Test after updates** - Verify tutorials still build and run
5. **Backup before major changes** - Especially when updating README.md

---

## 🔧 Architecture

### Module Structure

```
tutorial/
├── types.ts          # All TypeScript interfaces
├── constants.ts      # Exported constants
├── index.ts          # Extension registration
├── config/           # Tutorial configuration & prompts
├── git-detection/    # Git operations & README parsing
├── chapters/         # Chapters index & drift detection
├── commands/         # Command handlers
├── tools/            # Registered tools
└── todos/            # Todo file management
```

### Domain Breakdown

- **config** - Tutorial configuration, prompt generation, project name inference
- **git-detection** - Git commit detection, change tracking, README parsing
- **chapters** - Chapters index file management, drift detection
- **commands** - Command handlers for /tutorial:create, /tutorial:deep-dive, /tutorial:update
- **tools** - Registered tools (configure_tutorial, check_tutorial_drift)
- **todos** - Todo file creation and markdown formatting

---

## 📚 Example: Creating a React Tutorial

```bash
# Step 1: Create skeleton
/tutorial:create react-tutorial /path/to/react-app

# Step 2: Deep-dive into chapters
/tutorial:deep-dive react-tutorial

# Step 3: Later, detect drift after code changes
/tutorial:update react-tutorial

# Step 4: Update outdated chapters
# Follow the instructions from /tutorial:update

# Step 5: Update commit hash in README.md
/tutorial:update react-tutorial
```

---

## 🤝 Contributing

To add new features:

1. **Add a command**: Create in `commands/` folder
2. **Add a tool**: Create in `tools/` folder
3. **Add a type**: Add to `types.ts`
4. **Update imports**: Import from appropriate module
5. **Register**: Add to `index.ts` if needed

---

## 📝 License

Same as pi-coding-agent extension.

---

## 🔗 Related Resources

- [pi-coding-agent Documentation](https://github.com/mariozechner/pi-coding-agent)
- [Vite Documentation](https://vitejs.dev/)
- [Prism.js Documentation](https://prismjs.com/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)

---

**Created with ❤️ for better code documentation**