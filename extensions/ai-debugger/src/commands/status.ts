/**
 * /debug status command — display session state to the user.
 *
 * Per TODO-b0b2561d.
 *
 * Shows a concise, emoji-formatted summary of the active debug session via
 * `ctx.ui.notify`. This is the on-demand status check for the user — the live
 * widget (above the editor) shows the same info continuously during a session.
 *
 * Example output:
 * ```
 * 🐛 debug:abc123 │ ⚡ Observing │ iteration 2/5
 * Hypotheses: 3 (1 instrumented, 1 confirmed, 1 ruled_out)
 * Files: 4 instrumented │ Logs: 47 received │ Fixes: 1 applied
 * ```
 *
 * This is distinct from the `debug_status` tool (LLM-facing, verbose, includes
 * phase hints) and the live widget (always visible during a session).
 */

import type { DebugSession, HypothesisStatus } from "../types.js";

// ── Pure functions (testable without pi) ──────────────────────────────────

/** Phase → emoji + display name mapping for concise status output. */
const PHASE_DISPLAY: Record<DebugSession["phase"], { emoji: string; label: string }> = {
	understand: { emoji: "🔍", label: "Understanding" },
	hypothesize: { emoji: "💡", label: "Hypothesizing" },
	instrument: { emoji: "🔧", label: "Instrumenting" },
	observe: { emoji: "⚡", label: "Observing" },
	fix: { emoji: "🛠", label: "Fixing" },
	verify: { emoji: "✅", label: "Verifying" },
	cleanup: { emoji: "🧹", label: "Cleaning up" },
};

/**
 * Format the phase as "emoji Label" for the status header.
 *
 * @param phase - The session phase
 * @returns e.g. "⚡ Observing"
 */
export function formatPhase(phase: DebugSession["phase"]): string {
	const { emoji, label } = PHASE_DISPLAY[phase];
	return `${emoji} ${label}`;
}

/**
 * Summarize hypothesis statuses as a breakdown string.
 *
 * Lists each non-pending status that has count > 0, e.g. "1 instrumented, 1 confirmed".
 * Returns "none yet" if there are no hypotheses.
 *
 * @param session - The debug session
 * @returns e.g. "3 (1 instrumented, 1 confirmed, 1 ruled_out)" or "0 (none yet)"
 */
export function summarizeHypotheses(session: DebugSession): string {
	const total = session.hypotheses.length;
	if (total === 0) return "0 (none yet — call debug_hypothesize)";

	// Count by status (exclude "pending" from the breakdown — it's the default)
	const statusOrder: HypothesisStatus[] = ["instrumented", "confirmed", "ruled_out"];
	const counts = new Map<HypothesisStatus, number>();
	for (const h of session.hypotheses) {
		counts.set(h.status, (counts.get(h.status) ?? 0) + 1);
	}

	const parts = statusOrder
		.filter((s) => counts.get(s))
		.map((s) => `${counts.get(s)} ${s}`);

	const breakdown = parts.length > 0 ? ` (${parts.join(", ")})` : "";
	return `${total}${breakdown}`;
}

/**
 * Build the concise status notification text for the user.
 *
 * Three-line format:
 * - Session ID, phase (emoji), iteration
 * - Hypotheses summary with status breakdown
 * - Files instrumented, logs received, fixes applied (fixes omitted if 0)
 *
 * @param session - The active debug session
 * @returns Multi-line notification text
 */
export function buildStatusNotification(session: DebugSession): string {
	const lines: string[] = [];

	// Line 1: session ID, phase, iteration
	lines.push(
		`🐛 debug:${session.id} │ ${formatPhase(session.phase)} │ iteration ${session.iteration}/${session.maxIterations}`,
	);

	// Line 2: hypotheses
	lines.push(`Hypotheses: ${summarizeHypotheses(session)}`);

	// Line 3: files, logs, fixes
	const segments = [
		`Files: ${session.instrumentedFiles.length} instrumented`,
		`Logs: ${session.logCount} received`,
	];
	if (session.fixes.length > 0) {
		segments.push(`Fixes: ${session.fixes.length} applied`);
	}
	lines.push(segments.join(" │ "));

	return lines.join("\n");
}
