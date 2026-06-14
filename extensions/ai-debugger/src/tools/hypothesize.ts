/**
 * debug_hypothesize tool — generate and store ranked hypotheses.
 *
 * Per TODO-ab21793b and FR-2.1 through FR-2.4.
 *
 * Flow:
 * 1. LLM analyzes the codebase (using read/bash/etc.) and reasons about the bug
 * 2. LLM calls this tool with structured hypotheses (description, confidence, files, plan)
 * 3. Tool creates/retrieves the active session, sets phase to "hypothesize"
 * 4. Tool ensures the log collector is running (for the instrument→observe flow)
 * 5. Tool stores the hypotheses (assigning sequential IDs, status "pending")
 * 6. Tool presents hypotheses to the user via ctx.ui.select for priority selection
 * 7. Tool returns the stored hypotheses + next-step guidance to the LLM
 *
 * The tool does NOT call the LLM — it stores what the LLM provides and structures
 * the result. This matches debug_instrument and debug_fix (which also accept
 * structured data from the LLM).
 */

import { Type } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Hypothesis } from "../types.js";
import type { SessionStore } from "../session-store.js";
import type { LogCollector } from "../log-collector.js";
import type { DebugConfig } from "../config.js";

// ── Types ─────────────────────────────────────────────────────────────────

/** A hypothesis as provided by the LLM, before ID/status assignment. */
export type HypothesisInput = Omit<Hypothesis, "id" | "status">;

/** Parameters the LLM passes to the tool (matches hypothesizeParameters schema). */
export interface HypothesizeParams {
	bugDescription: string;
	context?: string;
	hypotheses: HypothesisInput[];
}

/** Dependencies injected into the tool factory. */
export interface HypothesizeToolDeps {
	store: SessionStore;
	collector: LogCollector;
	config: DebugConfig;
}

// ── Parameter schema ──────────────────────────────────────────────────────

const locationSchema = Type.Object({
	line: Type.Optional(Type.Number({ description: "Approximate line number" })),
	function: Type.Optional(Type.String({ description: "Function name" })),
	whatToLog: Type.String({ description: "What runtime data to capture at this point" }),
});

const planSchema = Type.Object({
	file: Type.String({ description: "File path to instrument" }),
	locations: Type.Array(locationSchema, { description: "Specific locations within the file" }),
});

