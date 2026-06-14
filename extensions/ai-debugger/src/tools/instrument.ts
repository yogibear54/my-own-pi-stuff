/**
 * debug_instrument tool — inject logging into files using language profiles.
 *
 * Per TODO-37f14634 and FR-3.1 through FR-3.5.
 *
 * Flow:
 * 1. LLM calls this tool with a hypothesis ID and an instrumentation plan
 *    (file, location.line, whatToLog, data for each point)
 * 2. Tool validates the session and hypothesis exist
 * 3. For each file in the plan:
 *    a. Reads the file content
 *    b. Looks up the language profile by extension
 *    c. Generates instrumentation (marker + log call + marker) for each location
 *    d. Inserts the instrumentation after the specified line
 *    e. Writes the modified file back to disk
 *    f. Records the InstrumentedFile (original content + changes)
 * 4. Sets the hypothesis status to "instrumented"
 * 5. Sets the session phase to "observe"
 * 6. Returns a summary of instrumented files (and any failures)
 *
 * Design decisions (confirmed with user):
 * - The tool accepts a `data` field per plan item (JS source for the data object)
 * - Line numbers are required for insertion; function names are accepted but informational
 * - Partial failures: files that fail are reported, successful files proceed
 */

import { Type } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import type { InstrumentedFile, InstrumentedChange } from "../types.js";
import type { SessionStore } from "../session-store.js";
import type { LogCollector } from "../log-collector.js";
import type { DebugConfig } from "../config.js";
import { getProfileForFile } from "../language-profiles/index.js";
import type { LanguageProfile, InstrumentationEnvelope } from "../language-profiles/index.js";

// ── Types ─────────────────────────────────────────────────────────────────

/** A single instrumentation point as provided by the LLM. */
export interface InstrumentationPlanItem {
	file: string;
	location?: {
		line?: number;
		function?: string;
	};
	whatToLog: string;
	data: string;
}

/** Parameters the LLM passes to the tool. */
export interface InstrumentParams {
	hypothesisId: number;
	instrumentationPlan: InstrumentationPlanItem[];
}

/** Dependencies injected into the tool factory. */
export interface InstrumentToolDeps {
	store: SessionStore;
	collector: LogCollector;
	config: DebugConfig;
	cwd: string;
}

/** Result of instrumenting a single file. */
interface FileResult {
	file: string;
	success: boolean;
	error?: string;
	changeCount?: number;
	instrumentedFile?: InstrumentedFile;
}

// ── Parameter schema ──────────────────────────────────────────────────────

export const instrumentParameters = Type.Object({
	hypothesisId: Type.Number({ description: "The hypothesis ID to instrument for" }),
	instrumentationPlan: Type.Array(
		Type.Object({
			file: Type.String({ description: "File path to instrument" }),
			location: Type.Optional(
				Type.Object({
					line: Type.Optional(
						Type.Number({ description: "Line number to insert instrumentation after (1-indexed)" }),
					),
					function: Type.Optional(
						Type.String({ description: "Function name (informational, line is used for insertion)" }),
					),
				}),
			),
			whatToLog: Type.String({
				description: "Description/category for this log point (used as the log tag)",
			}),
			data: Type.String({
				description:
					'JS source for the data object to capture at runtime, e.g. "{ items: cart.items.length, total: cart.total }"',
			}),
		}),
		{ minItems: 1 },
	),
});

// ── Pure functions (testable without pi) ──────────────────────────────────

/** An insertion entry: where to insert and what lines to insert. */
export interface InsertionEntry {
	/** 1-indexed line number to insert after (0 = top of file) */
	line: number;
	/** Lines to insert (typically: marker start, log call, marker end) */
	block: string[];
}

/**
 * Insert instrumentation blocks into file content.
 *
 * Processes insertions from bottom to top so earlier insertions don't shift
 * line numbers for later ones. After insertion, scans the result for marker
 * pairs to record accurate line ranges.
 *
 * @param content - Original file content
 * @param entries - Insertion entries (line + block lines)
 * @returns New content and the recorded changes (line ranges in the new file)
 */
export function insertInstrumentation(
	content: string,
	entries: InsertionEntry[],
): { content: string; changes: InstrumentedChange[] } {
	if (entries.length === 0) {
		return { content, changes: [] };
	}

	const lines = content.split("\n");

	// Sort by line descending — insert from bottom to top so earlier
	// insertions don't shift line numbers for later ones.
	const sorted = [...entries].sort((a, b) => b.line - a.line);

	for (const entry of sorted) {
		const insertAt = Math.max(0, Math.min(entry.line, lines.length));
		lines.splice(insertAt, 0, ...entry.block);
	}

	const newContent = lines.join("\n");
	const changes = scanInstrumentedChanges(newContent);
	return { content: newContent, changes };
}

