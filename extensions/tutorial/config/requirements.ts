/**
 * Tutorial Requirements
 *
 * Functions for gathering and building tutorial prompts.
 */

import { CHAPTERS_FILENAME } from "../constants";
import type { TutorialConfig } from "../types";

/**
 * Infer project name from directory path
 */
export function inferProjectName(dir: string): string {
	const parts = dir.replace(/\/$/, "").split("/");
	const name = parts[parts.length - 1] || "project";
	// Clean up common suffixes
	return name
		.replace(/-tutorial$|-walkthrough$|-docs$/, "")
		.replace(/_tutorial$|_walkthrough$|_docs$/, "") || "project";
}

/**
 * Build the main tutorial prompt for Pass 1 (skeleton creation)
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
${config.techStack === "markdown" ? "- Diagrams will use Mermaid.js for architecture and data flow visualizations" : ""}

## Requirements

### 1. Project Structure

Create a ${
		config.techStack === "react"
			? "Vite + React + TypeScript"
			: config.techStack === "vue"
				? "Vite + Vue + TypeScript"
				: config.techStack === "svelte"
					? "Vite + Svelte"
					: config.techStack === "markdown"
						? "Markdown tutorial files with INDEX.md navigation"
						: "static HTML"
	} tutorial app with:
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
${config.includeDiagrams ? "- Diagram placeholder sections (Mermaid.js for markdown tutorials, SVGs for other stacks) (to be filled in Pass 2)" : ""}

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
 * Build the deep-dive prompt for Pass 2 (chapter expansion)
 */
export function buildDeepDivePrompt(
	tutorialDir: string,
	sourceDir: string,
	chapters: import("../types").ChapterEntry[],
	config: TutorialConfig | undefined
): string {
	const audience = config?.audience || "Developers familiar with the language but new to this codebase";
	const goals = config?.goals || ["Navigate the codebase", "Understand architecture patterns"];
	const scope = config?.scope || "detailed";
	const includeQuizzes = config?.includeQuizzes ?? true;
	const includeDiagrams = config?.includeDiagrams ?? true;
	const techStack = config?.techStack || "markdown";

	const chapterCount = chapters.length;
	const isSingle = chapterCount === 1;

	let prompt = `Perform a DEEP DIVE (Pass 2) to expand ${isSingle ? "a" : chapterCount} skeleton tutorial chapter${isSingle ? "" : "s"} with detailed analysis.

**Tutorial Directory**: ${tutorialDir}
**Source Codebase**: ${sourceDir}
**Chapters to expand**: ${chapterCount}

## Overview

A skeleton tutorial was created in Pass 1 with surface-level analysis. Your job is to expand ${isSingle ? "this chapter" : "each chapter"} with rich, detailed content by thoroughly analyzing the source code.

## Target Chapter${isSingle ? "" : "s"}

`;

	for (let i = 0; i < chapters.length; i++) {
		const ch = chapters[i];
		prompt += `### ${i + 1}. ${ch.title} (\`${ch.id}\`)\n`;
		prompt += `**Source files**: ${ch.sourceFiles.map(f => `\`${f}\``).join(", ")}\n`;
		if (ch.chapterFile) {
			prompt += `**Chapter component**: \`${ch.chapterFile}\`\n`;
		}
		prompt += "\n";
	}

	prompt += `## Instructions

For ${isSingle ? "this chapter" : "EACH chapter"} listed above, follow this process:

### Step 1: Read Source Files
Read every source file listed in the chapter's \`sourceFiles\` from "${sourceDir}". As you read, identify:
- Design patterns and their rationale
- Key abstractions and interfaces
- Data flow in and out of the module
- Error handling strategies
- Edge cases and corner cases
- Dependencies on other modules

### Step 2: Generate Analysis Questions
Based on the surface analysis in the skeleton, formulate 3-5 deeper questions:
- What patterns are used and WHY were they chosen over alternatives?
- How does this module interact with others in the broader system?
- What are the common pitfalls or edge cases a developer should know?
- What key abstractions exist and what problems do they solve?
- How would a developer extend or modify this code?

### Step 3: Expand Chapter Content
Read the current skeleton chapter component${chapters.some(ch => ch.chapterFile) ? " (paths listed above)" : " in the tutorial project"}, then replace the skeleton content with rich, detailed content:

- **Detailed code walkthroughs**: Show key code snippets with line-by-line explanations using prism-react-renderer (vsLight theme)
- **Pattern explanations**: Explain not just WHAT but WHY — design decisions, trade-offs, alternatives considered
- **Data flow analysis**: How data moves through the module with concrete examples
- **Cross-references**: Link to related chapters where relevant
${includeQuizzes ? "- **Quizzes**: Multiple-choice knowledge-check questions using simple checkbox format (Markdown-friendly). Example:\n  \n  **Question**: What is the purpose of TypeScript interfaces?\n  \n  **Select your answer**:\n  - [ ] A. To add compile-time type checking to JavaScript\n  - [ ] B. To create database connections\n  - [ ] C. To execute database queries\n  \n  **Correct Answer**: A. TypeScript interfaces define the structure of objects and provide compile-time type safety." : "- **Key takeaways**: Summary of the most important concepts"}
${includeDiagrams ? (techStack === "markdown" ? "- **Diagrams**: Mermaid.js diagrams for architecture, data flow, and component relationships (use markdown code blocks starting with ```mermaid)" : "- **Diagrams**: SVG diagrams showing architecture, data flow, or component relationships") : "- **Text-based descriptions**: Clear structured descriptions of architecture and flow"}
- **Progressive complexity**: Start with simple concepts, build to advanced topics
- Remove the "🔍 This chapter will be expanded..." placeholder note

### Step 4: Update Supporting Files
- Update \`${CHAPTERS_FILENAME}\` if you discover new source files that should be referenced in any chapter
- Ensure each chapter component renders all new content correctly
- Test that the tutorial still builds and runs

## Configuration
- **Audience**: ${audience}
- **Learning Goals**: ${goals.join(", ")}
- **Scope**: ${scope}
- **Tech Stack**: ${techStack}
${includeQuizzes ? "- **Include Quizzes**: Yes" : "- **Include Quizzes**: No"}
${includeDiagrams ? "- **Include Diagrams**: Yes" : "- **Include Diagrams**: No"}

## Quality Guidelines
- Every code snippet should have context and explanation — never show raw code without commentary
- Explain the "why" behind design decisions, not just the "what"
- Use analogies where helpful for the target audience (${audience})
- Progressive complexity: start simple, add depth gradually
- Each chapter should read like a well-written technical blog post
- Code snippets: prism-react-renderer with vsLight theme
- Body text: Noto Sans font, Code: Source Code Pro font
${techStack === "react" ? "- Use prism-react-renderer's <Highlight> component or a shared <CodeBlock> wrapper for code snippets" : ""}

## Process
1. Read the current skeleton chapter component for the first chapter
2. Read all source files referenced by that chapter
3. Analyze deeply and expand the chapter content
4. Repeat for each remaining chapter
5. Update \`${CHAPTERS_FILENAME}\` if file references changed
6. Update the README.md status from "🏗️ Skeleton" to "✅ Complete" and version to 1.0.0
7. Verify the tutorial builds and runs correctly

Start by reading the chapter components and source files for the first chapter${chapters[0] ? `: **${chapters[0].title}** (\`${chapters[0].id}\`)` : "."}.`;

	return prompt;
}