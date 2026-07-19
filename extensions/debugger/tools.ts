/**
 * Snippet tools — inject / remove / list / cleanup delimited telemetry snippets.
 *
 * Registered via {@link registerSnippetTools}, which is called once from
 * index.ts with an accessor for the active session snapshot. Each tool is gated
 * on an active debug session (inert info result otherwise — there is no tool
 * unregister API, mirroring `report_bug`). Pure file-mutation helpers come from
 * ./snippets.ts; this module owns the in-memory snippet registry.
 *
 * Reference: docs/04-snippet-injection-cleanup.md
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DebugSnapshot } from "./widget.ts";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { commentStyleFor, findSnippets, generateSnippetBlock, injectIntoLines, removeSpan } from "./snippets.ts";

/** A snippet tracked in the session registry. */
interface TrackedSnippet {
	/** Absolute file path. */
	file: string;
	/** Human label. */
	name: string;
	/** 1-based line of the START delimiter (where it was injected). */
	line: number;
}

/** Session snippet registry: id → tracked snippet. */
const registry = new Map<number, TrackedSnippet>();
/** Next auto-assigned snippet id. */
let nextId = 1;

/** Clear the registry and reset the id counter (called on session start/stop). */
export function resetSnippets(): void {
	registry.clear();
	nextId = 1;
}

/**
 * Resolve a snippet id. If `requested` is present and unused it is taken as-is;
 * otherwise the next free session id is auto-assigned (hybrid policy).
 */
function assignId(requested: number | undefined): number {
	if (requested != null && !registry.has(requested)) return requested;
	while (registry.has(nextId)) nextId++;
	return nextId++;
}

/**
 * Remove every tracked snippet from disk (called by the `cleanup_all_snippets`
 * tool and by `/debugger stop`). Keeps any accepted fix — snippets ≠ fix.
 * Per-file read-modify-write runs inside `withFileMutationQueue`. Best-effort:
 * returns a per-file error list rather than throwing.
 */
export async function cleanupAllSnippets(): Promise<{ removed: number; errors: string[] }> {
	let removed = 0;
	const errors: string[] = [];
	// Group tracked ids by file so each file is mutated once.
	const byFile = new Map<string, Set<number>>();
	for (const [id, s] of registry) {
		const set = byFile.get(s.file) ?? new Set<number>();
		set.add(id);
		byFile.set(s.file, set);
	}
	for (const [file, ids] of byFile) {
		try {
			removed += await withFileMutationQueue(file, async () => {
				const content = await readFile(file, "utf8");
				const spans = findSnippets(content).filter((sp) => ids.has(sp.id));
				if (spans.length === 0) return 0;
				let lines = content.split("\n");
				// Remove bottom-to-top so earlier line numbers stay valid.
				spans.sort((a, b) => b.startLine - a.startLine);
				for (const sp of spans) lines = removeSpan(lines, sp.startLine, sp.endLine);
				await writeFile(file, lines.join("\n"), "utf8");
				return spans.length;
			});
		} catch (e) {
			errors.push(`${file}: ${(e as Error).message}`);
		}
	}
	registry.clear();
	return { removed, errors };
}

/** Inert result returned when no debug session is active. */
const inert = () => ({
	content: [{ type: "text" as const, text: "No active debug session. Start one with /debugger." }],
	details: undefined,
});

/**
 * Register the four snippet tools (inject / remove / list / cleanup) on `pi`.
 * `getSnapshot` returns the live session snapshot or null; tools are inert when
 * it is null.
 */
export function registerSnippetTools(pi: ExtensionAPI, getSnapshot: () => DebugSnapshot | null): void {
	pi.registerTool({
		name: "inject_snippet",
		label: "Inject Telemetry Snippet",
		description:
			"Insert a delimited telemetry snippet into a source file. The snippet body should POST a log packet (Part 1 schema) to the session telemetry target. Use this (not raw edit) for telemetry so cleanup is reliable.",
		promptSnippet: "inject_snippet(path, line, name, language, code, id?) — add a delimited telemetry snippet to a file",
		promptGuidelines: [
			"Always wrap telemetry code in AI_DEBUG_SNIPPET_START/END delimiters by using inject_snippet (not raw edit), so cleanup_all_snippets can remove it reliably.",
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
			try {
				const res = await withFileMutationQueue(abs, async () => {
					const content = await readFile(abs, "utf8");
					const lines = content.split("\n");
					const at = Math.max(1, Math.min(params.line, lines.length + 1));
					const assigned = assignId(params.id);
					const style = commentStyleFor(params.language);
					const block = generateSnippetBlock(assigned, params.name, params.language, params.code);
					const next = injectIntoLines(lines, at, block);
					await writeFile(abs, next.join("\n"), "utf8");
					registry.set(assigned, { file: abs, name: params.name, line: at });
					return { assigned, style, at };
				});
				return {
					content: [{ type: "text" as const, text: `Injected snippet ID=${res.assigned} (${res.style} style) into ${norm} at line ${res.at}. POST telemetry to ${telemetryTarget}.` }],
					details: undefined,
				};
			} catch (e) {
				return { content: [{ type: "text" as const, text: `inject_snippet failed: ${(e as Error).message}` }], details: undefined };
			}
		},
	});

	pi.registerTool({
		name: "remove_snippet",
		label: "Remove Telemetry Snippet",
		description: "Remove one snippet (by id) or all tracked snippets from a file. Keeps surrounding code intact.",
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
							[...registry.entries()].filter(([, s]) => s.file === abs).map(([id]) => id),
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
					for (const id of targetIds) registry.delete(id);
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
			const tracked = [...registry.entries()].map(([id, s]) => ({ id, name: s.name, file: s.file, line: s.line }));
			return { content: [{ type: "text" as const, text: JSON.stringify(tracked, null, 2) }], details: undefined };
		},
	});

	pi.registerTool({
		name: "cleanup_all_snippets",
		label: "Cleanup All Snippets",
		description: "Remove every tracked telemetry snippet from the session. Keeps any accepted fix (snippets ≠ fix). Called automatically on /debugger stop.",
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
 * session-owned state (snapshot/paintUi) — so it is passed in here rather than
 * duplicated. Inert when no session is active.
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
