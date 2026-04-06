/**
 * Git Utilities
 *
 * Provides git operations for commit inspection, diff analysis,
 * and change detection used by drift detection and update commands.
 */

import { execSync } from "node:child_process";
import { expandTildePath } from "./paths.js";
import type { GitChange } from "../types.js";

/**
 * Get the current HEAD commit hash for a git repository.
 */
export function getGitCommit(sourceDir: string): string | null {
	const expandedPath = expandTildePath(sourceDir);
	try {
		return execSync("git rev-parse HEAD", {
			cwd: expandedPath,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch {
		return null;
	}
}

/**
 * Get all file changes between a base commit and HEAD.
 * Includes modified, deleted, and new (untracked) files.
 */
export function getGitChanges(sourceDir: string, baseCommit: string): GitChange[] {
	const changes: GitChange[] = [];
	const expandedPath = expandTildePath(sourceDir);

	try {
		// Get modified and deleted files between base commit and HEAD
		const diffOutput = execSync(
			`git diff --name-status ${baseCommit}..HEAD`,
			{ cwd: expandedPath, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
		).trim();

		for (const line of diffOutput.split("\n")) {
			if (!line.trim()) continue;
			const [status, ...pathParts] = line.split("\t");
			const filePath = pathParts.join("\t");
			changes.push({
				path: filePath,
				status: status === "D" ? "deleted" : "modified",
			});
		}

		// Get new (untracked) files
		const statusOutput = execSync(
			"git status --porcelain",
			{ cwd: expandedPath, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
		).trim();

		for (const line of statusOutput.split("\n")) {
			if (!line.trim()) continue;
			const status = line.substring(0, 2).trim();
			const filePath = line.substring(3).trim();
			// ?? = untracked (new file)
			if (status === "??" || status === "A") {
				changes.push({ path: filePath, status: "new" });
			}
		}
	} catch {
		// Git command failed, return empty changes
	}

	return changes;
}
