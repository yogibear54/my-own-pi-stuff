/**
 * Tutorial Create Command
 *
 * Command for creating a skeleton tutorial.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { CHAPTERS_FILENAME } from "../constants";
import { loadChaptersIndex, saveChaptersIndex, type ChapterEntry } from "../chapters";
import { buildTutorialPrompt, inferProjectName } from "../config";
import type { TutorialConfig } from "../types";

/**
 * Register the tutorial:create command
 */
export function registerTutorialCreateCommand(pi: ExtensionAPI): void {
	pi.registerCommand("tutorial:create", {
		description: "Create a skeleton tutorial (Pass 1). Use /tutorial:deep-dive for Pass 2 expansion. Usage: /tutorial:create <tutorial-dir> [source-code-dir]",
		handler: async (args, ctx) => {
			const argParts = (args || "").trim().split(/\s+/).filter(Boolean);

			// Quick mode: arguments provided
			if (argParts.length >= 1) {
				const tutorialDir = argParts[0];
				const sourceDir = argParts[1] || ctx.cwd;

				await gatherRequirementsAndPrompt(pi, ctx, {
					tutorialDir,
					sourceDir,
					projectName: inferProjectName(tutorialDir),
					audience: "Developers familiar with JavaScript but new to TypeScript",
					goals: ["Navigate the codebase", "Understand architecture patterns", "Make small changes", "Debug common issues"],
					scope: "detailed",
					includeQuizzes: true,
					includeDiagrams: true,
					techStack: "react",
				}, true);
				return;
			}

			// Interactive mode: need to gather requirements
			if (!ctx.hasUI) {
				ctx.ui.notify("Error: Interactive mode requires UI. Use /tutorial:create <tutorial-dir> [source-code-dir]", "error");
				return;
			}

			// Prompt the LLM to gather requirements
			pi.sendUserMessage(`I need to gather requirements for the tutorial. Please ask the user:

1. Where should the tutorial files be created? (required - provide a directory path)
2. Which codebase should be documented? (optional - defaults to current directory)
3. Who is the target audience? (e.g., 'JavaScript developers new to TypeScript')
4. What are the learning goals? (e.g., 'Navigate the codebase', 'Understand architecture')
5. What scope should the tutorial cover? ('overview', 'detailed', or 'comprehensive')
6. Should it include quizzes? (yes/no)
7. Should it include diagrams? (yes/no)
8. Which tech stack for the tutorial UI? ('react', 'vue', 'svelte', 'markdown' or 'html')
9. Which tech stack for the tutorial backend? ('node', 'python', 'ruby', 'php', 'go', 'rust', 'java', 'c#', 'kotlin', 'swift', 'dart', 'elixir', 'erlang', 'haskell', 'ocaml', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'clojure', 'groovy', 'scala', 'cloj

Or use quick mode: /tutorial:create <tutorial-dir> [source-code-dir]`, { deliverAs: "steer" });
		},
	});
}

/**
 * Gather requirements and send the prompt to LLM
 */
async function gatherRequirementsAndPrompt(
	_pi: ExtensionAPI,
	_ctx: ExtensionContext,
	config: TutorialConfig,
	quickMode: boolean
): Promise<void> {
	const prompt = buildTutorialPrompt(config);

	if (quickMode) {
		// Prepend a concise summary header, then reuse buildTutorialPrompt (single source of truth)
		const header = `Create a SKELETON tutorial for the codebase (Pass 1 of 2).

**Target Directory**: ${config.tutorialDir}
**Source Codebase**: ${config.sourceDir}
**Project Name**: ${config.projectName}
`;
		_pi.sendUserMessage(`${header}\n---\n\n${prompt}`);
	} else {
		_pi.sendUserMessage(prompt);
	}
}