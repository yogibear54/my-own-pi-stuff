/**
 * /tutorial:create Command
 *
 * Creates a skeleton tutorial (Pass 1) from a source codebase.
 * Supports quick mode (with arguments) and interactive mode.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { inferProjectName } from "../utils/paths.js";
import { gatherRequirementsAndPrompt } from "../prompts/tutorial-create.js";

export function registerTutorialCreateCommand(pi: ExtensionAPI) {
	pi.registerCommand("tutorial:create", {
		description:
			"Create a skeleton tutorial (Pass 1). Use /tutorial:deep-dive for Pass 2 expansion. Usage: /tutorial:create <tutorial-dir> [source-code-dir]",
		handler: async (args, ctx) => {
			const argParts = (args || "").trim().split(/\s+/).filter(Boolean);

			// Quick mode: arguments provided
			if (argParts.length >= 1) {
				const tutorialDir = argParts[0].startsWith("@") ? argParts[0].slice(1) : argParts[0];
				const sourceDir = argParts[1]?.startsWith("@") ? argParts[1].slice(1) : argParts[1] || ctx.cwd;

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
				ctx.ui.notify(
					"Error: Interactive mode requires UI. Use /tutorial:create <tutorial-dir> [source-code-dir]",
					"error",
				);
				return;
			}

			// Prompt the LLM to gather requirements
			pi.sendUserMessage(
				`I need to gather requirements for the tutorial. Please ask the user:

1. Where should the tutorial files be created? (required - provide a directory path)
2. Which codebase should be documented? (optional - defaults to current directory)
3. Who is the target audience? (e.g., 'JavaScript developers new to TypeScript')
4. What are the learning goals? (e.g., 'Navigate the codebase', 'Understand architecture')
5. What scope should the tutorial cover? ('overview', 'detailed', or 'comprehensive')
6. Should it include quizzes? (yes/no)
7. Should it include diagrams? (yes/no)
8. Which tech stack for the tutorial UI? ('react', 'vue', 'svelte', or 'html')

Or use quick mode: /tutorial:create <tutorial-dir> [source-code-dir]`,
				{ deliverAs: "steer" },
			);
		},
	});
}
