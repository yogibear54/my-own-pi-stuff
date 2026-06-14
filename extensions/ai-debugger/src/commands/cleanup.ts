/**
 * /debug cleanup command — user-initiated instrumentation removal.
 *
 * Per TODO-5a3274e7.
 *
 * This module provides the user-facing formatting for the /debug cleanup command.
 * The core cleanup logic (`performCleanup`) lives in `src/tools/cleanup.ts` and
 * is shared with the `debug_cleanup` tool.
 *
 * The command handler in index.ts:
 * 1. Checks for an active session (notify "no session" if none)
 * 2. Confirms with the user via `ctx.ui.confirm`
 * 3. Runs `performCleanup` (removes markers, stops collector, finalizes session)
 * 4. Shows a concise summary notification
 * 5. Clears the debug widget
 *
 * This module provides the testable formatting functions for steps 2 and 4.
 */

import type { CleanupSummary } from "../tools/cleanup.js";

// ── Pure functions (testable without pi) ──────────────────────────────────

/**
 * Build the confirmation prompt title for the cleanup command.
 *
 * @param sessionId - The active debug session ID
 * @returns e.g. "Clean up instrumentation from session abc123?"
 */
export function buildCleanupConfirmationTitle(sessionId: string): string {
	return `Clean up instrumentation from session ${sessionId}?`;
}

/**
 * Build the confirmation prompt message for the cleanup command.
 *
 * Explains what cleanup does: removes debug logging but keeps applied fixes.
 *
 * @returns The confirmation message
 */
export function buildCleanupConfirmationMessage(): string {
	return "This removes all debug logging but keeps any applied fixes.";
}

/**
 * Build the concise success notification for the cleanup command.
 *
 * Format: "✅ Cleaned up {N} file(s). Session {id} completed."
 *
 * If there were failures, appends a warning about skipped files.
 *
 * @param summary - The cleanup summary from performCleanup
 * @returns Concise notification text
 */
export function buildCleanupNotification(summary: CleanupSummary): string {
	const cleanedCount = summary.files.filter((f) => f.cleaned).length;
	const skippedCount = summary.files.length - cleanedCount;

	const lines: string[] = [];
	lines.push(`✅ Cleaned up ${cleanedCount} file${cleanedCount === 1 ? "" : "s"}. Session ${summary.sessionId} completed.`);

	if (skippedCount > 0) {
		lines.push(`⚠ ${skippedCount} file${skippedCount === 1 ? "" : "s"} skipped (see debug_status for details).`);
	}

	if (summary.totalBlocksRemoved > 0) {
		lines.push(`Removed ${summary.totalBlocksRemoved} instrumentation block${summary.totalBlocksRemoved === 1 ? "" : "s"}.`);
	}

	if (summary.fixCount > 0) {
		lines.push(`Fixes retained: ${summary.fixCount}.`);
	}

	return lines.join("\n");
}
