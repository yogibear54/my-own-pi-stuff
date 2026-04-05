/**
 * Tutorial Drift Check Tool
 *
 * Tool for detecting which chapters are outdated based on git changes.
 */

import { Type } from "@sinclair/typebox";
import { existsSync } from "node:fs";
import path from "node:path";
import { CHAPTERS_FILENAME, README_FILENAME } from "../constants";
import {
	detectDriftViaGit,
	getGitCommit,
	getGitChanges,
	expandTildePath,
} from "../git-detection";
import {
	loadChaptersIndex,
	type ChaptersIndex,
} from "../chapters";
import { parseReadme } from "../git-detection/README-parsers";

/**
 * Register the check_tutorial_drift tool
 */
export function registerCheckTutorialDriftTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "check_tutorial_drift",
		label: "Check Tutorial Drift",
		description: "Check if an existing tutorial's chapters are outdated by comparing the README.md 'Based On Commit' against the current git HEAD. Returns a list of outdated chapters with details on which files changed.",
		parameters: Type.Object({
			tutorialDir: Type.String({
				description: "The tutorial directory containing README.md and chapters.json",
			}),
			sourceDir: Type.Optional(
				Type.String({
					description: "The source codebase directory (overrides README.md if provided)",
				})
			),
			baseCommit: Type.Optional(
				Type.String({
					description: "The baseline git commit to compare against (overrides README.md if provided)",
				})
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const tutorialDir = params.tutorialDir;

			// Try to parse README for baseline commit and source directory
			const readme = parseReadme(tutorialDir);

			// Determine source directory (from args or README)
			const sourceDir = params.sourceDir || readme?.sourceDir;
			if (!sourceDir) {
				return {
					content: [{
						type: "text",
						text: `No source directory found. Please provide either a ${README_FILENAME} with "Source Location" or pass sourceDir parameter.`,
					}],
					details: { error: "Source directory not specified" },
				};
			}

			// Determine baseline commit (from args or README)
			const baseCommit = params.baseCommit || readme?.basedOnCommit;
			if (!baseCommit) {
				const currentCommit = getGitCommit(sourceDir);
				return {
					content: [{
						type: "text",
						text: `No baseline commit found. Please provide either a ${README_FILENAME} with "Based On Commit" or pass baseCommit parameter.${currentCommit ? `\n\nCurrent HEAD: \`${currentCommit}\`` : ""}`,
					}],
					details: { error: "Baseline commit not specified" },
				};
			}

			// Get current git commit
			const currentCommit = getGitCommit(sourceDir);
			if (!currentCommit) {
				return {
					content: [{
						type: "text",
						text: `Could not get current git commit from ${sourceDir}. Is this a git repository?`,
					}],
					details: { error: "Git error" },
				};
			}

			// Get git changes since the baseline commit
			const gitChanges = getGitChanges(sourceDir, baseCommit);

			// Load chapters index (optional)
			const chaptersIndex = loadChaptersIndex(tutorialDir);

			// Build result
			if (gitChanges.length === 0) {
				const upToDateCount = chaptersIndex?.chapters.length ?? 0;
				return {
					content: [{
						type: "text",
						text: `No changes detected.\n\nBased on commit: \`${baseCommit}\`\nCurrent commit: \`${currentCommit}\`\n\nAll source files are unchanged.`,
					}],
					details: {
						outdatedCount: 0,
						upToDateCount,
						basedOnCommit: baseCommit,
						currentCommit,
					},
				};
			}

			let text = `**${gitChanges.length} file(s)** changed since baseline.\n\n`;
			text += `Based on commit: \`${baseCommit}\`\n`;
			text += `Current commit: \`${currentCommit}\`\n\n`;

			text += `Changed files:\n`;
			for (const change of gitChanges) {
				const statusLabel =
					change.status === "modified"
						? "modified"
						: change.status === "deleted"
							? "⚠️ deleted"
							: "new";
				text += `  - \`${change.path}\` (${statusLabel})\n`;
			}
			text += "\n";

			if (chaptersIndex) {
				const driftResult = detectDriftViaGit(chaptersIndex, gitChanges);
				const { outdatedChapters, upToDateChapters } = driftResult;

				if (outdatedChapters.length > 0) {
					text += `### Outdated Chapters (${outdatedChapters.length})\n\n`;
					for (const ch of outdatedChapters) {
						text += `**${ch.title}** (\`${ch.id}\`)\n`;
						for (const f of ch.changedFiles) {
							text += `  - \`${f.path}\` (${f.status})\n`;
						}
						text += "\n";
					}
				}

				if (upToDateChapters.length > 0) {
					text += `Up-to-date chapters: ${upToDateChapters.map(ch => ch.title).join(", ")}\n`;
				}

				text += `\nUse /tutorial:update ${tutorialDir} to regenerate outdated chapters.`;

				return {
					content: [{ type: "text", text }],
					details: {
						outdatedCount: driftResult.outdatedChapters.length,
						upToDateCount: driftResult.upToDateChapters.length,
						basedOnCommit: baseCommit,
						currentCommit,
						outdatedChapters: driftResult.outdatedChapters,
						upToDateChapters: driftResult.upToDateChapters,
					},
				};
			} else {
				text += `**Note**: No ${CHAPTERS_FILENAME} found. Chapter-level drift detection unavailable.\n\n`;
				text += `Consider creating a ${CHAPTERS_FILENAME} to enable chapter-level detection.`;

				return {
					content: [{ type: "text", text }],
					details: {
						outdatedCount: -1,
						upToDateCount: -1,
						basedOnCommit: baseCommit,
						currentCommit,
						changedFiles: gitChanges,
					},
				};
			}
		},

		renderCall(args, theme) {
			const target = args.tutorialDir as string || "(unset)";
			return {
				render(_width: number) {
					return [
						theme.fg("toolTitle", theme.bold("check_tutorial_drift")),
						`  Target: ${target}`,
					];
				},
			};
		},

		renderResult(result, _options, theme) {
			const details =
				result.details as {
					outdatedCount?: number;
					upToDateCount?: number;
					error?: string;
				} | undefined;

			if (details?.error) {
				return {
					render(_width: number) {
						return [theme.fg("error", `✗ ${details.error}`)];
					},
				};
			}

			const outdated = details?.outdatedCount ?? 0;
			const upToDate = details?.upToDateCount ?? 0;

			return {
				render(_width: number) {
					if (outdated === 0) {
						return [
							theme.fg("success", `✓ Tutorial up to date (${upToDate} chapters)`),
						];
					}
					return [
						theme.fg("warning", `⚠ Drift detected: ${outdated} outdated, ${upToDate} up to date`),
					];
				},
			};
		},
	});
}