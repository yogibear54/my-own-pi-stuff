/**
 * Drift Detection
 *
 * Compares git changes against a chapters index to determine
 * which tutorial chapters are outdated and which are up-to-date.
 */

import { globToRegex } from "./utils/paths.js";
import type { ChaptersIndex, GitChange, ChangedFile, OutdatedChapter, UpToDateChapter, DriftResult } from "./types.js";

/**
 * Detect which chapters are outdated based on git changes.
 *
 * For each chapter, checks whether any of its `sourceFiles`
 * (including glob patterns) match the changed files.
 */
export function detectDriftViaGit(chaptersIndex: ChaptersIndex, gitChanges: GitChange[]): DriftResult {
	const outdatedChapters: OutdatedChapter[] = [];
	const upToDateChapters: UpToDateChapter[] = [];

	// Create a set of changed file paths for quick lookup
	const changedFilesSet = new Set(gitChanges.map(c => c.path));

	for (const chapter of chaptersIndex.chapters) {
		const changedFiles: ChangedFile[] = [];
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
