/**
 * debug_cleanup tool — remove all instrumentation, keep fixes.
 *
 * Per TODO-7953f604 and FR-6.
 *
 * Flow:
 * 1. Get the session (by ID or active)
 * 2. For each instrumented file: read current content, remove all lines
 *    between `__AI_DEBUG_START__` and `__AI_DEBUG_END__` markers (inclusive)
 * 3. Write cleaned file back to disk
 * 4. Verify no markers remain (fix code is intact — only marker blocks removed)
 * 5. Stop the log collector
 * 6. Set session status to "completed", phase to "cleanup"
 * 7. Clear the active session reference (allows a new session)
 * 8. Return summary: files cleaned, blocks removed, logs collected, fix retained, duration
 *
 * Marker removal is profile-agnostic — it scans for the universal
 * `__AI_DEBUG_START__` / `__AI_DEBUG_END__` sentinels, not language-specific
 * comment syntax. This makes cleanup robust against line shifts caused by
 * subsequent edits (the LLM's fix may have shifted lines relative to the
 * original InstrumentedFile.changes ranges).
 *
 * The shared `performCleanup` function is callable from both the tool and the
 * `/debug cleanup` command.
 */

import { Type } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionStore } from "../session-store.js";
import type { LogCollector } from "../log-collector.js";
import { scanInstrumentedChanges } from "./instrument.js";

// ── Types ─────────────────────────────────────────────────────────────────

/** Parameters the LLM passes to the tool. */
export interface CleanupParams {
	sessionId?: string;
}

/** Dependencies injected into the tool factory / performCleanup. */
export interface CleanupToolDeps {
	store: SessionStore;
	collector: LogCollector;
	cwd: string;
}

/** Result of cleaning a single file. */
export interface FileCleanupResult {
	file: string;
	/** True if marker blocks were found and removed. */
	cleaned: boolean;
	/** Number of marker blocks removed. */
	blocksRemoved: number;
	/** Reason the file was skipped (undefined if cleaned). */
	skipped?: string;
}

/** Full cleanup summary. */
export interface CleanupSummary {
	sessionId: string;
	files: FileCleanupResult[];
	totalBlocksRemoved: number;
	logsCollected: number;
	fixCount: number;
	fixFiles: string[];
	/** Duration of the debugging session in ms (createdAt → cleanup). */
	durationMs: number;
}

// ── Parameter schema ──────────────────────────────────────────────────────

export const cleanupParameters = Type.Object({
	sessionId: Type.Optional(
		Type.String({ description: "Session to clean up (defaults to the active session)" }),
	),
});

// ── Pure functions (testable without pi) ──────────────────────────────────

/**
 * Remove all `__AI_DEBUG_START__` ... `__AI_DEBUG_END__` marker blocks from content.
 *
 * Removes the START line, END line, and everything between them (inclusive).
 * Profile-agnostic — works with any comment syntax because it looks for the
 * universal marker sentinels.
 *
 * Handles nested/malformed markers conservatively: a START without a matching
 * END removes from START to end of file.
 *
 * @param content - File content to clean
 * @returns The cleaned content and the number of marker blocks removed
 */
export function removeInstrumentation(content: string): { content: string; blocksRemoved: number } {
	const lines = content.split("\n");
	const result: string[] = [];
	let blocksRemoved = 0;
	let inBlock = false;

	for (const line of lines) {
		if (!inBlock && line.includes("__AI_DEBUG_START__")) {
			inBlock = true;
			blocksRemoved++;
			continue; // skip the START line
		}
		if (inBlock) {
			if (line.includes("__AI_DEBUG_END__")) {
				inBlock = false;
			}
			continue; // skip lines inside the block (including the END line)
		}
		result.push(line);
	}

	return { content: result.join("\n"), blocksRemoved };
}

/**
 * Build the result text returned to the LLM after cleanup.
 *
 * Summarizes files cleaned, blocks removed, logs collected, fixes retained,
 * and session duration.
 *
 * @param summary - The cleanup summary
 * @returns Multi-line readable text for the LLM
 */
export function buildCleanupResult(summary: CleanupSummary): string {
	const lines: string[] = [];
	lines.push(`Cleanup complete for session ${summary.sessionId}.`);
	lines.push("");

	const cleaned = summary.files.filter((f) => f.cleaned);
	const skipped = summary.files.filter((f) => !f.cleaned);

	if (cleaned.length > 0) {
		lines.push(`Removed instrumentation from ${cleaned.length} file(s) (${summary.totalBlocksRemoved} log block(s)):`);
		for (const f of cleaned) {
			lines.push(`  ✓ ${f.file} — ${f.blocksRemoved} block(s)`);
		}
	} else {
		lines.push("No instrumentation found to remove (files were already clean).");
	}

	for (const f of skipped) {
		lines.push(`  ⊘ ${f.file} — ${f.skipped}`);
	}

	lines.push("");
	lines.push(`Logs collected: ${summary.logsCollected}`);
	lines.push(`Fixes retained: ${summary.fixCount} (${summary.fixFiles.length} file(s): ${summary.fixFiles.join(", ") || "none"})`);
	lines.push(`Duration: ${formatDuration(summary.durationMs)}`);
	lines.push("");
	lines.push("Session status: completed. Debugging workflow finished.");
	return lines.join("\n");
}

