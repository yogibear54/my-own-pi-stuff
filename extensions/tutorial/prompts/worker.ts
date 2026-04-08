/**
 * Worker Task Prompt Builder
 *
 * Generates the task prompt for forked chapter workers.
 * Workers inherit the full analysis session context via --fork, so this
 * prompt only needs the chapter-specific instructions and writing guidelines.
 */

import type { ChapterEntry, TutorialConfig } from "../types.js";

export function buildWorkerTaskPrompt(
	tutorialDir: string,
	sourceDir: string,
	chapter: ChapterEntry,
	config: TutorialConfig | undefined,
): string {
	const audience = config?.audience || "Developers familiar with the language but new to this codebase";
	const scope = config?.scope || "detailed";
	const includeQuizzes = config?.includeQuizzes ?? true;
	const includeDiagrams = config?.includeDiagrams ?? true;
	const techStack = config?.techStack || "react";

	const lines: string[] = [
		"Using the codebase analysis from the conversation above, expand the skeleton tutorial chapter with detailed content.",
		"",
		"## Your Task",
		"",
		"Expand the skeleton chapter **\"" + chapter.title + "\"** (id: `" + chapter.id + "`).",
		"",
		"**Tutorial Directory**: " + tutorialDir,
		"**Source Codebase**: " + sourceDir,
		"**Source files for this chapter**: " + chapter.sourceFiles.map(f => "`" + f + "`").join(", "),
	];

	if (chapter.chapterFile) {
		lines.push("**Chapter component to update**: `" + tutorialDir + "/" + chapter.chapterFile + "`");
	}

	lines.push(
		"",
		"## Instructions",
		"",
		"1. Review the codebase in the Tutorial Directory",
		"2. Perform a " + scope + " review of the Source files for this chapter, developing a deep understanding of the code",
		"3. Review the Chapter components to update",
		"4. Now, expand on the files in (3) based on the " + scope + " review in (2) - the target audience is [" + audience + "]",
		"",
		"## Content Requirements",
		"",
		"- **Detailed code walkthroughs**: Show key code snippets with line-by-line explanations using prism-react-renderer (vsLight theme)",
		"- **Pattern explanations**: Explain not just WHAT but WHY — design decisions, trade-offs, alternatives considered",
		"- **Data flow analysis**: How data moves through the module with concrete examples",
		"- **Cross-references**: Link to related chapters where relevant",
	);

	if (includeQuizzes) {
		lines.push("- **Quizzes**: Multiple-choice knowledge-check questions testing deep understanding, with explanations for each answer");
	} else {
		lines.push("- **Key takeaways**: Summary of the most important concepts");
	}

	if (includeDiagrams) {
		lines.push("- **Diagrams**: SVG diagrams showing architecture, data flow, or component relationships");
	} else {
		lines.push("- **Text-based descriptions**: Clear structured descriptions of architecture and flow");
	}

	lines.push(
		"- **Progressive complexity**: Start with simple concepts, build to advanced topics",
		"- Remove the \"🔍 This chapter will be expanded...\" placeholder note",
		"",
		"## Quality Guidelines",
		"",
		"- Every code snippet should have context and explanation — never show raw code without commentary",
		"- Explain the \"why\" behind design decisions, not just the \"what\"",
		"- Use analogies where helpful for the target audience (" + audience + ")",
		"- Progressive complexity: start simple, add depth gradually",
		"- Each chapter should read like a well-written technical blog post",
		"- Code snippets: prism-react-renderer with vsLight theme",
		"- Body text: Noto Sans font, Code: Source Code Pro font",
	);

	if (techStack === "react") {
		lines.push("- Use prism-react-renderer's <Highlight> component or a shared <CodeBlock> wrapper for code snippets");
	}

	return lines.join("\n");
}
