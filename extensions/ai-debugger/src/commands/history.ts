/**
 * /debug history command — list past debug sessions.
 *
 * Per TODO-3a231913.
 *
 * Shows completed and aborted sessions via `ctx.ui.notify`. The active session
 * is excluded (shown via `/debug status` instead).
 *
 * Example output:
 * ```
 * 📋 Debug History:
 * abc12345 │ ✅ completed │ checkout crash      │ 2 iterations │ Jun 11 14:32
 * def67890 │ ❌ aborted   │ login redirect loop │ 1 iteration  │ Jun 10 09:15
 * ```
 *
 * If no past sessions: "No debug sessions found."
 */

import type { DebugSession, SessionStatus } from "../types.js";

// ── Types ─────────────────────────────────────────────────────────────────

/** A single row in the history table (pre-formatted). */
export interface HistoryRow {
	id: string;
	status: SessionStatus;
	description: string;
	iteration: number;
	createdAt: number;
}

// ── Pure functions (testable without pi) ──────────────────────────────────

/** Status → emoji mapping for the history view. */
const STATUS_EMOJI: Record<SessionStatus, string> = {
	completed: "✅ completed",
	aborted: "❌ aborted",
	active: "🔵 active",
};

/**
 * Format a status as "emoji status" for the history table.
 *
 * @param status - The session status
 * @returns e.g. "✅ completed"
 */
export function formatStatus(status: SessionStatus): string {
	return STATUS_EMOJI[status];
}

/**
 * Format a timestamp as "Mon DD HH:MM" (e.g. "Jun 11 14:32").
 *
 * Uses local time.
 *
 * @param timestampMs - Unix timestamp in milliseconds
 * @returns Short date string, or "?" if unparseable
 */
export function formatDate(timestampMs: number): string {
	if (!timestampMs || isNaN(timestampMs)) return "?";
	const date = new Date(timestampMs);
	const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	const month = months[date.getMonth()];
	const day = String(date.getDate()).padStart(2, "0");
	const hh = String(date.getHours()).padStart(2, "0");
	const mm = String(date.getMinutes()).padStart(2, "0");
	return `${month} ${day} ${hh}:${mm}`;
}

/**
 * Format the iteration count as a singular/plural string.
 *
 * @param iteration - The session's iteration value
 * @returns e.g. "2 iterations" or "1 iteration"
 */
export function formatIterations(iteration: number): string {
	return `${iteration} iteration${iteration === 1 ? "" : "s"}`;
}

/**
 * Truncate a description to a max length, appending "…" if truncated.
 *
 * @param desc - The description string
 * @param maxLen - Maximum length (default 30)
 * @returns Truncated string
 */
export function truncateDescription(desc: string, maxLen = 30): string {
	if (desc.length <= maxLen) return desc;
	return desc.slice(0, maxLen - 1) + "…";
}

/**
 * Filter sessions to only completed/aborted (exclude active).
 *
 * @param sessions - All sessions
 * @returns Sessions with status completed or aborted, sorted newest first
 */
export function filterPastSessions(sessions: DebugSession[]): DebugSession[] {
	return sessions
		.filter((s) => s.status === "completed" || s.status === "aborted");
}

/**
 * Format a single history row as a table line.
 *
 * Format: `{id} │ {emoji status} │ {description} │ {iterations} │ {date}`
 *
 * @param session - The debug session
 * @returns Single-line formatted string
 */
export function formatHistoryRow(session: DebugSession): string {
	return [
		session.id,
		formatStatus(session.status),
		truncateDescription(session.description || "(no description)"),
		formatIterations(session.iteration),
		formatDate(session.createdAt),
	].join(" │ ");
}

/**
 * Build the full history notification text.
 *
 * @param sessions - All sessions (will be filtered to past sessions)
 * @returns Multi-line notification text, or empty-string sentinel for "no sessions"
 */
export function buildHistoryNotification(sessions: DebugSession[]): string {
	const past = filterPastSessions(sessions);

	if (past.length === 0) {
		return "No debug sessions found.";
	}

	const lines: string[] = [];
	lines.push(`📋 Debug History (${past.length} session${past.length === 1 ? "" : "s"}):`);

	for (const session of past) {
		lines.push(formatHistoryRow(session));
	}

	return lines.join("\n");
}
