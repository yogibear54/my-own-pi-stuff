/**
 * Config Utilities for persistence
 *
 * Shared utilities for loading/saving JSON config files.
 * Supports project-level (takes precedence) and global fallback.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const GLOBAL_CONFIG_DIR = join(homedir(), ".pi", "agent");

/**
 * Get config path: project-level takes precedence over global
 */
export function getConfigPath(configName: string, cwd: string = process.cwd()): string {
	const projectPath = join(cwd, ".pi", "agent", configName);
	if (existsSync(projectPath)) {
		return projectPath;
	}
	return join(GLOBAL_CONFIG_DIR, configName);
}

/**
 * Load config file, returning undefined if not found or invalid
 */
export function loadConfig(configName: string, cwd: string = process.cwd()): Record<string, unknown> | undefined {
	const configPath = getConfigPath(configName, cwd);
	try {
		if (!existsSync(configPath)) {
			return undefined;
		}
		const raw = readFileSync(configPath, "utf-8");
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

/**
 * Save config file to appropriate location (project-level if exists, else global)
 */
export function saveConfig(configName: string, data: Record<string, unknown>, cwd: string = process.cwd()): void {
	try {
		mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
		const configPath = getConfigPath(configName, cwd);
		writeFileSync(configPath, JSON.stringify(data, null, "\t") + "\n");
	} catch {
		// Silently ignore file write errors
	}
}

/**
 * Get disabled items from config (e.g., from { "disabled": ["a", "b"] })
 */
export function getDisabledFromConfig(configName: string, cwd: string = process.cwd()): string[] {
	const config = loadConfig(configName, cwd);
	if (config && Array.isArray(config.disabled)) {
		return config.disabled;
	}
	return [];
}

/**
 * Save disabled items to config
 */
export function saveDisabledToConfig(configName: string, disabled: string[], cwd: string = process.cwd()): void {
	saveConfig(configName, { disabled }, cwd);
}
