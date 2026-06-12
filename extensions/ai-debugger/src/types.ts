/**
 * Data model types for the AI Debugger extension.
 *
 * Per Section 9 of REQUIREMENTS.md.
 */

// ── 9.1 Debug Session ─────────────────────────────────────────────────────

export type SessionStatus = "active" | "completed" | "aborted";

export type SessionPhase =
	| "understand"
	| "hypothesize"
	| "instrument"
	| "observe"
	| "fix"
	| "verify"
	| "cleanup";

export interface DebugSession {
	id: string;
	description: string;
	status: SessionStatus;
	phase: SessionPhase;
	iteration: number;
	maxIterations: number;
	createdAt: number;
	updatedAt: number;
	hypotheses: Hypothesis[];
	instrumentedFiles: InstrumentedFile[];
	fixes: AppliedFix[];
	confirmedHypothesis?: number;
	logCount: number;
}

// ── 9.2 Hypothesis ────────────────────────────────────────────────────────

export type HypothesisConfidence = "high" | "medium" | "low";

export type HypothesisStatus = "pending" | "instrumented" | "confirmed" | "ruled_out";

export interface InstrumentationLocation {
	line?: number;
	function?: string;
	whatToLog: string;
}

export interface InstrumentationPlan {
	file: string;
	locations: InstrumentationLocation[];
}

export interface Hypothesis {
	id: number;
	description: string;
	confidence: HypothesisConfidence;
	files: string[];
	instrumentationPlan: InstrumentationPlan[];
	status: HypothesisStatus;
}

// ── 9.3 Instrumented File ─────────────────────────────────────────────────

export interface InstrumentedChange {
	lineStart: number;
	lineEnd: number;
	hypothesisId: number;
	marker: string;
}

export interface InstrumentedFile {
	path: string;
	originalContent: string;
	changes: InstrumentedChange[];
}

// ── 9.4 Applied Fix ───────────────────────────────────────────────────────

export type UserFeedback = "fixed" | "not_fixed" | "partial";

export interface AppliedFixFile {
	path: string;
	description: string;
}

export interface AppliedFix {
	iteration: number;
	hypothesisId: number;
	files: AppliedFixFile[];
	verified: boolean;
	userFeedback?: UserFeedback;
	feedbackDetail?: string;
}

// ── 9.5 Log Entry ─────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface DebugLogEntry {
	timestamp: string;
	session: string;
	hypothesis: number;
	file: string;
	line: number;
	level: LogLevel;
	tag: string;
	data: Record<string, unknown>;
}
