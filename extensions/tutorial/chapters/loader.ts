/**
 * Chapter Loader
 *
 * Functions for loading and saving the chapters index file.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CHAPTERS_FILENAME } from "../constants";
import { resolveDirectoryReference } from "../path-utils";
import type { ChaptersIndex } from "../types";

/**
 * Load chapters index from JSON file
 */
export function loadChaptersIndex(tutorialDir: string): ChaptersIndex | null {
	const chaptersPath = path.resolve(resolveDirectoryReference(tutorialDir), CHAPTERS_FILENAME);
	if (!existsSync(chaptersPath)) return null;

	try {
		const raw = readFileSync(chaptersPath, "utf-8");
		return JSON.parse(raw) as ChaptersIndex;
	} catch {
		return null;
	}
}

/**
 * Save chapters index to JSON file
 */
export function saveChaptersIndex(tutorialDir: string, index: ChaptersIndex): void {
	const chaptersPath = path.resolve(resolveDirectoryReference(tutorialDir), CHAPTERS_FILENAME);
	writeFileSync(chaptersPath, JSON.stringify(index, null, 2), "utf-8");
}