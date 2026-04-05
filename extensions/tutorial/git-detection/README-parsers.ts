/**
 * README Parser Utilities
 *
 * Functions for parsing and updating tutorial README.md files.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { README_FILENAME } from "../constants";
import type { ReadmeContent } from "../types";

/**
 * Parse README.md and extract key information
 */
export function parseReadme(tutorialDir: string): ReadmeContent | null {
	const readmePath = path.resolve(tutorialDir, README_FILENAME);
	if (!existsSync(readmePath)) return null;

	try {
		const content = readFileSync(readmePath, "utf-8");

		// Extract Based On Commit
		const basedOnMatch = content.match(/\*\*Based On Commit\*\*\s*\|\s*`([^`]+)`/);
		const basedOnCommit = basedOnMatch ? basedOnMatch[1] : null;

		// Extract Source Location
		const sourceMatch = content.match(/\*\*Source Location\*\*\s*\|\s*`([^`]+)`/);
		const sourceDir = sourceMatch ? sourceMatch[1] : null;

		if (!basedOnCommit || !sourceDir) return null;

		return { basedOnCommit, sourceDir };
	} catch {
		return null;
	}
}

/**
 * Update the Based On Commit line in README.md
 */
export function updateReadmeCommit(tutorialDir: string, newCommit: string): void {
	const readmePath = path.resolve(tutorialDir, README_FILENAME);
	if (!existsSync(readmePath)) return;

	try {
		let content = readFileSync(readmePath, "utf-8");
		// Update the Based On Commit line
		content = content.replace(
			/(\*\*Based On Commit\*\*\s*\|\s*)`[^`]+`/,
			`$1\`${newCommit}\``
		);
		writeFileSync(readmePath, content, "utf-8");
	} catch {
		// Ignore errors
	}
}

/**
 * Add an entry to the Update History table in README.md
 */
export function addReadmeUpdateEntry(
	tutorialDir: string,
	version: string,
	details: string
): void {
	const readmePath = path.resolve(tutorialDir, README_FILENAME);
	if (!existsSync(readmePath)) return;

	try {
		let content = readFileSync(readmePath, "utf-8");
		const today = new Date().toISOString().split("T")[0];
		const newEntry = `| ${today} | ${version} | ${details} |`;

		// Find the Update History table and add the new entry after the last data row
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

			// Skip the separator line (e.g. |---|---|)
			if (!foundSeparator && line.includes("---")) {
				foundSeparator = true;
				continue;
			}

			if (foundSeparator) {
				// A table data row contains | but isn't the separator
				if (line.includes("|") && !line.includes("---")) {
					lastDataRowIndex = i;
				} else {
					// First non-table line after data rows = end of table
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