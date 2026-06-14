/**
 * Debug session widget — live-updating log feed above the editor.
 *
 * Per TODO-93a3d4fe.
 *
 * MVP scope — no keyboard interactivity, just a live-updating display:
 * - Header bar: `🐛 debug:{id} │ {phase} │ iteration {n}/{max} │ {logCount} logs`
 * - Separator line
 * - Log feed: last 8 log entries, formatted as `HH:MM:ss.mmm level [hN] tag │ data`
 * - Empty state during observe: `⏳ Waiting for logs...`
 * - Completion summary on session end
 * - Color-coded levels: info=default, warn=warning, error=error, debug=dim
 *
 * Architecture:
 * - DebugWidgetManager holds mutable state (session, recent logs, summary)
 * - Pure functions produce structured RenderLine[] ({ text, color? })
 * - index.ts applies theme.fg() colors and calls ctx.ui.setWidget()
 * - Real-time: collector.on('log') → manager.onLog() → re-render
 */

import type { DebugLogEntry, DebugSession, LogLevel, SessionStatus } from "./types.js";
import type { CleanupSummary } from "./tools/cleanup.js";

// ── Constants ─────────────────────────────────────────────────────────────

/** Number of log entries shown in the widget feed. */
export const MAX_FEED_ENTRIES = 8;

// ── Types ─────────────────────────────────────────────────────────────────

/** A renderable line with optional color name (mapped via theme.fg at render time). */
export interface RenderLine {
	text: string;
	/** Theme color name (e.g. "warning", "error", "dim"). Undefined = default text color. */
	color?: string;
}

/** Completion summary shown when a session ends. */
export interface CompletionSummary {
	sessionId: string;
	status: SessionStatus;
	filesCleaned: number;
	logsCollected: number;
	fixCount: number;
}

// ── Pure functions (testable without pi) ──────────────────────────────────

/**
 * Map a log level to a theme color name.
 *
 * @param level - The log level
 * @returns Theme color name, or undefined for default text color
 */
export function levelToColor(level: LogLevel): string | undefined {
	switch (level) {
		case "warn":
			return "warning";
		case "error":
			return "error";
		case "debug":
			return "dim";
		case "info":
		default:
			return undefined; // default text color
	}
}

/**
 * Format a timestamp as HH:MM:SS.mmm (with milliseconds).
 *
 * @param isoTimestamp - ISO 8601 timestamp string
 * @returns e.g. "12:04:32.123"
 */
export function formatWidgetTime(isoTimestamp: string): string {
	const date = new Date(isoTimestamp);
	if (isNaN(date.getTime())) return "??:??:??.???";
	const hh = String(date.getHours()).padStart(2, "0");
	const mm = String(date.getMinutes()).padStart(2, "0");
	const ss = String(date.getSeconds()).padStart(2, "0");
	const ms = String(date.getMilliseconds()).padStart(3, "0");
	return `${hh}:${mm}:${ss}.${ms}`;
}

/**
 * Format a log entry's data as compact key=value pairs.
 *
 * Same format as the /debug logs command (reused here for consistency).
 *
 * @param data - The log entry's data object
 * @returns e.g. "items=3 total=49.99"
 */
