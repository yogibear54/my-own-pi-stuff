/**
 * Tutorial Deep-Dive Command
 *
 * Command for deep-diving into skeleton tutorial chapters and expanding them.
 */

import { CHAPTERS_FILENAME } from "../constants";
import { loadChaptersIndex, type ChapterEntry } from "../chapters";
import { buildDeepDivePrompt } from "../config";
import { parseReadme } from "../git-detection/README-parsers";
import type { TutorialConfig } from "../types";

/**
 * Register the tutorial:deep-dive command
 */
export function registerTutorialDeepDiveCommand(pi: ExtensionAPI): void {
	const DEEP_DIVE_DESCRIPTION =
		"Deep-dive into skeleton tutorial chapters with detailed analysis. " +
		"Expands all chapters or a specific chapter. " +
		"Usage: /tutorial:deep-dive <tutorial-dir> [chapter-id]";

	const DEEP_DIVE_TOOL_DESCRIPTION =
		"Expand skeleton tutorial chapters with deep code analysis. " +
		"Reads the skeleton created by /tutorial:create, deeply analyzes source files, " +
	 "and expands chapter content with detailed walkthroughs, quizzes, and diagrams. " +
		"Call when the user wants to deepen tutorial content.";

	// Register the command
	const handler = async (args: string, ctx: ExtensionContext) => {
		const argParts = (args || "").trim().split(/\s+/).filter(Boolean);

		if (argParts.length < 1) {
			ctx.ui.notify("Usage: /tutorial:deep-dive <tutorial-dir> [chapter-id]", "error");
			return;
		}

		const tutorialDir = argParts[0];
		const chapterId = argParts[1] || null;

		// Load chapters index
		const chaptersIndex = loadChaptersIndex(tutorialDir);
		if (!chaptersIndex || chaptersIndex.chapters.length === 0) {
			const readme = parseReadme(tutorialDir);
			const hasReadme = !!readme;
			const sourceInfo = readme?.sourceDir
				? `\nFound README.md with source at \`${readme.sourceDir}\``
				: "\nNo README.md found either.";

			ctx.ui.notify(
				`No ${CHAPTERS_FILENAME} found in "${tutorialDir}".`,
				"error",
			);
			pi.sendUserMessage(
				`No ${CHAPTERS_FILENAME} found in "${tutorialDir}".\n\n` +
				`Deep-dive requires a skeleton tutorial created with \`/tutorial:create\`.\n\n` +
				`Please run \`/tutorial:create ${tutorialDir}\` first to create the skeleton tutorial.` +
				sourceInfo,
				{ deliverAs: "steer" },
			);
			return;
		}

		// Get config from chapters index or infer from README
		const config = chaptersIndex.config;

		let sourceDir: string;
		if (config?.sourceDir) {
			sourceDir = config.sourceDir;
		} else {
			const readme = parseReadme(tutorialDir);
			if (readme?.sourceDir) {
				sourceDir = readme.sourceDir;
			} else {
				pi.sendUserMessage(
					`Cannot determine source codebase location for tutorial at "${tutorialDir}".\n\n` +
					`The ${CHAPTERS_FILENAME} doesn't have a config section with sourceDir, and no README.md was found.\n\n` +
					`Please either:\n` +
					`- Re-create the tutorial with \`/tutorial:create\` (which saves config to chapters.json)\n` +
					`- Or add a "config" section to ${CHAPTERS_FILENAME} with the "sourceDir" field`,
					{ deliverAs: "steer" },
				);
				return;
			}
		}

		// Filter chapters if a specific chapter ID is provided
		let targetChapters: ChapterEntry[];
		if (chapterId) {
			const normalizedId = chapterId.toLowerCase().replace(/\s+/g, "-");
			const target = chaptersIndex.chapters.find(
				ch => ch.id === chapterId || ch.id === normalizedId,
			);
			if (!target) {
				const available = chaptersIndex.chapters
					.map(ch => `  - \`${ch.id}\` → ${ch.title}`)
					.join("\n");
				ctx.ui.notify(`Chapter "${chapterId}" not found.`, "error");
				pi.sendUserMessage(
					`Chapter \`${chapterId}\` not found in "${tutorialDir}".\n\n` +
					`Available chapters:\n${available}\n\n` +
					`Usage: /tutorial:deep-dive ${tutorialDir} <chapter-id>`,
					{ deliverAs: "steer" },
				);
				return;
			}
			targetChapters = [target];
		} else {
			targetChapters = chaptersIndex.chapters;
		}

		// Notify the user
		const chapterCount = targetChapters.length;
		const isSingle = chapterCount === 1;
		ctx.ui.notify(
			`🔍 Deep diving ${isSingle ? `chapter: ${targetChapters[0].title}` : `${chapterCount} chapters`}...`,
			"info",
		);

		// Build and send the deep-dive prompt
		const prompt = buildDeepDivePrompt(tutorialDir, sourceDir, targetChapters, config);
		pi.sendUserMessage(prompt);
	};

	pi.registerCommand("tutorial:deep-dive", {
		description: DEEP_DIVE_DESCRIPTION,
		handler,
	});
}