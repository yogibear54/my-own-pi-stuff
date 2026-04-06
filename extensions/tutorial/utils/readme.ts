/**
 * README IO Utilities
 *
 * Reading and writing the tutorial README.md, including
 * commit metadata extraction and update history management.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { README_FILENAME } from "../constants.js";
import type { ReadmeContent } from "../types.js";

/**
 * Parse the tutorial README.md to extract baseline commit and source location.
 */
export function parseReadme(tutorialDir: string): ReadmeContent | null {
	const readmePath = path.resolve(tutorialDir, README_FILENAME);
	if (!existsSync(readmePath)) return null;

	try {
		const content = readFileSync(readmePath, "utf-8");

		const basedOnMatch = content.match(/\*\*Based On Commit\*\*\s*\|\s*`([^`]+)`/);
		const basedOnCommit = basedOnMatch ? basedOnMatch[1] : null;

		const sourceMatch = content.match(/\*\*Source Location\*\*\s*\|\s*`([^`]+)`/);
		const sourceDir = sourceMatch ? sourceMatch[1] : null;

		if (!basedOnCommit || !sourceDir) return null;

		return { basedOnCommit, sourceDir };
	} catch {
		return null;
	}
}

/**
 * Update the "Based On Commit" value in the tutorial README.
 */
export function updateReadmeCommit(tutorialDir: string, newCommit: string): void {
	const readmePath = path.resolve(tutorialDir, README_FILENAME);
	if (!existsSync(readmePath)) return;

	try {
		let content = readFileSync(readmePath, "utf-8");
		content = content.replace(
			/(\*\*Based On Commit\*\*\s*\|\s*)`[^`]+`/,
			`$1\`${newCommit}\``,
		);
		writeFileSync(readmePath, content, "utf-8");
	} catch {
		// Ignore errors
	}
}

/**
 * Append a new entry to the Update History table in the README.
 */
export function addReadmeUpdateEntry(tutorialDir: string, version: string, details: string): void {
	const readmePath = path.resolve(tutorialDir, README_FILENAME);
	if (!existsSync(readmePath)) return;

	try {
		let content = readFileSync(readmePath, "utf-8");
		const today = new Date().toISOString().split("T")[0];
		const newEntry = `| ${today} | ${version} | ${details} |`;

		const lines = content.split("\n");
		let inUpdateHistory = false;
		let foundSeparator = false;
		let lastDataRowIndex = -1;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line.includes("## Update History")) {
				inUpdateHistory = true;
				foundSeparator = false;
				continue;
			}
			if (!inUpdateHistory) continue;

			if (!foundSeparator && line.includes("---")) {
				foundSeparator = true;
				continue;
			}

			if (foundSeparator) {
				if (line.includes("|") && !line.includes("---")) {
					lastDataRowIndex = i;
				} else {
					break;
				}
			}
		}

		const insertIndex = lastDataRowIndex >= 0 ? lastDataRowIndex + 1 : -1;
		if (insertIndex > 0) {
			lines.splice(insertIndex, 0, newEntry);
			writeFileSync(readmePath, lines.join("\n"), "utf-8");
		}
	} catch {
		// Ignore errors
	}
}
