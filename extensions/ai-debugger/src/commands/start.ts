/**
 * /debug start command — create session, start collector.
 *
 * Per TODO-415787ba.
 *
 * Flow:
 * 1. Reject if an active session already exists (one at a time)
 * 2. Create new session via SessionStore.create(description)
 * 3. Start the log collector on the configured port (if not already running)
 * 4. Auto-detect supported language profiles — warn if none found
 * 5. Session phase is "understand" by default (set by SessionStore.create)
 * 6. Notify the user with the session ID and a prompt to describe the bug
 * 7. Show the debug widget (analyzing state)
 *
 * Description handling:
 * - `/debug start Checkout crashes with 3 items` → args used as description
 * - `/debug start` (no args) → empty description; the user describes the bug
 *   in their next message. No ctx.ui.input() prompt — the conversational flow
 *   handles it naturally.
 *
 * The shared `performStart` function is testable without the pi API.
 * index.ts wires it to the command handler (notify + widget).
 */

import type { DebugSession } from "../types.js";
import type { SessionStore } from "../session-store.js";
import type { LogCollector } from "../log-collector.js";
import type { DebugConfig } from "../config.js";
import { detectProfiles } from "../language-profiles/index.js";

// ── Types ─────────────────────────────────────────────────────────────────

/** Dependencies injected into performStart. */
export interface StartCommandDeps {
	store: SessionStore;
	collector: LogCollector;
	config: DebugConfig;
	cwd: string;
}

/** Summary of a successful start, used to build the notification + widget. */
export interface StartSummary {
	sessionId: string;
	description: string;
	collectorPort: number;
	detectedProfiles: string[];
	/** Whether at least one language profile was detected. */
	hasProfiles: boolean;
}

// ── Pure functions (testable without pi) ──────────────────────────────────

/**
 * Build the notification message shown to the user after starting a session.
 *
 * Adapts based on whether a description was provided and whether language
 * profiles were detected.
 *
 * @param summary - The start summary
 * @returns Multi-line notification text
 */
export function buildStartMessage(summary: StartSummary): string {
	const lines: string[] = [];
	lines.push(`🐛 Debug session started: ${summary.sessionId}`);
	lines.push("");

	if (summary.description) {
		lines.push(`Bug: ${summary.description}`);
	} else {
		lines.push("Describe the bug to the agent and it will begin analyzing.");
	}

	if (!summary.hasProfiles) {
		lines.push("");
		lines.push("⚠ No supported language detected (no package.json found). " +
			"Instrumentation requires a JS/TS project.");
	}

	return lines.join("\n");
}

/**
 * Build the widget content shown above the editor during a debug session.
 *
 * Shows the session ID, phase, and iteration. Even at start (empty session),
 * it shows an "Analyzing" state so the user knows the debug session is active.
 *
 * @param session - The active debug session
 * @returns Array of widget lines
 */
export function buildStartWidget(session: DebugSession): string[] {
	const lines: string[] = [];
	lines.push(`🐛 Debug: ${session.id} — ${session.phase}`);
	lines.push(`Iteration ${session.iteration}/${session.maxIterations}`);
	if (session.description) {
		lines.push(`Bug: ${session.description}`);
	} else {
		lines.push("Analyzing — describe the bug to the agent");
	}
	return lines;
}

// ── Core start logic ──────────────────────────────────────────────────────

/**
 * Perform the full session start: create session, start collector, detect profiles.
 *
 * @param deps - Store, collector, config, and working directory
 * @param description - Optional bug description (from command args)
 * @returns Start summary
 * @throws If a session is already active
 */
export async function performStart(
	deps: StartCommandDeps,
	description: string,
): Promise<StartSummary> {
	const { store, collector, config, cwd } = deps;

	// Reject if an active session already exists
	if (store.getActive()) {
		const active = store.getActive()!;
		throw new Error(
			`A debug session is already active (${active.id}). Run /debug cleanup or /debug abort first.`,
		);
	}

	// Create new session (phase defaults to "understand")
	const session = store.create(description, config.maxIterations);

	// Start the collector if not already running
	if (!collector.isRunning) {
		await collector.start(config.port);
	}

	// Detect supported language profiles
	const profiles = detectProfiles(cwd);

	return {
		sessionId: session.id,
		description: session.description,
		collectorPort: collector.listeningPort,
		detectedProfiles: profiles.map((p) => p.name),
		hasProfiles: profiles.length > 0,
	};
}
