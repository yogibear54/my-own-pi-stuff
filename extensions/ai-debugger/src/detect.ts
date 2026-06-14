/**
 * Language auto-detection — scan project for supported language profiles.
 *
 * Per TODO-a85df5b0.
 *
 * Detects which languages a project uses by scanning for manifest files.
 * This is a manifest-based approach (a central mapping table) rather than
 * delegating to each profile's `detect()` method, making it straightforward
 * to add new language support: just add a manifest → profile entry.
 *
 * MVP: only TypeScript/JavaScript is supported. Returns `["typescript"]` or `[]`.
 *
 * Called from `/debug start` to warn users when the project isn't JS/TS.
 * The `debug_instrument` tool validates file extensions separately via
 * `getProfileForFile()` (per-file, not project-level).
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ── Manifest → profile mapping ────────────────────────────────────────────

/**
 * Maps manifest filenames to the profile names they indicate.
 *
 * To add a new language: add its manifest files here and create a profile
 * in `language-profiles/`. For now, only JS/TS is supported.
 *
 * Example future entries (commented out until profiles exist):
 * - "requirements.txt" → "python"
 * - "pyproject.toml" → "python"
 * - "go.mod" → "go"
 * - "Cargo.toml" → "rust"
 */
const MANIFEST_TO_PROFILE: Readonly<Record<string, string>> = {
	"package.json": "typescript",
};

/**
 * Detect supported languages in a project by scanning for manifest files.
 *
 * @param projectRoot - Path to the project root directory
 * @returns Array of detected profile names (e.g. `["typescript"]`), deduplicated
 */
export function detectProjectLanguage(projectRoot: string): string[] {
	const detected = new Set<string>();

	for (const [manifest, profile] of Object.entries(MANIFEST_TO_PROFILE)) {
		if (fs.existsSync(path.join(projectRoot, manifest))) {
			detected.add(profile);
		}
	}

	return [...detected];
}

/**
 * Build the warning message shown when no supported language is detected.
 *
 * @returns The warning text
 */
export function buildNoLanguageWarning(): string {
	return "This project doesn't appear to be JS/TS. The debugger currently only supports JavaScript/TypeScript.";
}

/**
 * Check whether a profile name is supported (has a registered language profile).
 *
 * MVP: only "typescript" is supported. As new profiles are added, update this set.
 *
 * @param profileName - The profile name to check
 * @returns true if the profile is supported
 */
export function isSupportedProfile(profileName: string): boolean {
	return profileName === "typescript";
}
