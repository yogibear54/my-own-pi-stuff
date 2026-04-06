/**
 * Chapters Index IO
 *
 * Loading and saving the chapters.json index file that maps
 * tutorial chapters to their source code files.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CHAPTERS_FILENAME } from "../constants.js";
import type { ChaptersIndex } from "../types.js";

/**
 * Load the chapters index from a tutorial directory.
 * Returns null if the file doesn't exist or is invalid JSON.
 */
export function loadChaptersIndex(tutorialDir: string): ChaptersIndex | null {
	const chaptersPath = path.resolve(tutorialDir, CHAPTERS_FILENAME);
	if (!existsSync(chaptersPath)) return null;

	try {
		const raw = readFileSync(chaptersPath, "utf-8");
		return JSON.parse(raw) as ChaptersIndex;
	} catch {
		return null;
	}
}

/**
 * Save a chapters index to a tutorial directory.
 */
export function saveChaptersIndex(tutorialDir: string, index: ChaptersIndex): void {
	const chaptersPath = path.resolve(tutorialDir, CHAPTERS_FILENAME);
	writeFileSync(chaptersPath, JSON.stringify(index, null, 2), "utf-8");
}
