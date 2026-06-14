/**
 * debug_logs tool — query collected runtime logs with filters.
 *
 * Per TODO-9d55b9bb and FR-4.3.
 *
 * Flow:
 * 1. LLM calls this tool with optional filters (hypothesisId, tag, level, since, search, limit)
 * 2. Tool gets the active session ID
 * 3. Tool calls logCollector.getLogs({ sessionId, ...filters })
 * 4. Tool formats entries as readable text (not raw JSON) for the LLM to analyze
 * 5. If no logs found, returns a friendly message suggesting the user reproduce the bug
 *
 * The tool always scopes queries to the active debug session — you only see logs
 * for your current debugging effort. Default limit is 50 to avoid overwhelming
 * the LLM context (per the TODO and LogCollector default).
 */

import { Type } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DebugLogEntry } from "../types.js";
import type { SessionStore } from "../session-store.js";
import type { LogCollector } from "../log-collector.js";
import type { LogFilter } from "../log-collector.js";

// ── Types ─────────────────────────────────────────────────────────────────

/** Parameters the LLM passes to the tool. */
export interface LogsParams {
	hypothesisId?: number;
	tag?: string;
	level?: "debug" | "info" | "warn" | "error";
	since?: string;
	search?: string;
	limit?: number;
}

/** Dependencies injected into the tool factory. */
export interface LogsToolDeps {
	store: SessionStore;
	collector: LogCollector;
}

/** Default number of entries returned when no limit is specified. */
export const DEFAULT_LIMIT = 50;

// ── Parameter schema ──────────────────────────────────────────────────────

export const logsParameters = Type.Object({
	hypothesisId: Type.Optional(Type.Number({ description: "Filter by hypothesis ID" })),
	tag: Type.Optional(Type.String({ description: "Filter by log tag" })),
	level: Type.Optional(
		Type.Union([
			Type.Literal("debug"),
			Type.Literal("info"),
			Type.Literal("warn"),
			Type.Literal("error"),
		]),
	),
	since: Type.Optional(
		Type.String({ description: "ISO 8601 timestamp — only logs after this time" }),
	),
	search: Type.Optional(Type.String({ description: "Free-text search across log data" })),
	limit: Type.Optional(Type.Number({ description: `Max entries to return (default ${DEFAULT_LIMIT})` })),
});

// ── Pure functions (testable without pi) ──────────────────────────────────

/**
 * Format a single log entry as a readable, compact line block.
 *
 * Example:
 * ```
 * [2026-06-14T12:30:45.123Z] #1 src/cart.ts:42 [info] cart_state
 *   { "items": 3, "total": 49.99 }
 * ```
 *
 * @param entry - The log entry to format
 * @returns Two-line readable string (header line + data line)
 */
export function formatLogEntry(entry: DebugLogEntry): string {
	const location = entry.file
		? `${entry.file}${entry.line ? `:${entry.line}` : ""}`
		: "(no location)";
	const header = `[${entry.timestamp}] #${entry.hypothesis} ${location} [${entry.level}] ${entry.tag}`;
	const data = `  ${JSON.stringify(entry.data)}`;
	return `${header}\n${data}`;
}

/**
 * Format the active filters as a readable suffix for the result header.
 *
 * Returns an empty string when no filters are active.
 *
 * @param params - The filter parameters
 * @returns A string like " (filters: hypothesis=1, level=warn)" or ""
 */
export function formatFilters(params: LogsParams): string {
	const parts: string[] = [];
	if (params.hypothesisId !== undefined) parts.push(`hypothesis=${params.hypothesisId}`);
	if (params.tag) parts.push(`tag=${params.tag}`);
	if (params.level) parts.push(`level=${params.level}`);
	if (params.since) parts.push(`since=${params.since}`);
	if (params.search) parts.push(`search="${params.search}"`);
	if (params.limit !== undefined) parts.push(`limit=${params.limit}`);
	return parts.length > 0 ? ` (filters: ${parts.join(", ")})` : "";
}

/**
 * Build the result text when logs are found.
 *
 * Includes a header with count + active filters, then each formatted entry.
 *
 * @param sessionId - The debug session ID
 * @param entries - The log entries (already filtered + limited)
 * @param params - The original filter params (for the header)
 * @returns Multi-line readable text for the LLM
 */
export function buildLogsResult(
	sessionId: string,
	entries: DebugLogEntry[],
	params: LogsParams,
): string {
	const lines: string[] = [];
	lines.push(`${entries.length} log entr${entries.length === 1 ? "y" : "ies"} for session ${sessionId}${formatFilters(params)}`);
	lines.push("");
	for (const entry of entries) {
		lines.push(formatLogEntry(entry));
		lines.push("");
	}
	lines.push("Analyze these logs to confirm or rule out the hypothesis. Call debug_fix when you've identified the root cause.");
	return lines.join("\n");
}

/**
 * Build the message shown when no logs match the query.
 *
 * Distinguishes between "no logs at all" (user hasn't reproduced yet) and
 * "logs exist but filters excluded them" (refine the filters).
 *
 * @param sessionId - The debug session ID
 * @param totalInSession - Total logs in the collector for this session (before filters)
 * @returns A helpful message for the LLM
 */
export function buildNoLogsMessage(sessionId: string, totalInSession: number): string {
	if (totalInSession === 0) {
		return [
			`No logs collected yet for session ${sessionId}.`,
			"",
			"The instrumentation is in place. Ask the user to reproduce the bug so the instrumented code runs and sends data to the collector, then call debug_logs again.",
		].join("\n");
	}
	return [
		`No logs match the current filters for session ${sessionId} (${totalInSession} total log(s) in session).`,
		"",
		"Try broadening your filters — remove the hypothesis, tag, level, or search constraint, or increase the limit.",
	].join("\n");
}

// ── Tool factory ──────────────────────────────────────────────────────────

/**
 * Create the debug_logs tool definition.
 *
 * @param deps - Session store and log collector
 * @returns Tool definition for pi.registerTool()
 */
export function createLogsTool(deps: LogsToolDeps) {
	return {
		name: "debug_logs",
		label: "Debug: Logs",
		description: "Query collected runtime logs with filters. Use after the user reproduces the bug.",
		parameters: logsParameters,
		async execute(
			_toolCallId: string,
			params: LogsParams,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			_ctx: ExtensionContext,
		) {
			// Validate active session exists
			const session = deps.store.getActive();
			if (!session) {
				throw new Error(
					"No active debug session. Run /debug start or call debug_hypothesize first.",
				);
			}

			// Build the filter — always scoped to the active session
			const filter: LogFilter = {
				sessionId: session.id,
				limit: params.limit ?? DEFAULT_LIMIT,
			};
			if (params.hypothesisId !== undefined) filter.hypothesisId = params.hypothesisId;
			if (params.tag) filter.tag = params.tag;
			if (params.level) filter.level = params.level;
			if (params.since) filter.since = params.since;
			if (params.search) filter.search = params.search;

			const entries = deps.collector.getLogs(filter);

			// Total logs in session (unfiltered) — for a better "no results" message
			const totalInSession = deps.collector.getRecent(session.id, Infinity).length;

			let text: string;
			if (entries.length === 0) {
				text = buildNoLogsMessage(session.id, totalInSession);
			} else {
				text = buildLogsResult(session.id, entries, params);
			}

			return {
				content: [{ type: "text" as const, text }],
				details: {
					sessionId: session.id,
					count: entries.length,
					totalInSession,
					filters: params,
				},
			};
		},
	};
}
