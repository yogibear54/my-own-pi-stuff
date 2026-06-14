/**
 * debug_status tool — return the current debug session state for the LLM.
 *
 * Per TODO-ad549e5b.
 *
 * A read-only query tool. Returns the full structured state of the active debug
 * session so the LLM knows where it is in the debugging workflow (phase,
 * iteration, hypotheses, instrumentation, logs, fixes). The LLM calls this to
 * orient itself — e.g., at the start of a turn or after compaction.
 *
 * This is distinct from the `/debug status` command (user-facing, for the UI).
 * The tool formats output for LLM consumption (structured text + details).
 */

import { Type } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DebugSession, Hypothesis } from "../types.js";
import type { SessionStore } from "../session-store.js";

// ── Types ─────────────────────────────────────────────────────────────────

/** Dependencies injected into the tool factory. */
export interface StatusToolDeps {
	store: SessionStore;
}

// ── Parameter schema ──────────────────────────────────────────────────────

export const statusParameters = Type.Object({});

// ── Pure functions (testable without pi) ──────────────────────────────────

/**
 * Format a single hypothesis as a one-line status summary.
 *
 * Example: `#1 [high] Race condition in cart.update() — instrumented`
 *
 * @param h - The hypothesis to format
 * @returns Single-line status string
 */
export function formatHypothesisStatus(h: Hypothesis): string {
	return `  #${h.id} [${h.confidence}] ${h.description} — ${h.status}`;
}

/**
 * Build the result text returned to the LLM for an active session.
 *
 * Includes all state the LLM needs to orient: phase, iteration, hypotheses
 * with their statuses, instrumentation count, log count, and fixes applied.
 *
 * @param session - The active debug session
 * @returns Multi-line readable text for the LLM
 */
export function buildStatusResult(session: DebugSession): string {
	const lines: string[] = [];

	lines.push(`Debug session ${session.id} — phase: ${session.phase}`);
	lines.push(`Iteration ${session.iteration}/${session.maxIterations} — status: ${session.status}`);
	lines.push("");

	if (session.description) {
		lines.push(`Bug: ${session.description}`);
		lines.push("");
	}

	// Hypotheses
	lines.push(`Hypotheses (${session.hypotheses.length}):`);
	if (session.hypotheses.length === 0) {
		lines.push("  (none yet — call debug_hypothesize to generate)");
	} else {
		for (const h of session.hypotheses) {
			lines.push(formatHypothesisStatus(h));
		}
	}
	lines.push("");

	// Instrumentation
	lines.push(`Instrumented files: ${session.instrumentedFiles.length}`);
	lines.push(`Logs collected: ${session.logCount}`);
	lines.push("");

	// Fixes
	lines.push(`Fixes applied: ${session.fixes.length}`);
	for (const fix of session.fixes) {
		const feedback = fix.userFeedback ? ` [${fix.userFeedback}]` : "";
		const verified = fix.verified ? " ✓" : "";
		lines.push(`  iteration ${fix.iteration}, hypothesis #${fix.hypothesisId}${verified}${feedback}`);
	}

	// Confirmed hypothesis
	if (session.confirmedHypothesis !== undefined) {
		lines.push("");
		lines.push(`Confirmed hypothesis: #${session.confirmedHypothesis}`);
	}

	// Next-step hint based on phase
	lines.push("");
	lines.push(buildPhaseHint(session.phase));

	return lines.join("\n");
}

/**
 * Build a short next-step hint for the LLM based on the current phase.
 *
 * @param phase - The current session phase
 * @returns A one-line hint string
 */
export function buildPhaseHint(phase: DebugSession["phase"]): string {
	switch (phase) {
		case "understand":
			return "Next: analyze the codebase and call debug_hypothesize with ranked hypotheses.";
		case "hypothesize":
			return "Next: call debug_instrument for the hypothesis you want to investigate.";
		case "instrument":
			return "Instrumentation in progress. Next: ask the user to reproduce the bug.";
		case "observe":
			return "Instrumentation active. Next: ask the user to reproduce the bug, then call debug_logs.";
		case "fix":
			return "Root cause identified. Next: apply the fix with the edit tool, then call debug_fix.";
		case "verify":
			return "Fix applied. Next: ask the user to retest. If fixed, call debug_cleanup.";
		case "cleanup":
			return "Session is cleaning up or completed. No further action needed.";
	}
}

// ── Tool factory ──────────────────────────────────────────────────────────

/**
 * Create the debug_status tool definition.
 *
 * @param deps - Session store
 * @returns Tool definition for pi.registerTool()
 */
export function createStatusTool(deps: StatusToolDeps) {
	return {
		name: "debug_status",
		label: "Debug: Status",
		description:
			"Return the current debug session state: phase, iteration, hypotheses, files modified, log count.",
		parameters: statusParameters,
		async execute(
			_toolCallId: string,
			_params: Record<string, never>,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			_ctx: ExtensionContext,
		) {
			const session = deps.store.getActive();

			if (!session) {
				return {
					content: [
						{
							type: "text" as const,
							text: "No active debug session. Run /debug start or call debug_hypothesize to begin.",
						},
					],
					details: { active: false },
				};
			}

			const text = buildStatusResult(session);

			return {
				content: [{ type: "text" as const, text }],
				details: {
					active: true,
					sessionId: session.id,
					phase: session.phase,
					iteration: session.iteration,
					maxIterations: session.maxIterations,
					status: session.status,
					hypothesisCount: session.hypotheses.length,
					hypotheses: session.hypotheses.map((h) => ({
						id: h.id,
						description: h.description,
						confidence: h.confidence,
						status: h.status,
					})),
					instrumentedFileCount: session.instrumentedFiles.length,
					logCount: session.logCount,
					fixCount: session.fixes.length,
					confirmedHypothesis: session.confirmedHypothesis,
				},
			};
		},
	};
}