/**
 * Scan content for `__AI_DEBUG_START__` ... `__AI_DEBUG_END__` marker pairs.
 *
 * Records the line range and hypothesis ID for each marker-bounded block.
 * This is profile-agnostic — it looks for the universal marker sentinels,
 * not language-specific comment syntax.
 *
 * @param content - File content to scan
 * @returns Array of changes (one per marker pair), sorted by lineStart
 */
export function scanInstrumentedChanges(content: string): InstrumentedChange[] {
	const lines = content.split("\n");
	const changes: InstrumentedChange[] = [];

	let i = 0;
	while (i < lines.length) {
		const match = lines[i].match(/__AI_DEBUG_START__ session=(\S+) hypothesis=(\d+)/);
		if (match) {
			const hypothesisId = parseInt(match[2], 10);
			const lineStart = i + 1; // 1-indexed
			const marker = lines[i];

			// Find the matching END marker
			let endIdx = i + 1;
			while (endIdx < lines.length && !lines[endIdx].includes("__AI_DEBUG_END__")) {
				endIdx++;
			}
			const lineEnd = endIdx < lines.length ? endIdx + 1 : lines.length;

			changes.push({ lineStart, lineEnd, hypothesisId, marker });
			i = endIdx + 1;
		} else {
			i++;
		}
	}

	return changes;
}

/**
 * Build the instrumentation block (marker start + log call + marker end).
 *
 * @param profile - Language profile for the target file
 * @param envelope - Instrumentation envelope (session, hypothesis, data, etc.)
 * @returns Array of lines forming the instrumentation block
 */
export function buildInstrumentationBlock(
	profile: LanguageProfile,
	envelope: InstrumentationEnvelope,
): string[] {
	return [
		profile.buildMarkerStart(envelope.session, envelope.hypothesis),
		profile.buildLogCall(envelope),
		profile.buildMarkerEnd(),
	];
}

/**
 * Build the instrumentation envelope for a single log point.
 */
function buildEnvelope(
	sessionId: string,
	hypothesisId: number,
	filePath: string,
	line: number,
	tag: string,
	data: string,
	port: number,
): InstrumentationEnvelope {
	return {
		session: sessionId,
		hypothesis: hypothesisId,
		file: filePath,
		line,
		level: "info",
		tag,
		port,
		data: data.trim() || "{}",
	};
}

/**
 * Build the result text returned to the LLM.
 *
 * Summarizes successes and failures, and provides next-step guidance.
 */
export function buildInstrumentResult(
	sessionId: string,
	hypothesisId: number,
	results: Omit<FileResult, "instrumentedFile">[],
): string {
	const succeeded = results.filter((r) => r.success);
	const failed = results.filter((r) => !r.success);

	const lines: string[] = [];
	lines.push(`Instrumented ${succeeded.length} file(s) for hypothesis #${hypothesisId} in session ${sessionId}.`);

	for (const r of succeeded) {
		lines.push(`  ✓ ${r.file} — ${r.changeCount} log point(s)`);
	}
	for (const r of failed) {
		lines.push(`  ✗ ${r.file} — ${r.error}`);
	}

	if (failed.length > 0) {
		lines.push("");
		lines.push(`⚠ ${failed.length} file(s) failed. Review the errors above.`);
	}

	lines.push("");
	lines.push("Phase set to observe.");
	lines.push("Next: ask the user to reproduce the bug, then call debug_logs to view captured runtime data.");
	return lines.join("\n");
}

/**
 * Instrument a single file — read, insert, write, return result.
 *
 * @param filePath - File path (relative to cwd, as provided by the LLM)
 * @param items - Instrumentation plan items for this file
 * @param sessionId - Active debug session ID
 * @param hypothesisId - Hypothesis being instrumented
 * @param port - Collector port for the log POST endpoint
 * @param cwd - Working directory for resolving relative paths
 * @returns Result indicating success/failure and the InstrumentedFile (if successful)
 */
