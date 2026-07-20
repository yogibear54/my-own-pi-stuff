/**
 * Snippet + transition tools for the debug loop.
 *
 * - registerSnippetTools: inject / remove / list / cleanup telemetry snippets.
 * - registerReportBugTool:  record/revise the bug summary (mutation via applyBug).
 * - registerTransitionTools: report_hypothesis / request_user_test / debug_summary.
 *
 * Snippet tracking + the state machine live in ./state.ts (persisted); this module
 * owns the tool registrations and the file-mutation logic. All tools are gated on
 * an active session (inert otherwise — there is no unregister API).
 *
 * Reference: docs/04-snippet-injection-cleanup.md, docs/05-debugging-loop.md
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DebugSnapshot } from "./widget.ts";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { commentStyleFor, findSnippets, generateSnippetBlock, injectIntoLines, removeSpan } from "./snippets.ts";
import * as state from "./state.ts";

/** Inert result returned when no debug session is active. */
const inert = () => ({
	content: [{ type: "text" as const, text: "No active debug session. Start one with /debugger." }],
	details: undefined,
});

/**
 * Remove every tracked snippet from disk (called by the `cleanup_all_snippets`
 * tool, by `request_user_test`, and by `/debugger stop`). Keeps any accepted fix
 * (snippets ≠ fix). Per-file read-modify-write runs inside `withFileMutationQueue`.
 * Best-effort: returns a per-file error list rather than throwing.
 */
export async function cleanupAllSnippets(): Promise<{ removed: number; errors: string[] }> {
	let removed = 0;
	const errors: string[] = [];
	const byFile = new Map<string, Set<number>>();
	for (const [idStr, info] of Object.entries(state.getSnippetMap())) {
		if (!info.file) continue; // skip untracked placeholders
		const set = byFile.get(info.file) ?? new Set<number>();
		set.add(Number(idStr));
		byFile.set(info.file, set);
	}
	for (const [file, ids] of byFile) {
		try {
			removed += await withFileMutationQueue(file, async () => {
				const content = await readFile(file, "utf8");
				const spans = findSnippets(content).filter((sp) => ids.has(sp.id));
				if (spans.length === 0) return 0;
				let lines = content.split("\n");
				spans.sort((a, b) => b.startLine - a.startLine);
				for (const sp of spans) lines = removeSpan(lines, sp.startLine, sp.endLine);
				await writeFile(file, lines.join("\n"), "utf8");
				return spans.length;
			});
		} catch (e) {
			errors.push(`${file}: ${(e as Error).message}`);
		}
	}
	state.clearSnippets();
	return { removed, errors };
}

