/**
 * debug_fix tool — record an applied fix separately from instrumentation.
 *
 * Per TODO-8f058f8a and FR-5.
 *
 * Flow:
 * 1. LLM applies the actual code fix using pi's built-in `edit` tool
 * 2. LLM calls this tool to RECORD the fix (what it did, which files it changed)
 * 3. Tool records the fix in session.fixes as an AppliedFix (verified=false)
 * 4. Tool sets session phase to "verify"
 * 5. Tool increments session.iteration (the fix belongs to the current iteration)
 * 6. Tool returns confirmation + a prompt for the user to retest
 *
 * Separation of concerns: instrumentation code stays in place (the log collector
 * is still running) so that during the verify step the user can reproduce the bug
 * and confirm whether the fix worked. The fix is tracked separately from
 * instrumentation so that `debug_cleanup` knows what to keep (the fix) vs. what
 * to remove (the instrumentation markers).
 *
 * The tool does NOT edit any files — the LLM uses the built-in `edit` tool for that.
 */

import { Type } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AppliedFix, AppliedFixFile } from "../types.js";
import type { SessionStore } from "../session-store.js";

// ── Types ─────────────────────────────────────────────────────────────────

/** Parameters the LLM passes to the tool. */
export interface FixParams {
	hypothesisId: number;
	description: string;
	files: AppliedFixFile[];
}

/** Dependencies injected into the tool factory. */
export interface FixToolDeps {
	store: SessionStore;
}

// ── Parameter schema ──────────────────────────────────────────────────────

export const fixParameters = Type.Object({
	hypothesisId: Type.Number({ description: "The hypothesis ID this fix addresses" }),
	description: Type.String({ description: "What the fix does and why" }),
	files: Type.Array(
		Type.Object({
			path: Type.String({ description: "File that was modified" }),
			changes: Type.String({ description: "Description of the changes made" }),
		}),
		{ minItems: 1, description: "Files changed by this fix" },
	),
});

// ── Pure functions (testable without pi) ──────────────────────────────────

/**
 * Build an AppliedFix object from the LLM's input.
 *
 * Tags the fix with the current iteration number and marks it as unverified.
 * The verify step (user retest) sets verified=true and records userFeedback.
 *
 * @param iteration - Current session iteration number (the fix belongs to this attempt)
 * @param hypothesisId - The hypothesis this fix targets
 * @param files - Files changed by the fix
 * @returns An AppliedFix ready to store in session.fixes
 */
export function toAppliedFix(
	iteration: number,
	hypothesisId: number,
	files: AppliedFixFile[],
): AppliedFix {
	return {
		iteration,
		hypothesisId,
		files,
		verified: false,
	};
}

/**
 * Format a single fix's file list for display.
 *
 * @param files - The fix's changed files
 * @returns Array of formatted lines
 */
export function formatFixFiles(files: AppliedFixFile[]): string[] {
	return files.map((f) => `  • ${f.path}: ${f.changes}`);
}

/**
 * Build the result text returned to the LLM after recording a fix.
 *
 * Confirms the fix was recorded, shows what was changed, and prompts the user
 * to retest so the fix can be verified.
 *
 * @param sessionId - The debug session ID
 * @param fix - The recorded AppliedFix
 * @param nextIteration - The session's iteration AFTER incrementing
 * @returns Multi-line readable text for the LLM
 */
export function buildFixResult(
	sessionId: string,
	fix: AppliedFix,
	nextIteration: number,
): string {
	const lines: string[] = [];
	lines.push(`Fix recorded in session ${sessionId} (iteration ${fix.iteration}).`);
	lines.push("");
	lines.push(`Hypothesis #${fix.hypothesisId}:`);
	lines.push(`  Applied ${fix.files.length} change(s):`);
	lines.push(...formatFixFiles(fix.files));
	lines.push("");
	lines.push("Phase set to verify.");
	lines.push("Instrumentation is still in place — the user should retest now.");
	lines.push("After retest: if the bug is fixed, call debug_cleanup. If not, analyze the new logs and try again.");
	return lines.join("\n");
}

// ── Tool factory ──────────────────────────────────────────────────────────

/**
 * Create the debug_fix tool definition.
 *
 * @param deps - Session store
 * @returns Tool definition for pi.registerTool()
 */
export function createFixTool(deps: FixToolDeps) {
	return {
		name: "debug_fix",
		label: "Debug: Fix",
		description:
			"Record a fix applied for a confirmed hypothesis. " +
			"The actual code edit is done via the edit tool — this tracks the fix separately from instrumentation.",
		parameters: fixParameters,
		async execute(
			_toolCallId: string,
			params: FixParams,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			_ctx: ExtensionContext,
		) {
			const { hypothesisId, description: _desc, files } = params;

			// Validate active session exists
			const session = deps.store.getActive();
			if (!session) {
				throw new Error(
					"No active debug session. Run /debug start or call debug_hypothesize first.",
				);
			}

			// Validate hypothesis exists
			const hypothesis = session.hypotheses.find((h) => h.id === hypothesisId);
			if (!hypothesis) {
				throw new Error(`Hypothesis #${hypothesisId} not found in session ${session.id}.`);
			}

			if (files.length === 0) {
				throw new Error("At least one changed file is required.");
			}

			// Record the fix, tagged with the current iteration
			const fix = toAppliedFix(session.iteration, hypothesisId, files);
			deps.store.addFix(session.id, fix);

			// Set phase to verify and increment iteration for the next attempt
			const nextIteration = session.iteration + 1;
			deps.store.update(session.id, {
				phase: "verify",
				iteration: nextIteration,
			});

			const resultText = buildFixResult(session.id, fix, nextIteration);

			return {
				content: [{ type: "text" as const, text: resultText }],
				details: {
					sessionId: session.id,
					hypothesisId,
					iteration: fix.iteration,
					nextIteration,
					phase: "verify",
					fix,
				},
			};
		},
	};
}