function instrumentFile(
	filePath: string,
	items: InstrumentationPlanItem[],
	sessionId: string,
	hypothesisId: number,
	port: number,
	cwd: string,
): FileResult {
	const absPath = path.resolve(cwd, filePath);

	// Look up language profile by extension
	const profile = getProfileForFile(absPath);
	if (!profile) {
		return { file: filePath, success: false, error: `Unsupported file type: ${path.extname(filePath) || "(no extension)"}` };
	}

	// Read file content
	if (!fs.existsSync(absPath)) {
		return { file: filePath, success: false, error: "File not found" };
	}
	const originalContent = fs.readFileSync(absPath, "utf-8");
	const fileLines = originalContent.split("\n");

	// Build insertion entries for items that have a line number
	const entries: InsertionEntry[] = [];
	const skipped: string[] = [];

	for (const item of items) {
		const line = item.location?.line;
		if (line === undefined || line === null) {
			skipped.push(item.location?.function ?? item.whatToLog);
			continue;
		}

		// Clamp to valid range [0, fileLines.length]
		const clampedLine = Math.max(0, Math.min(line, fileLines.length));

		const envelope = buildEnvelope(
			sessionId,
			hypothesisId,
			filePath,
			clampedLine,
			item.whatToLog,
			item.data,
			port,
		);
		const block = buildInstrumentationBlock(profile, envelope);
		entries.push({ line: clampedLine, block });
	}

	if (entries.length === 0) {
		const reason = skipped.length > 0 ? `No line numbers for: ${skipped.join(", ")}` : "No valid instrumentation points";
		return { file: filePath, success: false, error: reason };
	}

	// Insert instrumentation into content
	const { content: newContent, changes } = insertInstrumentation(originalContent, entries);

	// Write modified file to disk
	fs.writeFileSync(absPath, newContent, "utf-8");

	return {
		file: filePath,
		success: true,
		changeCount: changes.length,
		instrumentedFile: {
			path: filePath,
			originalContent,
			changes,
		},
	};
}

// ── Tool factory ──────────────────────────────────────────────────────────

/**
 * Create the debug_instrument tool definition.
 *
 * @param deps - Session store, log collector, config, and working directory
 * @returns Tool definition for pi.registerTool()
 */
export function createInstrumentTool(deps: InstrumentToolDeps) {
	return {
		name: "debug_instrument",
		label: "Debug: Instrument",
		description:
			"Inject logging statements into files to capture runtime data for a hypothesis. " +
			"Instrumentation is wrapped in __AI_DEBUG_START__ / __AI_DEBUG_END__ markers for later cleanup.",
		parameters: instrumentParameters,
		async execute(
			_toolCallId: string,
			params: InstrumentParams,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			_ctx: ExtensionContext,
		) {
			const { hypothesisId, instrumentationPlan } = params;

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

			if (instrumentationPlan.length === 0) {
				throw new Error("Instrumentation plan must contain at least one item.");
			}

			// Ensure collector is running (for the instrument→observe flow)
			if (!deps.collector.isRunning) {
				await deps.collector.start(deps.config.port);
			}
			const port = deps.collector.listeningPort;

			// Group plan items by file
			const byFile = new Map<string, InstrumentationPlanItem[]>();
			for (const item of instrumentationPlan) {
				const group = byFile.get(item.file) ?? [];
				group.push(item);
				byFile.set(item.file, group);
			}

			// Process each file
			const results: FileResult[] = [];
			for (const [filePath, items] of byFile) {
				try {
					const result = instrumentFile(
						filePath,
						items,
						session.id,
						hypothesisId,
						port,
						deps.cwd,
					);
					results.push(result);
				} catch (err) {
					results.push({
						file: filePath,
						success: false,
						error: err instanceof Error ? err.message : String(err),
					});
				}
			}

			// Record successful instrumented files in session
			for (const result of results) {
				if (result.success && result.instrumentedFile) {
					deps.store.addInstrumentedFile(session.id, result.instrumentedFile);
				}
			}

			// Update hypothesis status to "instrumented" and set phase to "observe"
			const hasSuccess = results.some((r) => r.success);
			if (hasSuccess) {
				const updatedHypotheses = session.hypotheses.map((h) =>
					h.id === hypothesisId
						? { ...h, status: "instrumented" as const }
						: h,
				);
				deps.store.update(session.id, {
					phase: "observe",
					hypotheses: updatedHypotheses,
				});
			}

			// Build result (strip instrumentedFile from the details sent to the LLM)
			const summary = results.map(({ instrumentedFile: _if, ...rest }) => rest);
			const resultText = buildInstrumentResult(session.id, hypothesisId, summary);

			return {
				content: [{ type: "text" as const, text: resultText }],
				details: {
					sessionId: session.id,
					hypothesisId,
					phase: hasSuccess ? "observe" : session.phase,
					results: summary,
				},
			};
		},
	};
}