/** Register inject / remove / list / cleanup snippet tools. */
export function registerSnippetTools(pi: ExtensionAPI, getSnapshot: () => DebugSnapshot | null): void {
	pi.registerTool({
		name: "inject_snippet",
		label: "Inject Telemetry Snippet",
		description:
			"Insert a delimited telemetry snippet into a source file. The snippet body should POST a log packet (Part 1 schema) to the session telemetry target. Use this (not raw edit) for telemetry so cleanup is reliable.",
		promptSnippet: "inject_snippet(path, line, name, language, code, id?) — add a delimited telemetry snippet to a file",
		promptGuidelines: [
			"Always wrap telemetry code in AI_DEBUG_SNIPPET_START/END delimiters by using inject_snippet (not raw edit), so cleanup can remove it reliably.",
			"The snippet body must POST a packet matching the log schema (log_id, event_timestamp, level, source{file,line,function}, message, optional variables) to the current telemetry target.",
			"Use remove_snippet / cleanup_all_snippets to remove telemetry. Fixes are separate from snippets and are kept on cleanup.",
			"commentStyleFor dispatches by language: block (C-family incl. PHP), hash (Python/Ruby/Shell), liquid (Shopify {% comment %}). Liquid cannot POST from the template — emit telemetry from the surrounding host app.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "File to instrument (relative to cwd; a leading @ is stripped)." }),
			line: Type.Integer({ description: "1-based line where the snippet is inserted (its first line)." }),
			name: Type.String({ description: "Short human label for the snippet's purpose." }),
			language: Type.String({ description: 'Source language, e.g. "javascript", "python", "php", "liquid". Determines delimiter style (block/hash/liquid; default block).' }),
			code: Type.String({ description: "Telemetry body to wrap in delimiters. Must POST a Part-1-schema packet to the telemetry target." }),
			id: Type.Optional(Type.Integer({ description: "Optional snippet id. If omitted or already used, the next session id is assigned and returned." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (!getSnapshot()) return inert();
			const telemetryTarget = getSnapshot()!.telemetryTarget;
			const norm = params.path.replace(/^@+/, "");
			const abs = isAbsolute(norm) ? norm : resolve(ctx.cwd, norm);
			let reserved: number | null = null;
			try {
				const res = await withFileMutationQueue(abs, async () => {
					const content = await readFile(abs, "utf8");
					const lines = content.split("\n");
					const at = Math.max(1, Math.min(params.line, lines.length + 1));
					reserved = state.assignSnippetId(params.id); // reserves immediately (race-safe)
					const style = commentStyleFor(params.language);
					const block = generateSnippetBlock(reserved, params.name, params.language, params.code);
					const next = injectIntoLines(lines, at, block);
					await writeFile(abs, next.join("\n"), "utf8");
					state.trackSnippet(reserved, { file: abs, name: params.name, line: at }); // fill real info
					return { assigned: reserved, style, at };
				});
				return {
					content: [{ type: "text" as const, text: `Injected snippet ID=${res.assigned} (${res.style} style) into ${norm} at line ${res.at}. POST telemetry to ${telemetryTarget}.` }],
					details: undefined,
				};
			} catch (e) {
				if (reserved != null) state.untrackSnippet(reserved); // release reservation on failure
				return { content: [{ type: "text" as const, text: `inject_snippet failed: ${(e as Error).message}` }], details: undefined };
			}
		},
	});

	pi.registerTool({
		name: "remove_snippet",
		label: "Remove Telemetry Snippet",
		description: "Remove one snippet (by id) or all tracked snippets in a file. Keeps surrounding code intact.",
		promptSnippet: "remove_snippet(path, id?) / {path, all:true} — remove telemetry snippet(s) from a file",
		parameters: Type.Object({
			path: Type.String({ description: "File containing the snippet." }),
			id: Type.Optional(Type.Integer({ description: "Snippet id to remove. Required unless all is true." })),
			all: Type.Optional(Type.Boolean({ description: "If true, remove every tracked snippet in the file." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (!getSnapshot()) return inert();
			const norm = params.path.replace(/^@+/, "");
			const abs = isAbsolute(norm) ? norm : resolve(ctx.cwd, norm);
			try {
				const removed = await withFileMutationQueue(abs, async () => {
					const content = await readFile(abs, "utf8");
					let targetIds: Set<number>;
					if (params.all) {
						targetIds = new Set(
							Object.entries(state.getSnippetMap())
								.filter(([, info]) => info.file === abs)
								.map(([id]) => Number(id)),
						);
					} else if (params.id != null) {
						targetIds = new Set([params.id]);
					} else {
						throw new Error("remove_snippet requires `id` or `all: true`.");
					}
					const spans = findSnippets(content).filter((sp) => targetIds.has(sp.id));
					if (spans.length === 0) return 0;
					let lines = content.split("\n");
					spans.sort((a, b) => b.startLine - a.startLine);
					for (const sp of spans) lines = removeSpan(lines, sp.startLine, sp.endLine);
					await writeFile(abs, lines.join("\n"), "utf8");
					for (const id of targetIds) state.untrackSnippet(id);
					return spans.length;
				});
				return {
					content: [{ type: "text" as const, text: `Removed ${removed} snippet(s) from ${norm}.` }],
					details: undefined,
				};
			} catch (e) {
				return { content: [{ type: "text" as const, text: `remove_snippet failed: ${(e as Error).message}` }], details: undefined };
			}
		},
	});

	pi.registerTool({
		name: "list_snippets",
		label: "List Telemetry Snippets",
		description: "List tracked snippets (session registry), or scan a specific file for snippet delimiters on disk.",
		promptSnippet: "list_snippets(path?) — list tracked snippets, or scan a file",
		parameters: Type.Object({
			path: Type.Optional(Type.String({ description: "Optional file to scan on disk; omit to list all tracked snippets." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (!getSnapshot()) return inert();
			if (params.path) {
				const norm = params.path.replace(/^@+/, "");
				const abs = isAbsolute(norm) ? norm : resolve(ctx.cwd, norm);
				const content = await readFile(abs, "utf8").catch(() => "");
				const spans = findSnippets(content).map((sp) => ({ id: sp.id, name: sp.name, file: norm, line: sp.startLine }));
				return { content: [{ type: "text" as const, text: JSON.stringify(spans, null, 2) }], details: undefined };
			}
			const tracked = Object.entries(state.getSnippetMap()).map(([id, info]) => ({
				id: Number(id),
				name: info.name,
				file: info.file,
				line: info.line,
			}));
			return { content: [{ type: "text" as const, text: JSON.stringify(tracked, null, 2) }], details: undefined };
		},
	});

	pi.registerTool({
		name: "cleanup_all_snippets",
		label: "Cleanup All Snippets",
		description: "Remove every tracked telemetry snippet from the session. Keeps any accepted fix (snippets ≠ fix). Called automatically on /debugger stop and after a fix is accepted.",
		promptSnippet: "cleanup_all_snippets() — remove all telemetry snippets, keep fixes",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, _ctx) {
			if (!getSnapshot()) return inert();
			const res = await cleanupAllSnippets();
			const errs = res.errors.length ? ` Errors: ${res.errors.join("; ")}` : "";
			return {
				content: [{ type: "text" as const, text: `Removed ${res.removed} snippet(s).${errs} The fix code is kept.` }],
				details: undefined,
			};
		},
	});
}

/**
 * Register the `report_bug` tool (LLM-side producer for the bug summary shown in
 * the instrumentation widget). The mutation helper `applyBug` is owned by
 * index.ts — it also serves the `/debugger bug` command and touches
 * session-owned state — so it is passed in here rather than duplicated.
 */
export function registerReportBugTool(
	pi: ExtensionAPI,
	getSnapshot: () => DebugSnapshot | null,
	applyBug: (ctx: ExtensionContext, summary: string | null) => void,
): void {
	pi.registerTool({
		name: "report_bug",
		label: "Report Bug",
		description:
			"Record the bug under investigation in the debugger instrumentation widget. Call once you have enough context to state the bug clearly; call again to revise. Only effective during a /debugger session.",
		promptSnippet: "report_bug(summary) — record/revise the bug summary shown in the debugger widget",
		promptGuidelines: [
			"During a /debugger session, once you have enough context to state the bug, call report_bug(summary) with a concise description; multi-line summaries are supported.",
			"Revise the summary by calling report_bug again if your understanding changes.",
		],
		parameters: Type.Object({
			summary: Type.String({
				description: "Concise summary of the bug under investigation. May span multiple lines.",
			}),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (!getSnapshot()) return inert();
			const summary = typeof params.summary === "string" ? params.summary : "";
			applyBug(ctx, summary);
			return {
				content: [
					{
						type: "text" as const,
						text: summary.trim() ? `Bug summary recorded:\n${summary}` : "Bug summary cleared (empty input.)",
					},
				],
				details: undefined,
			};
		},
	});
}

/** Accessor the transition tools need from index.ts (session-owned concerns). */
export interface TransitionAccessor {
	isActive: () => boolean;
	getSnapshot: () => DebugSnapshot | null;
	/** Repaint the widget from the current snapshot. */
	repaint: () => void;
	/** Stop the debug session (debug_summary "Exit"). */
	stop: (ctx: ExtensionContext) => Promise<void>;
}

/** Register the debugging-loop transition tools. */
export function registerTransitionTools(pi: ExtensionAPI, a: TransitionAccessor): void {
	pi.registerTool({
		name: "report_hypothesis",
		label: "Report Hypothesis",
		description:
			"Record the current defect hypothesis (suspected cause + files/functions). Transitions the debugger to HYPOTHESIS & BUG VALIDATION and resets the attempt counter.",
		promptSnippet: "report_hypothesis(hypothesis, files?, functions?) — state the suspected cause",
		promptGuidelines: [
			"Once you have enough context to form a hypothesis, call report_hypothesis with the suspected cause (and the files/functions involved). Then use inject_snippet to add telemetry and request_user_test to ask the user to reproduce.",
		],
		parameters: Type.Object({
			hypothesis: Type.String({ description: "The suspected cause of the bug." }),
			files: Type.Optional(Type.Array(Type.String(), { description: "Suspected source files." })),
			functions: Type.Optional(Type.Array(Type.String(), { description: "Suspected functions/methods." })),
		}),
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			if (!a.isActive()) return inert();
			const detail = [
				params.files?.length ? `Files: ${params.files.join(", ")}` : "",
				params.functions?.length ? `Functions: ${params.functions.join(", ")}` : "",
			]
				.filter(Boolean)
				.join("\n");
			state.reportHypothesis(detail ? `${params.hypothesis}\n${detail}` : params.hypothesis);
			const s = state.getState()!;
			return {
				content: [
					{
						type: "text" as const,
						text: `Hypothesis #${s.hypothesisCount} recorded (state → HYPOTHESIS & BUG VALIDATION). Inject telemetry with inject_snippet, then call request_user_test with reproduction steps.`,
					},
				],
				details: undefined,
			};
		},
	});

	pi.registerTool({
		name: "request_user_test",
		label: "Request User Test",
		description:
			'Show reproduction steps and ask the user whether the bug is fixed. Advances the loop: "Bug Fixed" → telemetry cleanup (fix kept), then call debug_summary; "Continue to Debug" → revert the fix + re-instrument (or, at max attempts, back to AWAITING CONTEXT).',
		promptSnippet: "request_user_test(steps) — ask the user to reproduce; their answer advances the loop",
		parameters: Type.Object({
			steps: Type.Array(Type.String(), { description: "Step-by-step reproduction instructions for the user." }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (!a.isActive()) return inert();
			const snap = a.getSnapshot();
			if (snap) {
				snap.body = [...params.steps, "", "↑ Reply:  (1) Bug Fixed   (2) Continue to Debug"];
				a.repaint();
			}
			const choice = await ctx.ui.select("Reproduced?", ["Bug Fixed", "Continue to Debug"]);
			const max = state.DEFAULT_MAX_ATTEMPTS;
			if (choice === "Bug Fixed") {
				await cleanupAllSnippets();
				state.recordTestResult("fixed");
				return {
					content: [
						{ type: "text" as const, text: "Marked BUG FIXED — telemetry removed, fix kept. Call debug_summary with a summary of the bug and the fix." },
					],
					details: undefined,
				};
			}
			await cleanupAllSnippets();
			const result = state.recordTestResult("continue");
			if (result === "AWAITING CONTEXT") {
				return {
					content: [
						{
							type: "text" as const,
							text: `Still broken after ${max} attempts → back to AWAITING CONTEXT. Ask the user for more context (logs, stack trace, screenshots, etc.).`,
						},
					],
					details: undefined,
				};
			}
			const s = state.getState()!;
			return {
				content: [
					{
						type: "text" as const,
						text: `Not fixed (attempt ${s.attempts}/${max}); telemetry removed. Revert your failed fix, then call report_hypothesis with a new hypothesis.`,
					},
				],
				details: undefined,
			};
		},
	});

	pi.registerTool({
		name: "debug_summary",
		label: "Debug Summary",
		description: "Finalize: show a bug+fix summary and ask the user to exit Debug mode or continue with a new bug.",
		promptSnippet: "debug_summary(summary) — wrap up after a fix is accepted",
		parameters: Type.Object({
			summary: Type.String({ description: "Summary of the bug and the fix applied." }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (!a.isActive()) return inert();
			state.transition("DEBUG SUMMARY");
			const snap = a.getSnapshot();
			if (snap) {
				snap.body = [params.summary, "", "↑ Reply:  (1) Exit Debug mode   (2) Continue (new bug)"];
				a.repaint();
			}
			const choice = await ctx.ui.select("Debug complete — what next?", ["Exit Debug mode", "Continue (new bug)"]);
			if (choice?.startsWith("Exit")) {
				await a.stop(ctx);
				return { content: [{ type: "text" as const, text: "Debug session stopped." }], details: undefined };
			}
			state.resetForNewBug();
			return { content: [{ type: "text" as const, text: "Reset to AWAITING CONTEXT — ready for a new bug." }], details: undefined };
		},
	});
}
