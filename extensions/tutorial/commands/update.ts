/**
 * /tutorial:update Command
 *
 * Detects drift between a tutorial's baseline commit and the current source
 * codebase HEAD, then generates an update prompt for the LLM.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { CHAPTERS_FILENAME, README_FILENAME } from "../constants.js";
import { loadChaptersIndex } from "../utils/chapters.js";
import { parseReadme } from "../utils/readme.js";
import { getGitCommit, getGitChanges } from "../utils/git.js";
import { detectDriftViaGit } from "../drift.js";

export function registerTutorialUpdateCommand(pi: ExtensionAPI) {
	pi.registerCommand("tutorial:update", {
		description: "Detect drift in an existing tutorial and update outdated chapters. Usage: /tutorial:update <tutorial-dir> [source-code-dir] [base-commit]",
		handler: async (args, ctx) => {
			const argParts = (args || "").trim().split(/\s+/).filter(Boolean);

			if (argParts.length < 1) {
				ctx.ui.notify("Usage: /tutorial:update <tutorial-dir> [source-code-dir] [base-commit]", "error");
				return;
			}

			const tutorialDir = argParts[0].startsWith("@") ? argParts[0].slice(1) : argParts[0];
			const providedSourceDir = argParts[1]?.startsWith("@") ? argParts[1].slice(1) : argParts[1] || null;
			const providedBaseCommit = argParts[2] || null;

			const readme = parseReadme(tutorialDir);

			// Determine source directory
			let sourceDir: string;
			if (providedSourceDir) {
				sourceDir = providedSourceDir;
			} else if (readme?.sourceDir) {
				sourceDir = readme.sourceDir;
			} else {
				pi.sendUserMessage(
					`I need more information to detect drift in the tutorial at "${tutorialDir}".

**Missing**: Source codebase location.

Please provide the path to the source codebase that this tutorial documents.

You can either:
- Tell me the source directory path
- Or provide it when running the command: /tutorial:update ${tutorialDir} /path/to/source`,
					{ deliverAs: "steer" },
				);
				return;
			}

			// Determine baseline commit
			let baseCommit: string;
			if (providedBaseCommit) {
				baseCommit = providedBaseCommit;
			} else if (readme?.basedOnCommit) {
				baseCommit = readme.basedOnCommit;
			} else {
				const currentCommit = getGitCommit(sourceDir);
				pi.sendUserMessage(
					`I need more information to detect drift in the tutorial at "${tutorialDir}".

**Missing**: "Based On Commit" baseline.

The ${README_FILENAME} doesn't have baseline commit information, or this tutorial wasn't created with /tutorial:create.

Please provide the git commit hash that should be used as the baseline for detecting changes.

${currentCommit ? `Current HEAD commit: \`${currentCommit}\`` : "(Could not determine current HEAD commit)"}

You can either:
- Tell me the baseline commit hash
- Or provide it when running the command: /tutorial:update ${tutorialDir} ${sourceDir} <commit-hash>`,
					{ deliverAs: "steer" },
				);
				return;
			}

			// Load chapters index
			const chaptersIndex = loadChaptersIndex(tutorialDir);

			// Get current commit
			const currentCommit = getGitCommit(sourceDir);
			if (!currentCommit) {
				ctx.ui.notify(`Could not get current git commit from ${sourceDir}. Is this a git repository?`, "error");
				return;
			}

			// Get changes
			const gitChanges = getGitChanges(sourceDir, baseCommit);

			if (gitChanges.length === 0) {
				pi.sendUserMessage(
					`No changes detected between the baseline and current commits.\n\n` +
					`Based on commit: \`${baseCommit}\`\n` +
					`Current commit: \`${currentCommit}\`\n\n` +
					`No source file changes detected.`,
					{ deliverAs: "assistant" },
				);
				return;
			}

			// Build the update prompt
			const prompt = buildUpdatePrompt(tutorialDir, sourceDir, baseCommit, currentCommit, gitChanges, chaptersIndex);
			pi.sendUserMessage(prompt);
		},
	});
}

// ─── Prompt Builder ──────────────────────────────────────────────────

function buildUpdatePrompt(
	tutorialDir: string,
	sourceDir: string,
	baseCommit: string,
	currentCommit: string,
	gitChanges: Array<{ path: string; status: "modified" | "deleted" | "new" }>,
	chaptersIndex: ReturnType<typeof loadChaptersIndex>,
): string {
	let prompt = `Git changes detected since baseline commit.\n\n`;
	prompt += `**Based On Commit**: \`${baseCommit}\`\n`;
	prompt += `**Current Commit**: \`${currentCommit}\`\n\n`;

	prompt += "### Changed Files\n\n";
	for (const change of gitChanges) {
		const statusIcon = change.status === "modified" ? "M" : change.status === "deleted" ? "D" : "A";
		const statusLabel = change.status === "modified" ? "modified" : change.status === "deleted" ? "deleted" : "new";
		prompt += `  [\`${statusIcon}\`] \`${change.path}\` (${statusLabel})\n`;
	}
	prompt += "\n";

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
				prompt += `- **${ch.title}** (\`${ch.id}\`) OK\n`;
			}
			prompt += "\n";
		}

		prompt += `### Instructions\n\n`;
		prompt += `Please update the outdated chapters in "${tutorialDir}" based on the current source files.\n`;
		prompt += `Only regenerate the chapters listed above. Preserve any manual edits in up-to-date chapters.\n\n`;
		prompt += `For each outdated chapter:\n`;
		prompt += `1. Re-read the current source files listed above\n`;
		prompt += `2. Update the chapter content to reflect current code\n`;
		prompt += `3. Update the \`chapters.json\` if file references change\n`;
		prompt += `4. Update the \`README.md\` "Based On Commit" to \`${currentCommit}\`\n`;
		prompt += `5. Add an entry to the Update History table\n\n`;
	} else {
		prompt += `**Note**: No ${CHAPTERS_FILENAME} found. Chapter-level drift detection unavailable.\n\n`;
		prompt += `### Instructions\n\n`;
		prompt += `Please review the changed files above and update the relevant chapters in "${tutorialDir}".\n\n`;
		prompt += `After updating, consider creating a ${CHAPTERS_FILENAME} file to enable chapter-level drift detection:\n`;
		prompt += `- List each chapter's id, title, and source files it references\n`;
		prompt += `- This will help identify which chapters are affected by future changes\n\n`;
	}

	prompt += `Source codebase: ${sourceDir}\n`;
	prompt += `Tutorial target: ${tutorialDir}\n`;

	return prompt;
}
