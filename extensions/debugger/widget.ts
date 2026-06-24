/**
 * Instrumentation widget for the Pi AI Debugger.
 *
 * Renders the four layout regions from requirements.md
 * (Header / Hypothesis / Log Stream / Body) as the live telemetry panel
 * shown above the editor while a debug session is active.
 *
 * Pure rendering — owns no state. index.ts holds the mutable DebugSnapshot,
 * renders it to a string[], and pushes it via ctx.ui.setWidget whenever it
 * changes. Uses the string-array widget form (same as plan-mode) so lines
 * wrap naturally at any terminal width.
 */
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

/** The 7 instrumentation states from requirements.md ("Instrumentation States"). */
export type DebugStateName =
	| "AWAITING CONTEXT"
	| "AWAITING CONTEXT: AMBIGUOUS"
	| "PARSING ASSET"
	| "HYPOTHESIS & BUG VALIDATION"
	| "FIXING BUG"
	| "BUG FIXED"
	| "DEBUG SUMMARY";

/** Snapshot the widget renders from. Owned by index.ts; mutated as the loop advances. */
export interface DebugSnapshot {
	mode: "local" | "remote";
	state: DebugStateName;
	/** Inbound port the log server listens on. */
	port: number;
	/** Where injected snippets POST telemetry (localhost:port or ngrok URL). */
	telemetryTarget: string;
	/** True while packets are actively arriving. */
	liveLogging: boolean;
	/** Current hypothesis under test, or null before one is formed. */
	hypothesis: string | null;
	/** Increments each time a fix fails and a new hypothesis is formed. */
	hypothesisCount: number;
	/** Pretty-printed recent log packets (tail window). */
	logLines: string[];
	/** Free-form LLM questions / next-step prompts / affordances. */
	body: string[];
}

/** Default inbound port (requirements: 8866). */
export const DEFAULT_PORT = 8866;

export function initialSnapshot(): DebugSnapshot {
	return {
		mode: "local",
		state: "AWAITING CONTEXT",
		port: DEFAULT_PORT,
		telemetryTarget: `http://localhost:${DEFAULT_PORT}`,
		liveLogging: false,
		hypothesis: null,
		hypothesisCount: 0,
		logLines: [],
		body: [
			"Describe the bug or paste an error / stack trace to begin.",
			"For local frontend JS/TS, you can fetch() the telemetry endpoint directly.",
		],
	};
}

const STATE_COLOR: Record<DebugStateName, ThemeColor> = {
	"AWAITING CONTEXT": "dim",
	"AWAITING CONTEXT: AMBIGUOUS": "warning",
	"PARSING ASSET": "accent",
	"HYPOTHESIS & BUG VALIDATION": "accent",
	"FIXING BUG": "warning",
	"BUG FIXED": "success",
	"DEBUG SUMMARY": "success",
};

const SEP = "\u2502"; // │ — thin vertical separator (single cell)

/** Build the widget lines for a snapshot. Pure; safe to call on every render. */
export function renderDebugWidget(snapshot: DebugSnapshot, theme: Theme): string[] {
	const lines: string[] = [];

	// --- Header: brand · state · live indicator · port · telemetry target ---
	const live = snapshot.liveLogging
		? theme.fg("success", "● LIVE")
		: theme.fg("dim", "○ idle");
	lines.push(
		[
			theme.fg("accent", theme.bold("DEBUG")),
			theme.fg(STATE_COLOR[snapshot.state], snapshot.state),
			live,
			theme.fg("muted", `:${snapshot.port}`),
			theme.fg("muted", `→ ${snapshot.telemetryTarget}`),
		].join(theme.fg("borderMuted", ` ${SEP} `)),
	);
	lines.push("");

	// --- Hypothesis statement + counter ---
	lines.push(
		`${theme.fg("accent", theme.bold("HYPOTHESIS"))} ${theme.fg("muted", `#${snapshot.hypothesisCount}`)}`,
	);
	lines.push(
		`  ${snapshot.hypothesis ?? theme.fg("dim", "No hypothesis yet — waiting for context.")}`,
	);
	lines.push("");

	// --- Log stream (only meaningful once snippets are emitting) ---
	lines.push(theme.fg("accent", theme.bold("LOG STREAM")));
	if (snapshot.logLines.length === 0) {
		lines.push(
			`  ${theme.fg("dim", "No telemetry yet — injected logging snippets will stream packets here.")}`,
		);
	} else {
		for (const line of snapshot.logLines) {
			lines.push(`  ${line}`);
		}
	}
	lines.push("");

	// --- Body: LLM questions / next steps / affordances ---
	for (const line of snapshot.body) {
		lines.push(`  ${line}`);
	}

	return lines;
}
