/**
 * Git Commit Utilities
 *
 * Functions for interacting with git repositories.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Expand tilde (~) in file paths
 */
export function expandTildePath(filePath: string): string {
	if (filePath.startsWith("~/")) {
		return filePath.replace(
			"~",
			process.env.HOME ||
				require("os").homedir()
		);
	}
	return filePath;
}

/**
 * Get the current git commit hash
 */
export function getGitCommit(sourceDir: string): string | null {
	const expandedPath = expandTildePath(sourceDir);
	if (!existsSync(expandedPath)) {
		return null;
	}

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
 * Get git changes between two commits
 */
export function getGitChanges(sourceDir: string, baseCommit: string): Array<{
	path: string;
	status: "modified" | "deleted" | "new";
}> {
	const changes: Array<{
		path: string;
		status: "modified" | "deleted" | "new";
	}> = [];
	const expandedPath = expandTildePath(sourceDir);

	if (!existsSync(expandedPath)) {
		return changes;
	}

	try {
		// Get modified and deleted files between base commit and HEAD
		const diffOutput = execSync(
			`git diff --name-status ${baseCommit}..HEAD`,
			{ cwd: expandedPath, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
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
			{ cwd: expandedPath, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
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