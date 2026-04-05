/**
 * Tutorial Update Command
 *
 * Command for detecting drift and updating outdated tutorial chapters.
 */

import { CHAPTERS_FILENAME } from "../constants";
import {
	loadChaptersIndex,
	type ChaptersIndex,
} from "../chapters";
import {
	getGitCommit,
	getGitChanges,
	detectDriftViaGit,
	expandTildePath,
} from "../git-detection";
import {
	parseReadme,
	updateReadmeCommit,
	addReadmeUpdateEntry,
} from "../git-detection/README-parsers";
import type { TutorialConfig } from "../types";

/**
 * Register the tutorial:update command
 */
export function registerTutorialUpdateCommand(pi: ExtensionAPI): void {
	pi.registerCommand("tutorial:update", {
		description: "Detect drift in an existing tutorial and update outdated chapters. Usage: /tutorial:update <tutorial-dir> [source-code-dir] [base-commit]",
		handler: async (args, ctx) => {
			const argParts = (args || "").trim().split(/\s+/).filter(Boolean);

			if (argParts.length < 1) {
				ctx.ui.notify("Usage: /tutorial:update <tutorial-dir> [source-code-dir] [base-commit]", "error");
				return;
			}

			const tutorialDir = argParts[0];
			const providedSourceDir = argParts[1] || null;
			const providedBaseCommit = argParts[2] || null;

			// Try to parse README for baseline commit and source directory
			const readme = parseReadme(tutorialDir);

			// Determine source directory (from args, README, or need to ask)
			let sourceDir: string;
			if (providedSourceDir) {
				sourceDir = providedSourceDir;
			} else if (readme?.sourceDir) {
				sourceDir = readme.sourceDir;
			} else {
				// Need to ask user for source directory
				pi.sendUserMessage(
					`I need more information to detect drift in the tutorial at "${tutorialDir}".

**Missing**: Source codebase location.

Please provide the path to the source codebase that this tutorial documents.

You can either:
- Tell me the source directory path
- Or provide it when running the command: /tutorial:update ${tutorialDir} /path/to/source`,
					{ deliverAs: "steer" }
				);
				return;
			}

			// Determine baseline commit (from args, README, or need to ask)
			let baseCommit: string;
			if (providedBaseCommit) {
				baseCommit = providedBaseCommit;
			} else if (readme?.basedOnCommit) {
				baseCommit = readme.basedOnCommit;
			} else {
				// Need to ask user for baseline commit
				const currentCommit = getGitCommit(sourceDir);
				pi.sendUserMessage(
					`I need more information to detect drift in the tutorial at "${tutorialDir}".

**Missing**: "Based On Commit" baseline.

The ${CHAPTERS_FILENAME} doesn't have baseline commit information, or this tutorial wasn't created with /tutorial:create.

Please provide the git commit hash that should be used as the baseline for detecting changes.

${currentCommit ? `Current HEAD commit: \`${currentCommit}\`` : "(Could not determine current HEAD commit)"}

You can either:
- Tell me the baseline commit hash
- Or provide it when running the command: /tutorial:update ${tutorialDir} ${sourceDir} <commit-hash>`,
					{ deliverAs: "steer" }
				);
				return;
			}

			// Load chapters index (optional - we can still detect drift without it)
			const chaptersIndex = loadChaptersIndex(tutorialDir);

			// Get current git commit
			const currentCommit = getGitCommit(sourceDir);
			if (!currentCommit) {
				ctx.ui.notify(
					`Could not get current git commit from ${sourceDir}. Is this a git repository?`,
					"error",
				);
				return;
			}

			// Get git changes since the baseline commit
			const gitChanges = getGitChanges(sourceDir, baseCommit);

			// Build the update prompt
			let prompt: string;

			if (gitChanges.length === 0) {
				pi.sendUserMessage(
					`No changes detected between the baseline and current commits.\n\n` +
					`Based on commit: \`${baseCommit}\`\n` +
					`Current commit: \`${currentCommit}\`\n\n` +
					`No source file changes detected.`,
					{ deliverAs: "assistant" }
				);
				return;
			}

			prompt = `Git changes detected since baseline commit.\n\n`;
			prompt += `**Based On Commit**: \`${baseCommit}\`\n`;
			prompt += `**Current Commit**: \`${currentCommit}\`\n\n`;

			prompt += "### Changed Files\n\n";
			for (const change of gitChanges) {
				const statusIcon =
					change.status === "modified" ? "M" : change.status === "deleted" ? "D" : "A";
				const statusLabel =
					change.status === "modified"
						? "modified"
						: change.status === "deleted"
							? "deleted"
							: "new";
				prompt += `  [\`${statusIcon}\`] \`${change.path}\` (${statusLabel})\n`;
			}
			prompt += "\n";

			// If we have chapters index, show which chapters are affected
			if (chaptersIndex) {
				const driftResult = detectDriftViaGit(chaptersIndex, gitChanges);
				const outdatedCount = driftResult.outdatedChapters.length;
				const upToDateCount = driftResult.upToDateChapters.length;

				if (outdatedCount > 0) {
					prompt += `### Outdated Chapters\n\n`;
					for (const ch of driftResult.outdatedChapters) {
						prompt += `**${ch.title}** (\`${ch.id}\`)\n`;
						prompt += `  Changed files:\n`;
						for (const f of ch.changedFiles) {
							prompt += `  - \`${f.path}\` (${f.status})\n`;
						}
						prompt += "\n";
					}
				}

				if (upToDateCount > 0) {
					prompt += `### Up-to-date Chapters (${upToDateCount})\n\n`;
					for (const ch of driftResult.upToDateChapters) {
						prompt += `- **${ch.title}** (\`${ch.id}\`) ✓\n`;
					}
					prompt += "\n";
				}

				prompt += `### Instructions\n\n`;
				prompt += `Please update the outdated chapters in "${tutorialDir}" based on the current source files.\n`;
				prompt += `Only regenerate the chapters listed above. Preserve any manual edits in up-to-date chapters.\n\n`;
				prompt += `For each outdated chapter:\n`;
				prompt += `1. Re-read the current source files listed above\n`;
				prompt += `2. Update the chapter content to reflect current code\n`;
				prompt += `3. Update the ${CHAPTERS_FILENAME} if file references change\n`;
				prompt += `4. Update the README.md "Based On Commit" to ${currentCommit}\n`;
				prompt += `5. Add an entry to the Update History table\n\n`;
			} else {
				// No chapters index - just show the changes
				prompt += `**Note**: No ${CHAPTERS_FILENAME} found. Chapter-level drift detection unavailable.\n\n`;
				prompt += `### Instructions\n\n`;
				prompt += `Please review the changed files above and update the relevant chapters in "${tutorialDir}".\n\n`;
				prompt += `After updating, consider creating a ${CHAPTERS_FILENAME} file to enable chapter-level drift detection:\n`;
				prompt += `- List each chapter's id, title, and source files it references\n`;
				prompt += `- This will help identify which chapters are affected by future changes\n\n`;
			}

			prompt += `Source codebase: ${sourceDir}\n`;
			prompt += `Tutorial target: ${tutorialDir}\n`;

			pi.sendUserMessage(prompt);
		},
	});
}