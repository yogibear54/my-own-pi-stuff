/**
 * Deep-Dive Prompt Builder
 *
 * Generates the LLM prompt for inline (non-parallel) deep-dive expansion
 * of tutorial chapters.
 */

import { CHAPTERS_FILENAME } from "../constants.js";
import type { ChapterEntry, TutorialConfig } from "../types.js";

/**
 * Build the prompt for a deep-dive expansion (inline mode).
 */
export function buildDeepDivePrompt(
	tutorialDir: string,
	sourceDir: string,
	chapters: ChapterEntry[],
	config: TutorialConfig | undefined,
): string {
	const audience = config?.audience || "Developers familiar with the language but new to this codebase";
	const goals = config?.goals || ["Navigate the codebase", "Understand architecture patterns"];
	const scope = config?.scope || "detailed";
	const includeQuizzes = config?.includeQuizzes ?? true;
	const includeDiagrams = config?.includeDiagrams ?? true;
	const techStack = config?.techStack || "react";

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
${includeQuizzes ? "- **Quizzes**: Multiple-choice knowledge-check questions testing deep understanding, with explanations for each answer" : "- **Key takeaways**: Summary of the most important concepts"}
${includeDiagrams ? "- **Diagrams**: SVG diagrams showing architecture, data flow, or component relationships" : "- **Text-based descriptions**: Clear structured descriptions of architecture and flow"}
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

Start by reading the chapter components and source files for the first chapter: **${chapters[0].title}** (\`${chapters[0].id}\`).`;

	return prompt;
}
