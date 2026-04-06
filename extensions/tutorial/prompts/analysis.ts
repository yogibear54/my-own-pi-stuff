/**
 * Analysis Prompt Builder
 *
 * Generates the Phase 1 prompt for the parallel deep-dive.
 * This prompt instructs Pi to thoroughly analyze the source codebase
 * so the analysis context can be shared with forked chapter workers.
 */

import type { ChapterEntry, TutorialConfig } from "../types.js";

export function buildAnalysisPrompt(
	tutorialDir: string,
	sourceDir: string,
	chapters: ChapterEntry[],
	config: TutorialConfig | undefined,
): string {
	// Deduplicate source files across all chapters
	const allSourceFiles = [...new Set(chapters.flatMap(ch => ch.sourceFiles))];

	const audience = config?.audience || "Developers familiar with the language but new to this codebase";
	const goals = config?.goals || ["Navigate the codebase", "Understand architecture patterns"];
	const scope = config?.scope || "detailed";

	const lines: string[] = [
		"Perform a COMPREHENSIVE ANALYSIS of the codebase for a tutorial deep-dive.",
		"",
		"## Objective",
		"",
		"Analyze the source codebase thoroughly so that tutorial chapters can be expanded with accurate, detailed content.",
		"Your analysis will be shared as context with workers that expand individual chapters.",
		"Read every file listed below and build a thorough understanding of the codebase.",
		"",
		"## Tutorial Configuration",
		"",
		"- **Tutorial Directory**: " + tutorialDir,
		"- **Source Codebase**: " + sourceDir,
		"- **Audience**: " + audience,
		"- **Learning Goals**: " + goals.join(", "),
		"- **Scope**: " + scope,
		"",
		"## Source Files to Analyze",
		"",
		"Read ALL of the following source files (unique across all chapters):",
		"",
	];

	for (const file of allSourceFiles) {
		lines.push("- `" + file + "`");
	}

	lines.push("");
	lines.push("## Chapter-to-File Mapping");
	lines.push("");
	for (const ch of chapters) {
		lines.push("**" + ch.title + "** (`" + ch.id + "`): " + ch.sourceFiles.map(f => "`" + f + "`").join(", "));
	}

	lines.push("");
	lines.push("## Analysis Instructions");
	lines.push("");
	lines.push("### Step 1: Explore Directory Structure");
	lines.push("Use `bash` to explore the directory structure of the source codebase at \"" + sourceDir + "\":");
	lines.push("- List top-level directories and their purposes");
	lines.push("- Identify the architecture pattern (clean architecture, MVC, modular, etc.)");
	lines.push("- Note entry points and configuration files");
	lines.push("");
	lines.push("### Step 2: Read All Source Files");
	lines.push("Read EVERY source file listed above from \"" + sourceDir + "\". For each file, note:");
	lines.push("- Its purpose and role in the architecture");
	lines.push("- Key patterns, abstractions, and interfaces");
	lines.push("- Dependencies and interactions with other modules");
	lines.push("- Data flow in and out");
	lines.push("- Error handling strategies");
	lines.push("- Edge cases and notable implementation details");
	lines.push("");
	lines.push("### Step 3: Read Tutorial Skeleton");
	lines.push("Read the current skeleton tutorial in \"" + tutorialDir + "\":");
	lines.push("- Explore the tutorial project structure");
	for (const ch of chapters) {
		if (ch.chapterFile) {
			lines.push("- Read chapter component: `" + ch.chapterFile + "`");
		}
	}
	lines.push("- Understand the tutorial's tech stack, navigation, and component structure");
	lines.push("");
	lines.push("### Step 4: Provide Structured Analysis");
	lines.push("After reading all files, provide a comprehensive analysis covering:");
	lines.push("");
	lines.push("1. **Architecture Overview**: High-level architecture pattern, module organization, key abstractions");
	lines.push("2. **Module Relationships**: How modules interact, dependency graph, shared utilities");
	lines.push("3. **Key Patterns**: Design patterns used and their rationale (WHY chosen over alternatives)");
	lines.push("4. **Data Data Flow**: How data moves through the system, key data structures");
	lines.push("5. **Per-File Analysis**: Brief notes on each source file's role, key functions/classes, and notable patterns");
	lines.push("6. **Cross-Chapter Connections**: Which chapters reference shared code or concepts");
	lines.push("");
	lines.push("This analysis is critical — it will be used as shared context by workers expanding each chapter independently.");

	return lines.join("\n");
}
