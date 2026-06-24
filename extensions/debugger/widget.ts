/**
 * Instrumentation widget renderer (Part 3).
 *
 * Pure function over (state snapshot, packet buffer, theme) so the layout is
 * unit-testable without the TUI. index.ts wraps it in a ctx.ui.setWidget()
 * callback that handles width truncation and theme changes.
 *
 * Visual design is a SKELETON pending the wireframe images (see
 * docs/03-instrumentation-widget.md). Layout regions: header, hypothesis,
 * log stream, body.
 */

import type { LogPacket } from "./server.ts";
import type { DebugSessionState, DebugStateValue } from "./state.ts";
import { DebugState } from "./state.ts";

/** Minimal theme surface this renderer needs. index.ts passes ctx.ui.theme. */
export interface WidgetTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

export interface WidgetInput {
  snapshot: DebugSessionState;
  packets: LogPacket[];
  lastPacketAt: number | null;
  now: number;
  /** Max log-stream lines to show (default 5). */
  maxLogLines?: number;
}

const LIVE_WINDOW_MS = 5000;
const LEVEL_COLORS: Record<string, string> = {
  TRACE: "dim",
  DEBUG: "dim",
  INFO: "muted",
  WARN: "warning",
  ERROR: "error",
  FATAL: "error",
};

function stateColor(state: DebugStateValue): string {
  switch (state) {
    case DebugState.BugFixed:
    case DebugState.DebugSummary:
      return "success";
    case DebugState.FixingBug:
    case DebugState.HypothesisValidation:
      return "warning";
    case DebugState.AwaitingContextAmbiguous:
      return "error";
    default:
      return "accent";
  }
}

function prettyPacket(packet: LogPacket, theme: WidgetTheme): string {
  const level = String(packet.level ?? "?").toUpperCase();
  const color = LEVEL_COLORS[level] ?? "muted";
  const src = packet.source;
  const loc = src ? `${src.file}:${src.line}` : "?:?";
  const fn = src?.function ? ` ${src.function}()` : "";
  return `${theme.fg(color, level.padEnd(5))} ${theme.fg("dim", loc)}${theme.fg("muted", fn)} ${packet.message ?? ""}`;
}

/**
 * Build the widget's lines (untruncated). index.ts truncates each to the
 * available width. Returns [] when the session is inactive (caller clears).
 */
export function buildWidgetLines(input: WidgetInput, theme: WidgetTheme): string[] {
  const { snapshot } = input;
  if (!snapshot.active) return [];

  const lines: string[] = [];
  const live =
    input.lastPacketAt !== null && input.now - input.lastPacketAt < LIVE_WINDOW_MS;
  const target = snapshot.telemetryTarget || "(no target)";

  // --- Header -------------------------------------------------------------
  const state = theme.fg(stateColor(snapshot.state), theme.bold(snapshot.state));
  const liveTag = live ? "  " + theme.fg("success", "● LIVE LOGGING") : "";
  const portTag = theme.fg("dim", `:${snapshot.port ?? "—"} ${snapshot.mode}`);
  lines.push(`${state}${liveTag}  ${portTag}`);
  lines.push(theme.fg("dim", target));

  // --- Hypothesis (only when one is set) ----------------------------------
  if (snapshot.hypothesis) {
    const counter = theme.fg("muted", ` [#${snapshot.hypothesisCount}]`);
    const attempts =
      snapshot.attempts > 0
        ? theme.fg("dim", `  (${snapshot.attempts}/${snapshot.maxAttempts} tries)`)
        : "";
    lines.push(theme.fg("accent", "Hypothesis") + counter + attempts + ":");
    lines.push(theme.fg("text", snapshot.hypothesis.statement));
    if (snapshot.hypothesis.files.length > 0) {
      lines.push(theme.fg("dim", "  files: " + snapshot.hypothesis.files.join(", ")));
    }
  }

  // --- Log stream (only when there are packets) ---------------------------
  const max = input.maxLogLines ?? 5;
  if (input.packets.length > 0) {
    lines.push(theme.fg("muted", "Log stream") + theme.fg("dim", ` (${input.packets.length})`));
    const tail = input.packets.slice(-max);
    for (const p of tail) lines.push(prettyPacket(p, theme));
  }

  // --- Body (state-appropriate prompt) ------------------------------------
  const attemptsRemaining = Math.max(0, snapshot.maxAttempts - snapshot.attempts);
  lines.push(theme.fg("accent", bodyPrompt(snapshot.state, attemptsRemaining)));
  return lines;
}

function bodyPrompt(state: DebugStateValue, attemptsRemaining: number): string {
  switch (state) {
    case DebugState.AwaitingContext:
      return "Describe the bug: paste a stack trace, error text, or a screenshot path.";
    case DebugState.AwaitingContextAmbiguous:
      return "Need more specifics: which file/function, and the exact error or symptom?";
    case DebugState.ParsingAsset:
      return "Parsing uploaded asset…";
    case DebugState.HypothesisValidation:
      return "Forming a hypothesis and injecting telemetry to validate it.";
    case DebugState.FixingBug:
      return `Fix deployed — please reproduce. (${attemptsRemaining} attempt(s) left) Reply "Bug Fixed" or "Continue to Debug".`;
    case DebugState.BugFixed:
      return "Bug accepted. Removing telemetry (keeping the fix). Final validation next.";
    case DebugState.DebugSummary:
      return "Debug complete. Exit debug mode or continue with a new bug?";
    default:
      return "";
  }
}
