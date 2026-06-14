/**
 * Session lifecycle hooks — pure functions backing the pi event handlers.
 *
 * Extracted from index.ts so the logic is unit-testable without mocking the pi API.
 * index.ts wires these to `pi.on("session_start" | "session_shutdown" | "before_agent_start")`.
 *
 * Per TODO-67e84dc2:
 * - onSessionStart: restore an active debug session from disk, notify the user
 * - onSessionShutdown: persist active session, warn about uncleaned instrumentation, stop collector
 * - onBeforeAgentStart: inject a debug-state context message so the LLM knows the debug state
 */

import type { SessionStore } from "./session-store.js";
import type { LogCollector } from "./log-collector.js";
import type { DebugSession } from "./types.js";

// ── Shared types ───────────────────────────────────────────────────────────

export interface Notification {
	message: string;
	level: "info" | "warning";
}

export interface LifecycleDeps {
	store: SessionStore;
	collector: LogCollector;
	/** Whether to display the debug-state context message in the conversation UI. */
	showDebugContextMessage: boolean;
}

// ── Hook: session_start ────────────────────────────────────────────────────

export interface SessionStartResult {
	/** Notification to show to the user (undefined if nothing to restore). */
	notification?: Notification;
}

/**
 * Restore an active debug session from disk if one exists.
 *
 * Called on `session_start`. If the user had an active debug session when pi
 * previously exited (crash or unexpected close), this finds it on disk and
 * restores it to the SessionStore so the extension can continue tracking it.
 *
 * @returns A notification to display, or undefined if no session to restore.
 */
export function onSessionStart(deps: LifecycleDeps): SessionStartResult {
	const existing = deps.store.findActiveOnDisk();
	if (!existing) return {};

	deps.store.restore(existing);
	return {
		notification: {
			message: `🐛 Restored debug session: ${existing.id} (${existing.phase})`,
			level: "info",
		},
	};
}

// ── Hook: session_shutdown ─────────────────────────────────────────────────

export interface SessionShutdownResult {
	/** Warning to show if instrumentation remains uncleaned (undefined otherwise). */
	notification?: Notification;
}

/**
 * Persist active session, warn about uncleaned instrumentation, stop the collector.
 *
 * Called on `session_shutdown`. Ensures the session state is written to disk
 * (crash recovery), warns the user if instrumentation is still in place, and
 * shuts down the log collector server.
 */
export async function onSessionShutdown(deps: LifecycleDeps): Promise<SessionShutdownResult> {
	const session = deps.store.getActive();
	let notification: Notification | undefined;

	if (session && session.status === "active") {
		deps.store.persist(session);
		const fileCount = session.instrumentedFiles.length;
		if (fileCount > 0) {
			notification = {
				message: `⚠️ Debug session ${session.id} is still active with instrumentation in ${fileCount} file(s). Run /debug cleanup before exiting.`,
				level: "warning",
			};
		}
	}

	await deps.collector.stop();
	return { notification };
}

// ── Hook: before_agent_start ───────────────────────────────────────────────

/** The return shape pi expects from `before_agent_start` to inject a message. */
export interface InjectedMessage {
	message: {
		customType: string;
		content: string;
		display: boolean;
	};
}

/**
 * Build a debug-state context message for the LLM.
 *
 * Called on `before_agent_start`. When a debug session is active, injects a
 * message summarizing the session state (phase, iteration, hypotheses, etc.)
 * so the LLM knows it's in a debugging workflow. The message is always sent to
 * the LLM; `showDebugContextMessage` controls whether it's also displayed in
 * the conversation UI.
 *
 * @returns The message to inject, or undefined if no active session.
 */
export function onBeforeAgentStart(deps: LifecycleDeps): InjectedMessage | undefined {
	const session = deps.store.getActive();
	if (!session || session.status !== "active") return undefined;

	return {
		message: {
			customType: "ai-debugger",
			content: buildDebugContextMessage(session),
			display: deps.showDebugContextMessage,
		},
	};
}

/**
 * Build the human/LLM-readable debug-state summary.
 *
 * Exported for testing.
 */
export function buildDebugContextMessage(session: DebugSession): string {
	const lines: string[] = [];

	if (session.description) {
		lines.push(`Bug: ${session.description}`);
	}
	lines.push(`🐛 Active debug session: ${session.id}`);
	lines.push(`Phase: ${session.phase}`);
	lines.push(`Iteration: ${session.iteration}/${session.maxIterations}`);
	lines.push(`Hypotheses: ${session.hypotheses.length}`);
	lines.push(`Instrumented files: ${session.instrumentedFiles.length}`);
	lines.push(`Logs collected: ${session.logCount}`);

	if (session.confirmedHypothesis !== undefined) {
		lines.push(`Confirmed hypothesis: #${session.confirmedHypothesis}`);
	}

	return lines.join("\n");
}
