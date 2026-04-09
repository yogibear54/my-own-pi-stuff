/**
 * configure_tutorial Tool
 *
 * Structured requirement gathering for tutorial creation.
 * This tool is called by the LLM after collecting requirements from the user.
 */

import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { inferProjectName } from "../utils/paths.js";
import { buildTutorialPrompt } from "../prompts/tutorial-create.js";
import { createTutorialTodos } from "../todos.js";
import { CHAPTERS_FILENAME } from "../constants.js";
import type { TutorialConfig } from "../types.js";

export function registerConfigureTutorialTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "configure_tutorial",
		label: "Configure Tutorial",
		description: "Gather requirements for creating a codebase tutorial. Use the 'tutorialDir' parameter to specify where tutorial files will be created. Call this tool when you have gathered all requirements from the user.",

		parameters: Type.Object({
			tutorialDir: Type.String(),
			sourceDir: Type.String(),
			projectName: Type.String(),
			audience: Type.String(),
			goals: Type.Array(Type.String()),
			scope: Type.Union([
				Type.Literal("overview"),
				Type.Literal("detailed"),
				Type.Literal("comprehensive"),
			]),
			includeQuizzes: Type.Boolean(),
			includeDiagrams: Type.Boolean(),
			techStack: Type.Union([
				Type.Literal("react"),
				Type.Literal("vue"),
				Type.Literal("svelte"),
				Type.Literal("html"),
			]),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!params.tutorialDir) {
				return {
					content: [{ type: "text", text: "Error: tutorialDir is required. Please specify the directory where tutorial files should be created." }],
					details: { cancelled: true, error: "Missing tutorialDir" },
				};
			}

			const config: TutorialConfig = {
				tutorialDir: params.tutorialDir,
				sourceDir: params.sourceDir || ctx.cwd,
				projectName: params.projectName || inferProjectName(params.tutorialDir),
				audience: params.audience || "Developers familiar with JavaScript but new to TypeScript",
				goals: params.goals || ["Navigate the codebase", "Understand architecture patterns"],
				scope: params.scope || "comprehensive",
				includeQuizzes: params.includeQuizzes ?? true,
				includeDiagrams: params.includeDiagrams ?? true,
				techStack: params.techStack || "react",
			};

			const prompt = buildTutorialPrompt(config);
			const todoResult = await createTutorialTodos(pi, config, ctx);

			let responseText = `Tutorial configuration complete. Now analyze the codebase and create a SKELETON tutorial (Pass 1).

The skeleton will be expanded with detailed content in Pass 2 via \`/tutorial:deep-dive\`.

Configuration:
- Target: ${config.tutorialDir}
- Source: ${config.sourceDir}
- Project: ${config.projectName}
- Audience: ${config.audience}
- Scope: ${config.scope}
- Quizzes: ${config.includeQuizzes ? "Yes" : "No"}
- Diagrams: ${config.includeDiagrams ? "Yes" : "No"}
- Tech Stack: ${config.techStack}`;

			if (todoResult.created) {
				responseText += `\n\nTodo tracking: ${todoResult.message}`;
			}

			responseText += `\n\nBegin by exploring the source codebase structure. Then create the tutorial following the requirements below.\n\n---\n\n${prompt}`;

			return {
				content: [{ type: "text", text: responseText }],
				details: { config, prompt, todos: todoResult },
			};
		},

		renderCall(args, theme) {
			const target = args.tutorialDir as string || "(unset)";
			const source = args.sourceDir as string || "(cwd)";
			const project = args.projectName as string || "(unnamed)";
			return {
				render(_width: number) {
					return [
						theme.fg("toolTitle", theme.bold("configure_tutorial")),
						`  Target: ${target}`,
						`  Source: ${source}`,
						`  Project: ${project}`,
					];
				},
			};
		},

		renderResult(result, _options, theme) {
			const details = result.details as { config?: TutorialConfig } | undefined;
			if (!details?.config) {
				return {
					render(_width: number) {
						return [theme.fg("error", "Failed to configure tutorial")];
					},
				};
			}

			const { config } = details;
			return {
				render(_width: number) {
					return [
						theme.fg("success", "Tutorial configured"),
						`  Target: ${config.tutorialDir}`,
						`  Source: ${config.sourceDir}`,
						`  Scope: ${config.scope}`,
						`  Stack: ${config.techStack}`,
					];
				},
			};
		},
	});
}
