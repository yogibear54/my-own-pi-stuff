/**
 * Tutorial Creation Prompt Builder
 *
 * Generates the LLM prompt for Pass 1 (skeleton tutorial creation)
 * and the requirements-gathering helper.
 */

import { CHAPTERS_FILENAME } from "../constants.js";
import { inferProjectName } from "../utils/paths.js";
import type { TutorialConfig } from "../types.js";

/**
 * Build the full prompt that instructs the LLM to create a skeleton tutorial.
 */
export function buildTutorialPrompt(config: TutorialConfig): string {
	return `Create a SKELETON tutorial (Pass 1 of 2) for the codebase at "${config.sourceDir}".

The tutorial should be created in "${config.tutorialDir}".

This is a SURFACE ANALYSIS pass. Produce a working tutorial app with minimal chapter content.
The chapters will be expanded with detailed analysis in Pass 2 via \`/tutorial:deep-dive\`.

## Configuration

- **Project Name**: ${config.projectName}
- **Target Audience**: ${config.audience}
- **Learning Goals**: ${config.goals.join(", ")}
- **Scope**: ${config.scope}
- **Include Quizzes**: ${config.includeQuizzes ? "Yes (in Pass 2)" : "No"}
- **Include Diagrams**: ${config.includeDiagrams ? "Yes (in Pass 2)" : "No"}
- **Tech Stack**: ${config.techStack}

## Requirements

### 1. Project Structure

Create a ${config.techStack === "react" ? "Vite + React + TypeScript" : config.techStack === "vue" ? "Vite + Vue + TypeScript" : config.techStack === "svelte" ? "Vite + Svelte" : "static HTML"} tutorial app with:
- Clean navigation (sidebar with chapter list)
- Progress tracking (use localStorage)
- Responsive design (mobile-friendly sidebar toggle)
- Syntax-highlighted code blocks (using prism-react-renderer with vsLight theme)
- Google Fonts: Noto Sans for body text, Source Code Pro for code blocks

### 2. Surface Analysis

Explore the source codebase and create SKELETON chapters covering:
- **Architecture Overview**: High-level structure, directory tree, main modules
- **Key Modules**: Brief description of what each module does
- **Data Flow**: Surface-level description of how data moves
- **TypeScript Patterns**: Note key types and interfaces (no deep analysis yet)
- **Configuration & Entry Points**: List entry points and config files
${config.scope === "comprehensive" ? "- **All Files**: Brief mention of every production file" : ""}

### 3. Skeleton Chapter Structure

Each chapter should include:
- Clear title and 1-2 paragraph overview
- "Files Covered" section listing the relevant source files with paths
- A placeholder note: "🔍 This chapter will be expanded with detailed analysis via deep-dive."
- Navigation to next/previous chapter
- DO NOT include: detailed code walkthroughs, quizzes, or diagrams (those are Pass 2)

### 4. Interactive Elements (Pass 1)

- Progress tracking with completion indicators
- "Continue where you left off" functionality
- Clean sidebar navigation
${config.includeQuizzes ? "- Quiz placeholder sections (to be filled in Pass 2)" : ""}
${config.includeDiagrams ? "- Diagram placeholder sections (to be filled in Pass 2)" : ""}

### 5. Styling

- Light theme with clear visual hierarchy
- Use Google Fonts: Noto Sans for body text, Source Code Pro for code blocks
- Use prism-react-renderer for syntax highlighting with the vsLight theme
- Proper spacing and accessibility (44px touch targets)
- Hover/focus states for all interactive elements

### 6. Chapters Index

After creating all chapters, generate a \`${CHAPTERS_FILENAME}\` file with:

\`\`\`json
{
  "version": 1,
  "updatedAt": "<ISO timestamp>",
  "config": {
    "tutorialDir": "${config.tutorialDir}",
    "sourceDir": "${config.sourceDir}",
    "projectName": "${config.projectName}",
    "audience": "${config.audience}",
    "goals": ${JSON.stringify(config.goals)},
    "scope": "${config.scope}",
    "includeQuizzes": ${config.includeQuizzes},
    "includeDiagrams": ${config.includeDiagrams},
    "techStack": "${config.techStack}"
  },
  "chapters": [
    {
      "id": "<kebab-case-chapter-id>",
      "title": "<chapter title>",
      "sourceFiles": ["relative/path/file1.ts", "relative/path/file2.ts"],
      "chapterFile": "src/chapters/ChapterName.tsx"
    }
  ]
}
\`\`\`

For each chapter:
- \`sourceFiles\`: every source file referenced, relative to "${config.sourceDir}". Support glob patterns.
- \`chapterFile\`: path to the chapter component file, relative to "${config.tutorialDir}"
- This index enables \`/tutorial:deep-dive\` for chapter expansion and \`/tutorial:update\` for drift detection

### 7. Project README

Create a \`README.md\`:

\`\`\`markdown
# ${config.projectName} - Tutorial

## Project Details

| Property | Value |
|----------|-------|
| **Source Project** | ${inferProjectName(config.sourceDir)} |
| **Source Location** | \`${config.sourceDir}\` |
| **Based On Commit** | \`<git commit hash>\` |
| **Status** | 🏗️ Skeleton (Pass 1) — use \`/tutorial:deep-dive\` to expand |

---

## Table of Contents

<!-- AUTO-GENERATED: Chapters will be listed here -->

---

## Update History

| Date | Version | Update Details |
|------|---------|----------------|
| YYYY-MM-DD | 0.1.0 | Skeleton tutorial created (Pass 1) |

---

*This README is automatically generated. For interactive tutorial experience, run the tutorial app.*
\`\`\`

## Process

1. **Explore**: Analyze the source codebase at "${config.sourceDir}" — directory structure, key files, architecture pattern
2. **Scaffold**: Create the tutorial project in "${config.tutorialDir}" with full navigation and styling
3. **Write Skeletons**: Create thin chapter content with file references
4. **Generate Index**: Create \`${CHAPTERS_FILENAME}\` with config and chapter-to-files mapping
5. **Create README**: Generate \`README.md\` with project details
6. **Test**: Ensure the tutorial builds and runs

Start by exploring the source codebase at "${config.sourceDir}" and then create the skeleton tutorial in "${config.tutorialDir}".`;
}

/**
 * Send the tutorial creation prompt (used by the /tutorial:create command).
 */
export async function gatherRequirementsAndPrompt(
	pi: import("@mariozechner/pi-coding-agent").ExtensionAPI,
	_ctx: import("@mariozechner/pi-coding-agent").ExtensionContext,
	config: TutorialConfig,
	quickMode: boolean,
): Promise<void> {
	const prompt = buildTutorialPrompt(config);

	if (quickMode) {
		const header = `Create a SKELETON tutorial for the codebase (Pass 1 of 2).

**Target Directory**: ${config.tutorialDir}
**Source Codebase**: ${config.sourceDir}
**Project Name**: ${config.projectName}
`;
		pi.sendUserMessage(`${header}\n---\n\n${prompt}`);
	} else {
		pi.sendUserMessage(prompt);
	}
}
