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

import type { TelemetryPacket } from "./server.ts";

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
	/** Summary of the bug under investigation, or null before it's described. Newlines split lines. */
	bug: string | null;
	/** Current hypothesis under test, or null before one is formed. Newlines split lines. */
	hypothesis: string | null;
	/** Increments each time a fix fails and a new hypothesis is formed. */
	hypothesisCount: number;
	/** Total packets received this session (drives the "N total" hint). */
	logCount: number;
	/** Pretty-printed recent log packets (compact tail window, newest last). */
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
		bug: null,
		hypothesis: null,
		hypothesisCount: 0,
		logCount: 0,
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

/** Max packets shown in the always-on widget tail (shares pi's 10-line widget cap). */
export const TAIL_LIMIT = 3;

/** Severity → theme color. Custom levels get no special color (default text). */
function levelColor(level: string): ThemeColor | undefined {
	const u = level.toUpperCase();
	if (u === "ERROR" || u === "FATAL") return "error";
	if (u === "WARN" || u === "WARNING") return "warning";
	if (u === "INFO") return "success";
	if (u === "DEBUG" || u === "TRACE") return "dim";
	return undefined;
}

/** Compact one-liner for the widget tail: `LEVEL file:line fn — message`. */
export function formatPacketCompact(p: TelemetryPacket, theme: Theme): string {
	const lc = levelColor(p.level);
	const level = lc ? theme.fg(lc, theme.bold(p.level)) : theme.bold(p.level);
	const src = theme.fg("muted", `${p.source.file}:${p.source.line}`);
	const fn = theme.fg("dim", p.source.function);
	const sep = theme.fg("dim", "—");
	return [level, src, fn, sep, p.message].join(" ");
}

/** Expanded multi-line block for the scrollable overlay. */
export function formatPacketExpanded(p: TelemetryPacket, theme: Theme): string[] {
	const lc = levelColor(p.level);
	const level = lc ? theme.fg(lc, theme.bold(p.level)) : theme.bold(p.level);
	const lines: string[] = [];
	lines.push(`${level} ${theme.fg("muted", `${p.source.file}:${p.source.line}`)} ${theme.fg("dim", p.source.function)}`);
	lines.push(`  ${theme.fg("dim", p.event_timestamp)}`);
	lines.push(`  ${p.message}`);
	if (p.variables && typeof p.variables === "object") {
		const entries = Object.entries(p.variables);
		if (entries.length > 0) {
			lines.push(`  ${theme.fg("accent", "variables")}:`);
			for (const [k, v] of entries) lines.push(`    ${theme.fg("muted", k)}: ${JSON.stringify(v)}`);
		}
	}
	if (p.stack_trace) {
		lines.push(`  ${theme.fg("accent", "stack_trace")}:`);
		for (const l of p.stack_trace.split("\n")) lines.push(`    ${theme.fg("dim", l)}`);
	}
	return lines;
}

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

	// --- Bug summary ---
	lines.push(theme.fg("warning", theme.bold("BUG")));
	if (snapshot.bug === null) {
		lines.push(`  ${theme.fg("dim", "No bug described yet.")}`);
	} else {
		for (const line of snapshot.bug.split("\n")) lines.push(`  ${line}`);
	}
	lines.push("");

	// --- Hypothesis statement + counter ---
	lines.push(
		`${theme.fg("accent", theme.bold("HYPOTHESIS"))} ${theme.fg("muted", `#${snapshot.hypothesisCount}`)}`,
	);
	if (snapshot.hypothesis === null) {
		lines.push(`  ${theme.fg("dim", "No hypothesis yet — waiting for context.")}`);
	} else {
		for (const line of snapshot.hypothesis.split("\n")) lines.push(`  ${line}`);
	}
	lines.push("");

	// --- Log stream (only meaningful once snippets are emitting) ---
	lines.push(theme.fg("accent", theme.bold("LOG STREAM")));
	if (snapshot.logCount === 0) {
		lines.push(
			`  ${theme.fg("dim", "No telemetry yet — injected logging snippets will stream packets here.")}`,
		);
	} else {
		for (const line of snapshot.logLines) {
			lines.push(`  ${line}`);
		}
		lines.push(
			`  ${theme.fg("muted", `↑ /debugger logs to scroll history (${snapshot.logCount} total)`)}`,
		);
	}
	lines.push("");

	// --- Body: LLM questions / next steps / affordances ---
	for (const line of snapshot.body) {
		lines.push(`  ${line}`);
	}

	return lines;
}
