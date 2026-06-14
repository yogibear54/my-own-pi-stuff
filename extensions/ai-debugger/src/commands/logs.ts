/**
 * /debug logs command — show recent log entries to the user.
 *
 * Per TODO-e2a2d95d.
 *
 * Shows the last 20 log entries for the active session via `ctx.ui.notify`.
 * This is the on-demand log viewer for the user — the `debug_logs` tool is the
 * LLM's query interface (with full filtering).
 *
 * Example output:
 * ```
 * 📋 Last 20 logs for session abc123:
 * 12:04:32 info  [h1] cart_state      │ items=3 total=49.99
 * 12:04:33 error [h3] payment_timeout │ duration=30125ms
 * ... (47 total entries. Use debug_logs tool for full access.)
 * ```
 *
 * If no logs: "No logs received yet. Reproduce the bug to generate entries."
 */

import type { DebugLogEntry } from "../types.js";

// ── Constants ─────────────────────────────────────────────────────────────

/** Number of recent entries to display. */
export const RECENT_LOG_COUNT = 20;

// ── Pure functions (testable without pi) ──────────────────────────────────

/**
 * Format a log entry's timestamp as HH:MM:SS.
 *
 * @param isoTimestamp - ISO 8601 timestamp string
 * @returns e.g. "12:04:32", or the raw string if unparseable
 */
export function formatTime(isoTimestamp: string): string {
	const date = new Date(isoTimestamp);
	if (isNaN(date.getTime())) return isoTimestamp;
	const hh = String(date.getHours()).padStart(2, "0");
	const mm = String(date.getMinutes()).padStart(2, "0");
	const ss = String(date.getSeconds()).padStart(2, "0");
	return `${hh}:${mm}:${ss}`;
}

/**
 * Format a log entry's data object as compact key=value pairs.
 *
 * Nested objects/arrays are JSON-stringified. Primitive values are shown directly.
 *
 * @param data - The log entry's data object
 * @returns e.g. "items=3 total=49.99", or "(empty)" if no data
 */
export function formatData(data: Record<string, unknown>): string {
	const entries = Object.entries(data);
	if (entries.length === 0) return "(empty)";

	return entries
		.map(([key, value]) => {
			const formatted =
				typeof value === "object" && value !== null
					? JSON.stringify(value)
					: String(value);
			return `${key}=${formatted}`;
		})
		.join(" ");
}

/**
 * Format a single log entry as a compact line.
 *
 * Format: `HH:MM:SS level [hN] tag │ data`
 *
 * The level is left-padded to 5 chars for column alignment.
 *
 * @param entry - The log entry
 * @returns Single-line formatted string
 */
export function formatLogLine(entry: DebugLogEntry): string {
	const time = formatTime(entry.timestamp);
	const level = entry.level.padEnd(5);
	const hyp = `[h${entry.hypothesis}]`;
	const tag = entry.tag;
	const data = formatData(entry.data);
	return `${time} ${level} ${hyp} ${tag} │ ${data}`;
}

/**
 * Build the full notification text for the /debug logs command.
 *
 * Shows the last N entries, with a footer noting the total count and pointing
 * to the debug_logs tool for full access.
 *
 * @param sessionId - The active debug session ID
 * @param entries - The recent log entries (chronological order)
 * @param totalCount - Total log entries for the session
 * @returns Multi-line notification text
 */
export function buildLogsNotification(
	sessionId: string,
	entries: DebugLogEntry[],
	totalCount: number,
): string {
	if (entries.length === 0) {
		return "No logs received yet. Reproduce the bug to generate entries.";
	}

	const lines: string[] = [];
	lines.push(`📋 Last ${entries.length} log${entries.length === 1 ? "" : "s"} for session ${sessionId}:`);

	for (const entry of entries) {
		lines.push(formatLogLine(entry));
	}

	// Footer with total count (only if there are more than what's shown)
	if (totalCount > entries.length) {
		lines.push(`... (${totalCount} total entries. Use debug_logs tool for full access.)`);
	}

	return lines.join("\n");
}