/**
 * Format milliseconds as a human-readable duration string.
 *
 * @param ms - Duration in milliseconds
 * @returns e.g. "1m 30s", "45s", "200ms"
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

// ── Core cleanup logic (shared by tool + command) ─────────────────────────

/**
 * Perform the full cleanup: remove instrumentation, stop collector, finalize session.
 *
 * This is the shared entry point used by both the `debug_cleanup` tool and the
 * `/debug cleanup` command.
 *
 * @param deps - Store, collector, and working directory
 * @param sessionId - Optional session ID (defaults to the active session)
 * @returns Cleanup summary
 * @throws If the session is not found
 */
export async function performCleanup(
	deps: CleanupToolDeps,
	sessionId?: string,
): Promise<CleanupSummary> {
	const { store, collector, cwd } = deps;

	// Resolve session
	const session = sessionId ? store.get(sessionId) : store.getActive();
	if (!session) {
		throw new Error(
			sessionId
				? `Session not found: ${sessionId}`
				: "No active debug session. Run /debug start or call debug_hypothesize first.",
		);
	}

	// Capture session data before clearing (for the summary)
	const sessionId_ = session.id;
	const createdAt = session.createdAt;
	const logsCollected = session.logCount;
	const fixCount = session.fixes.length;
	const fixFiles = [...new Set(session.fixes.flatMap((f) => f.files.map((ff) => ff.path)))];
	const instrumentedFiles = [...session.instrumentedFiles];

	// Remove instrumentation from each tracked file
	const fileResults: FileCleanupResult[] = [];
	let totalBlocksRemoved = 0;

	for (const tracked of instrumentedFiles) {
		const absPath = path.resolve(cwd, tracked.path);

		if (!fs.existsSync(absPath)) {
			fileResults.push({
				file: tracked.path,
				cleaned: false,
				blocksRemoved: 0,
				skipped: "file not found (may have been deleted)",
			});
			continue;
		}

		const content = fs.readFileSync(absPath, "utf-8");
		const { content: cleanedContent, blocksRemoved } = removeInstrumentation(content);

		if (blocksRemoved === 0) {
			fileResults.push({
				file: tracked.path,
				cleaned: false,
				blocksRemoved: 0,
				skipped: "no markers found (already clean)",
			});
			continue;
		}

		// Verify no markers remain after removal (fix verification)
		const remaining = scanInstrumentedChanges(cleanedContent);
		if (remaining.length > 0) {
			// Orphaned markers — write anyway but flag the issue
			fileResults.push({
				file: tracked.path,
				cleaned: true,
				blocksRemoved: blocksRemoved - remaining.length,
				skipped: `⚠ ${remaining.length} orphaned marker(s) could not be removed`,
			});
		} else {
			fileResults.push({
				file: tracked.path,
				cleaned: true,
				blocksRemoved,
			});
		}

		fs.writeFileSync(absPath, cleanedContent, "utf-8");
		totalBlocksRemoved += blocksRemoved;
	}

	// Stop the log collector
	await collector.stop();

	// Finalize session: status → completed, phase → cleanup
	store.update(sessionId_, {
		status: "completed",
		phase: "cleanup",
		instrumentedFiles: [], // cleared — instrumentation is removed
	});

	// Clear active session reference (allows a new session)
	store.clearActive();

	return {
		sessionId: sessionId_,
		files: fileResults,
		totalBlocksRemoved,
		logsCollected,
		fixCount,
		fixFiles,
		durationMs: Date.now() - createdAt,
	};
}

// ── Tool factory ──────────────────────────────────────────────────────────

/**
 * Create the debug_cleanup tool definition.
 *
 * @param deps - Session store, log collector, and working directory
 * @returns Tool definition for pi.registerTool()
 */
export function createCleanupTool(deps: CleanupToolDeps) {
	return {
		name: "debug_cleanup",
		label: "Debug: Cleanup",
		description:
			"Remove all injected instrumentation from the codebase, keeping only verified fixes. " +
			"Call when the bug is confirmed fixed. Shuts down the log collector.",
		parameters: cleanupParameters,
		async execute(
			_toolCallId: string,
			params: CleanupParams,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			_ctx: ExtensionContext,
		) {
			const summary = await performCleanup(deps, params.sessionId);
			const resultText = buildCleanupResult(summary);

			return {
				content: [{ type: "text" as const, text: resultText }],
				details: summary,
			};
		},
	};
}
