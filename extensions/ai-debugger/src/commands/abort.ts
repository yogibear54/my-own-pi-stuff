/**
 * /debug abort command — revert all changes and abort session.
 *
 * Per TODO-7767f846.
 *
 * Unlike `/debug cleanup` (which removes instrumentation markers but keeps fixes),
 * abort restores each instrumented file to its pre-instrumentation `originalContent`
 * backup. This reverts ALL changes to those files — both instrumentation and any
 * fixes the LLM applied afterward. Session status → aborted.
 *
 * Scope: Only files tracked in `session.instrumentedFiles` are reverted. Files
 * changed by the LLM but never instrumented are not tracked and would need a
 * separate revert mechanism (e.g., git) — this is acceptable for MVP.
 *
 * Flow:
 * 1. Check for active session
 * 2. Confirm with user (warns that ALL changes are reverted)
 * 3. Restore each InstrumentedFile.originalContent to disk
 * 4. Stop the log collector
 * 5. Set session status to "aborted", phase to "cleanup"
 * 6. Clear the debug widget
 * 7. Show summary
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionStore } from "../session-store.js";
import type { LogCollector } from "../log-collector.js";

// ── Types ─────────────────────────────────────────────────────────────────

/** Dependencies injected into performAbort. */
export interface AbortCommandDeps {
	store: SessionStore;
	collector: LogCollector;
	cwd: string;
}

/** Result of reverting a single file. */
export interface FileRevertResult {
	file: string;
	reverted: boolean;
	/** Reason the file was skipped (undefined if reverted). */
	skipped?: string;
}

/** Full abort summary. */
export interface AbortSummary {
	sessionId: string;
	files: FileRevertResult[];
	/** Number of files successfully reverted. */
	revertedCount: number;
}

// ── Pure functions (testable without pi) ──────────────────────────────────

/**
 * Build the confirmation prompt title for the abort command.
 *
 * @param sessionId - The active debug session ID
 * @returns e.g. "⚠️ Abort session abc123?"
 */
export function buildAbortConfirmationTitle(sessionId: string): string {
	return `⚠️ Abort session ${sessionId}?`;
}

/**
 * Build the confirmation prompt message for the abort command.
 *
 * Warns that ALL changes are reverted (instrumentation + fixes).
 *
 * @returns The confirmation message
 */
export function buildAbortConfirmationMessage(): string {
	return "This reverts ALL changes (instrumentation + fixes) to tracked files and marks the session as aborted.";
}

/**
 * Build the summary notification for the abort command.
 *
 * @param summary - The abort summary
 * @returns Notification text
 */
export function buildAbortNotification(summary: AbortSummary): string {
	const lines: string[] = [];

	if (summary.revertedCount === 0) {
		lines.push(`❌ Session ${summary.sessionId} aborted. No files needed reverting.`);
	} else {
		lines.push(
			`❌ Session ${summary.sessionId} aborted. ${summary.revertedCount} ` +
			`file${summary.revertedCount === 1 ? "" : "s"} reverted to original state.`,
		);
	}

	// List any skipped files
	const skipped = summary.files.filter((f) => !f.reverted);
	for (const f of skipped) {
		lines.push(`⚠ ${f.file} — ${f.skipped}`);
	}

	return lines.join("\n");
}

// ── Core abort logic ──────────────────────────────────────────────────────

/**
 * Perform the full abort: revert files, stop collector, finalize session.
 *
 * @param deps - Store, collector, and working directory
 * @returns Abort summary
 * @throws If no active session
 */
export async function performAbort(deps: AbortCommandDeps): Promise<AbortSummary> {
	const { store, collector, cwd } = deps;

	const session = store.getActive();
	if (!session) {
		throw new Error("No active debug session to abort.");
	}

	const sessionId = session.id;
	const instrumentedFiles = [...session.instrumentedFiles];

	// Restore each file to its pre-instrumentation content
	const files: FileRevertResult[] = [];
	let revertedCount = 0;

	for (const tracked of instrumentedFiles) {
		const absPath = path.resolve(cwd, tracked.path);

		if (!fs.existsSync(absPath)) {
			// File was deleted — nothing to revert, but report it
			files.push({
				file: tracked.path,
				reverted: false,
				skipped: "file no longer exists",
			});
			continue;
		}

		fs.writeFileSync(absPath, tracked.originalContent, "utf-8");
		files.push({ file: tracked.path, reverted: true });
		revertedCount++;
	}

	// Stop the log collector
	await collector.stop();

	// Finalize session: status → aborted, phase → cleanup
	store.update(sessionId, {
		status: "aborted",
		phase: "cleanup",
		instrumentedFiles: [], // cleared — files are reverted
	});

	// Clear active session reference
	store.clearActive();

	return {
		sessionId,
		files,
		revertedCount,
	};
}
