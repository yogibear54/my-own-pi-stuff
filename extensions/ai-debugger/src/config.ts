/**
 * Configuration loading for the AI Debugger extension.
 *
 * Reads `.pi/debug-config.json` from the project root and merges with defaults.
 * Unknown keys are silently ignored (forward-compatible). Values of the wrong
 * type fall back to defaults rather than throwing.
 *
 * Per Section 10 of REQUIREMENTS.md.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ── Types ──────────────────────────────────────────────────────────────────

export interface DebugConfig {
	/** Port for the local log collector HTTP server. Default: 19847 */
	port: number;
	/** Max fix attempts before giving up. Default: 5 */
	maxIterations: number;
	/** Max log entries held in memory per session. Default: 10000 */
	maxLogEntries: number;
}

// ── Defaults ───────────────────────────────────────────────────────────────

export const DEFAULTS: Readonly<DebugConfig> = {
	port: 19847,
	maxIterations: 5,
	maxLogEntries: 10000,
};

// ── Loader ─────────────────────────────────────────────────────────────────

/**
 * Load debug configuration from `.pi/debug-config.json`.
 *
 * @param cwd - Project root directory (where `.pi/` lives)
 * @returns Merged config (user values where valid, defaults elsewhere)
 * @throws If the file exists but contains invalid JSON or a non-object value
 */
export function loadConfig(cwd: string): DebugConfig {
	const configPath = path.join(cwd, ".pi", "debug-config.json");

	if (!fs.existsSync(configPath)) {
		return { ...DEFAULTS };
	}

	let raw: string;
	try {
		raw = fs.readFileSync(configPath, "utf-8");
	} catch (err) {
		throw new Error(
			`Failed to read debug config at ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new Error(
			`Invalid JSON in debug config at ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error(`Debug config at ${configPath} must be a JSON object, got ${typeof parsed}`);
	}

	// Merge: use user value if correct type, otherwise fall back to default
	const user = parsed as Record<string, unknown>;
	return {
		port: typeof user.port === "number" ? user.port : DEFAULTS.port,
		maxIterations:
			typeof user.maxIterations === "number" ? user.maxIterations : DEFAULTS.maxIterations,
		maxLogEntries:
			typeof user.maxLogEntries === "number" ? user.maxLogEntries : DEFAULTS.maxLogEntries,
	};
}