const hypothesisSchema = Type.Object({
	description: Type.String({ description: "Plain-language description of the suspected root cause" }),
	confidence: Type.Union(
		[Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")],
		{ description: "Confidence level: high, medium, or low" },
	),
	files: Type.Array(Type.String(), { description: "Files/code regions involved" }),
	instrumentationPlan: Type.Array(planSchema, {
		description: "Where to add logging and what to capture to confirm or rule out this hypothesis",
	}),
});

export const hypothesizeParameters = Type.Object({
	bugDescription: Type.String({ description: "Description of the bug being investigated" }),
	context: Type.Optional(
		Type.String({ description: "Additional context: error messages, stack traces, relevant code snippets" }),
	),
	hypotheses: Type.Array(hypothesisSchema, {
		description: "2–5 ranked hypotheses about the bug's root cause (highest priority first)",
		minItems: 1,
	}),
});

// ── Pure functions (testable without pi) ──────────────────────────────────

/**
 * Convert raw LLM-provided hypothesis inputs into stored Hypothesis objects.
 *
 * Assigns sequential 1-indexed IDs and sets status to "pending".
 *
 * @param inputs - Raw hypotheses from the LLM
 * @returns Hypotheses ready to store in the session
 */
export function toHypotheses(inputs: HypothesisInput[]): Hypothesis[] {
	return inputs.map((input, i) => ({
		...input,
		id: i + 1,
		status: "pending" as const,
	}));
}

/**
 * Format a single hypothesis for display in ctx.ui.select.
 *
 * Example: `#1 [high] Race condition in cart.update() (src/cart.ts, src/checkout.ts)`
 *
 * @param h - The hypothesis to format
 * @returns A single-line display string
 */
export function formatHypothesisForDisplay(h: Hypothesis): string {
	const files = h.files.length > 0 ? h.files.join(", ") : "no files";
	return `#${h.id} [${h.confidence}] ${h.description} (${files})`;
}

/**
 * Build the list of display options for ctx.ui.select.
 *
 * @param hypotheses - The hypotheses to display
 * @returns Array of formatted option strings
 */
export function formatHypothesisOptions(hypotheses: Hypothesis[]): string[] {
	return hypotheses.map(formatHypothesisForDisplay);
}

/**
 * Build the result text returned to the LLM after storing hypotheses.
 *
 * Includes all hypotheses with their plans, marks the user-selected one (if any),
 * and provides next-step guidance.
 *
 * @param sessionId - The debug session ID
 * @param hypotheses - The stored hypotheses
 * @param selectedHypothesisId - ID of the hypothesis the user selected to pursue first (if any)
 * @returns Multi-line text summary for the LLM
 */
export function buildHypothesizeResult(
	sessionId: string,
	hypotheses: Hypothesis[],
	selectedHypothesisId?: number,
): string {
	const lines: string[] = [];
	lines.push(`Hypotheses stored in debug session ${sessionId} (phase: hypothesize).`);
	lines.push("");
	lines.push("Ranked hypotheses:");
	for (const h of hypotheses) {
		const marker = h.id === selectedHypothesisId ? " ★ (user selected)" : "";
		lines.push(`  #${h.id} [${h.confidence}] ${h.description}${marker}`);
		if (h.files.length > 0) {
			lines.push(`     Files: ${h.files.join(", ")}`);
		}
		for (const plan of h.instrumentationPlan) {
			for (const loc of plan.locations) {
				const where = loc.function
					?? (loc.line !== undefined ? `line ${loc.line}` : "unspecified location");
				lines.push(`     ${plan.file} @ ${where}: ${loc.whatToLog}`);
			}
		}
	}
	lines.push("");
	if (selectedHypothesisId !== undefined) {
		lines.push(`User selected hypothesis #${selectedHypothesisId} to pursue first.`);
		lines.push(`Next: call debug_instrument with hypothesisId: ${selectedHypothesisId}.`);
	} else {
		lines.push("Next: call debug_instrument with the hypothesisId you want to pursue.");
	}
	return lines.join("\n");
}

// ── Tool factory ──────────────────────────────────────────────────────────

/**
 * Create the debug_hypothesize tool definition.
 *
 * The factory takes injected dependencies (store, collector, config) so the tool
 * can be tested with real instances against a temp directory.
 *
 * @param deps - Session store, log collector, and config
 * @returns Tool definition for pi.registerTool()
 */
export function createHypothesizeTool(deps: HypothesizeToolDeps) {
	return {
		name: "debug_hypothesize",
		label: "Debug: Hypothesize",
		description:
			"Generate ranked hypotheses about a bug's root cause. " +
			"Each hypothesis includes suspected files, confidence level, and what runtime data would confirm it.",
		parameters: hypothesizeParameters,
		async execute(
			_toolCallId: string,
			params: HypothesizeParams,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			ctx: ExtensionContext,
		) {
			const { bugDescription, hypotheses: inputs } = params;

			if (inputs.length === 0) {
				throw new Error("At least one hypothesis is required.");
			}

			// Ensure collector is running for the instrument→observe flow
			if (!deps.collector.isRunning) {
				await deps.collector.start(deps.config.port);
			}

			// Create or retrieve active session
			let session = deps.store.getActive();
			if (!session) {
				session = deps.store.create(bugDescription, deps.config.maxIterations);
			} else {
				// Update description if the LLM provides a (potentially) more specific one
				deps.store.update(session.id, { description: bugDescription });
			}

			// Set phase to hypothesize and store hypotheses
			deps.store.update(session.id, {
				phase: "hypothesize",
				hypotheses: toHypotheses(inputs),
			});

			const hypotheses = deps.store.getActive()!.hypotheses;

			// Present to user for priority selection (if UI available)
			let selectedHypothesisId: number | undefined;
			if (ctx?.hasUI) {
				const options = formatHypothesisOptions(hypotheses);
				const choice = await ctx.ui.select(
					"🐛 Which hypothesis should we pursue first?",
					options,
				);
				if (choice !== undefined) {
					const selectedIndex = options.indexOf(choice);
					if (selectedIndex >= 0) {
						selectedHypothesisId = hypotheses[selectedIndex].id;
					}
				}
			}

			// Return result to the LLM
			const resultText = buildHypothesizeResult(session.id, hypotheses, selectedHypothesisId);
			return {
				content: [{ type: "text" as const, text: resultText }],
				details: {
					sessionId: session.id,
					hypotheses,
					selectedHypothesisId,
				},
			};
		},
	};
}