export function formatWidgetData(data: Record<string, unknown>): string {
	const entries = Object.entries(data);
	if (entries.length === 0) return "";
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
 * Build the widget header line from a session.
 *
 * Format: `🐛 debug:{id} │ {phase} │ iteration {n}/{max} │ {logCount} logs`
 *
 * @param session - The debug session
 * @returns Header text
 */
export function buildWidgetHeader(session: DebugSession): string {
	return `🐛 debug:${session.id} │ ${session.phase} │ iteration ${session.iteration}/${session.maxIterations} │ ${session.logCount} logs`;
}

/**
 * Format a single log entry as a widget feed line.
 *
 * Format: `HH:MM:SS.mmm level [hN] tag │ data`
 *
 * @param entry - The log entry
 * @returns Formatted line text
 */
export function formatWidgetLogLine(entry: DebugLogEntry): string {
	const time = formatWidgetTime(entry.timestamp);
	const level = entry.level.padEnd(5);
	const data = formatWidgetData(entry.data);
	return `${time} ${level} [h${entry.hypothesis}] ${entry.tag} │ ${data}`;
}

/**
 * Build the structured render lines for the empty state (no logs yet).
 *
 * @returns RenderLine array (header + separator + empty message)
 */
export function buildEmptyStateLines(session: DebugSession): RenderLine[] {
	return [
		{ text: buildWidgetHeader(session) },
		{ text: "─".repeat(50), color: "borderMuted" },
		{ text: "⏳ Waiting for logs... (reproduce the bug to generate log entries)", color: "dim" },
	];
}

/**
 * Build the structured render lines for the active log feed.
 *
 * @param session - The debug session
 * @param recentLogs - Recent log entries (most recent last)
 * @returns RenderLine array (header + separator + log lines)
 */
export function buildFeedLines(session: DebugSession, recentLogs: DebugLogEntry[]): RenderLine[] {
	const lines: RenderLine[] = [
		{ text: buildWidgetHeader(session) },
		{ text: "─".repeat(50), color: "borderMuted" },
	];

	for (const entry of recentLogs) {
		lines.push({
			text: formatWidgetLogLine(entry),
			color: levelToColor(entry.level),
		});
	}

	return lines;
}

/**
 * Build the structured render lines for the completion summary.
 *
 * @param summary - The completion summary
 * @returns RenderLine array (summary lines)
 */
export function buildSummaryLines(summary: CompletionSummary): RenderLine[] {
	const emoji = summary.status === "completed" ? "✅" : "❌";
	const statusWord = summary.status === "completed" ? "completed" : "aborted";
	const lines: RenderLine[] = [
		{ text: `${emoji} Session ${summary.sessionId} ${statusWord}.`, color: summary.status === "completed" ? "success" : "error" },
		{ text: `  ${summary.filesCleaned} file(s) cleaned │ ${summary.logsCollected} logs collected │ ${summary.fixCount} fix(es) applied`, color: "muted" },
	];
	return lines;
}

// ── DebugWidgetManager ────────────────────────────────────────────────────

/**
 * Manages the widget's mutable state and produces render lines.
 *
 * The manager is the single source of truth for what the widget displays:
 * - During an active session: header + log feed (or empty state)
 * - After session end: completion summary
 *
 * The manager does NOT touch the pi API — it only produces RenderLine[].
 * index.ts is responsible for applying colors via theme.fg() and calling
 * ctx.ui.setWidget().
 */
export class DebugWidgetManager {
	private session: DebugSession | null = null;
	private recentLogs: DebugLogEntry[] = [];
	private summary: CompletionSummary | null = null;

	/**
	 * Attach to a session (start showing the widget).
	 *
	 * @param session - The active debug session
	 */
	attach(session: DebugSession): void {
		this.session = session;
		this.recentLogs = [];
		this.summary = null;
	}

	/**
	 * Handle a new log entry from the collector.
	 *
	 * Adds to the recent logs feed (capped at MAX_FEED_ENTRIES).
	 *
	 * @param entry - The new log entry
	 */
	onLog(entry: DebugLogEntry): void {
		this.recentLogs.push(entry);
		while (this.recentLogs.length > MAX_FEED_ENTRIES) {
			this.recentLogs.shift();
		}
	}

	/**
	 * Update the session reference (e.g., after phase changes or log count updates).
	 *
	 * @param session - The updated session
	 */
	updateSession(session: DebugSession): void {
		this.session = session;
	}

	/**
	 * Show a completion summary (replaces the feed).
	 *
	 * @param summary - The completion summary
	 */
	showSummary(summary: CompletionSummary): void {
		this.summary = summary;
	}

	/**
	 * Clear all state (stop showing the widget).
	 */
	clear(): void {
		this.session = null;
		this.recentLogs = [];
		this.summary = null;
	}

	/** Whether the widget has an active session to display. */
	get hasSession(): boolean {
		return this.session !== null;
	}

	/**
	 * Produce the current render lines for the widget.
	 *
	 * Returns an empty array when there's nothing to display (no session attached).
	 *
	 * @returns Structured render lines
	 */
	getLines(): RenderLine[] {
		if (this.summary) {
			return buildSummaryLines(this.summary);
		}

		if (!this.session) {
			return [];
		}

		if (this.recentLogs.length === 0) {
			return buildEmptyStateLines(this.session);
		}

		return buildFeedLines(this.session, this.recentLogs);
	}
}
