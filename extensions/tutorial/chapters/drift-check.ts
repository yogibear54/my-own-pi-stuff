/**
 * Drift Detection
 *
 * Functions for detecting which chapters are outdated based on git changes.
 */

import type { GitChange } from "../types";

/**
 * Detect drift in chapters based on git changes
 */
export function detectDriftViaGit(
	chaptersIndex: import("../types").ChaptersIndex,
	gitChanges: GitChange[]
): import("../types").DriftResult {
	const outdatedChapters: import("../types").OutdatedChapter[] = [];
	const upToDateChapters: import("../types").UpToDateChapter[] = [];

	// Create a set of changed file paths for quick lookup
	const changedFilesSet = new Set(gitChanges.map(c => c.path));

	for (const chapter of chaptersIndex.chapters) {
		const changedFiles: import("../types").ChangedFile[] = [];
		const seenPaths = new Set<string>();

		for (const filePattern of chapter.sourceFiles) {
			// Check if this file matches any changed file
			if (changedFilesSet.has(filePattern) && !seenPaths.has(filePattern)) {
				const change = gitChanges.find(c => c.path === filePattern)!;
				changedFiles.push(change);
				seenPaths.add(filePattern);
			}

			// Handle glob patterns (e.g., "src/services/*.ts")
			if (filePattern.includes("*")) {
				const regex = globToRegex(filePattern);
				for (const change of gitChanges) {
					if (regex.test(change.path) && !seenPaths.has(change.path)) {
						changedFiles.push(change);
						seenPaths.add(change.path);
					}
				}
			}
		}

		if (changedFiles.length > 0) {
			outdatedChapters.push({
				id: chapter.id,
				title: chapter.title,
				changedFiles,
			});
		} else {
			upToDateChapters.push({
				id: chapter.id,
				title: chapter.title,
			});
		}
	}

	return { outdatedChapters, upToDateChapters };
}

/**
 * Convert a glob pattern to a regex
 */
function globToRegex(pattern: string): RegExp {
	// Convert simple glob pattern to regex
	// * matches any characters except /
	// ** matches any characters including /
	const escaped = pattern
		.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*/g, ".*")
		.replace(/\*/g, "[^/]*");
	return new RegExp(`^${escaped}$`);
}