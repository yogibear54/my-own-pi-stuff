/**
 * Tmux Utilities
 *
 * Helpers for tmux session management used by the parallel deep-dive.
 */

import { execSync } from "node:child_process";

/**
 * Check whether tmux is available on the system.
 */
export function checkTmuxAvailable(): boolean {
	try {
		execSync("which tmux", { stdio: ["pipe", "pipe", "pipe"] });
		return true;
	} catch {
		return false;
	}
}

/**
 * Sanitize a string for use as a tmux session or window name.
 * Removes characters that tmux doesn't accept and truncates to 50 chars.
 */
export function sanitizeTmuxName(name: string): string {
	return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 50);
}
