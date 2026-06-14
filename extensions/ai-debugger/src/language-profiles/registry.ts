/**
 * Language profile registry.
 *
 * Maps file extensions and names to registered profiles. The instrumentation
 * tool uses `getProfileForFile()` to look up the right profile for a given source
 * file, and `detectProfiles()` to auto-detect which languages a project uses.
 *
 * To add a new built-in profile: import it here and add it to the `profiles` array.
 */

import * as path from "node:path";
import { TypeScriptProfile } from "./typescript.js";
import type { LanguageProfile } from "./types.js";

// ── Registered profiles ────────────────────────────────────────────────────

const profiles: LanguageProfile[] = [TypeScriptProfile];

// Build extension → profile lookup map for O(1) file lookups.
const byExtension = new Map<string, LanguageProfile>();
for (const profile of profiles) {
	for (const ext of profile.extensions) {
		byExtension.set(ext, profile);
	}
}

// ── Lookups ─────────────────────────────────────────────────────────────────

/** Look up a profile by file extension (e.g., ".ts"). Returns undefined if none matches. */
export function getProfileForFile(filePath: string): LanguageProfile | undefined {
	const ext = path.extname(filePath);
	return byExtension.get(ext);
}

/** Look up a profile by name (e.g., "typescript"). Returns undefined if not found. */
export function getProfileByName(name: string): LanguageProfile | undefined {
	return profiles.find((p) => p.name === name);
}

/** List all registered profiles. */
export function listProfiles(): LanguageProfile[] {
	return [...profiles];
}

/** Detect which profiles apply to a project root (by running each profile's detect()). */
export function detectProfiles(projectRoot: string): LanguageProfile[] {
	return profiles.filter((p) => p.detect(projectRoot));
}
