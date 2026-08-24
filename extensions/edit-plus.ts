/**
 * Edit-Plus Extension — a superset of the built-in `edit` tool, registered
 * under the NEW name "edit-plus" (no built-in collision, no override
 * warning). Enable/disable it per session with /tools.
 *
 * Superset features over the built-in edit tool:
 *
 * 1. edits[].replaceAll — replace EVERY occurrence of oldText in one call
 *    instead of requiring uniqueness (kills the bash+sed detour for bulk
 *    renames like test-assertion format changes).
 *
 * 2. edits[].ignoreWhitespace — match oldText ignoring indentation and
 *    trailing-whitespace differences. The tool fuzzy-locates the region,
 *    extracts the file's ACTUAL bytes, then applies an exact edit.
 *
 * 3. Diagnostic match errors (unconditional) — when an edit fails to match,
 *    the error includes the closest match's line number + a snippet of the
 *    actual file content vs the attempted oldText. Non-unique matches list
 *    every occurrence's line number.
 *
 * 4. Stale-read warning (unconditional) — if the file changed on disk after
 *    it was last read in this session, a one-line warning is appended.
 *
 * Architecture: exact-match edits are DELEGATED to the built-in tool
 * definition (createEditToolDefinition), so upstream fixes keep flowing
 * through. Rendering is inherited by lifting the built-in renderCall /
 * renderResult (verified: the TUI provides `state` + `cwd` in the render
 * context for any tool, and renderer exceptions fall back gracefully).
 *
 * Ordering within one call: replaceAll edits are applied first (mutating
 * the file), then ignoreWhitespace edits are rewritten to exact oldText,
 * then the exact-match batch is delegated atomically. If a later edit
 * fails, earlier replaceAll changes remain applied — prefer dedicated
 * calls when mixing.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createEditToolDefinition,
	generateDiffString,
	generateUnifiedPatch,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { constants } from "fs";
import { access as fsAccess, readFile as fsReadFile, stat as fsStat, writeFile as fsWriteFile } from "fs/promises";
import { resolve as resolvePath } from "path";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Built-in delegation plumbing
// ---------------------------------------------------------------------------

/** Prototype used only for prepareArguments / renderers (cwd-independent). */
const proto = createEditToolDefinition(process.cwd());

const builtinCache = new Map<string, ReturnType<typeof createEditToolDefinition>>();

function builtinFor(cwd: string) {
	let b = builtinCache.get(cwd);
	if (!b) {
		b = createEditToolDefinition(cwd);
		builtinCache.set(cwd, b);
	}
	return b;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const editPlusItemSchema = Type.Object(
	{
		oldText: Type.String({
			description:
				"Exact text for one targeted replacement. Must be unique in the original file and not overlap other edits[].oldText. With replaceAll, every occurrence is replaced and uniqueness is not required. With ignoreWhitespace, indentation/trailing-whitespace differences are tolerated.",
		}),
		newText: Type.String({ description: "Replacement text for this targeted edit." }),
		replaceAll: Type.Optional(
			Type.Boolean({
				description:
					"Replace EVERY occurrence of oldText instead of requiring a unique match. Applied before other edits in the same call.",
			}),
		),
		ignoreWhitespace: Type.Optional(
			Type.Boolean({
				description:
					"Match oldText ignoring whitespace differences (indentation, trailing spaces). The file's actual bytes for the matched region are replaced.",
			}),
		),
	},
	{},
);

const editPlusSchema = Type.Object(
	{
		path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
		edits: Type.Array(editPlusItemSchema, {
			description:
				"One or more targeted replacements, matched against the original file (not incrementally). replaceAll edits are applied first; avoid mixing replaceAll with edits that target the same region.",
		}),
	},
	{},
);

interface EditPlusItem {
	oldText: string;
	newText: string;
	replaceAll?: boolean;
	ignoreWhitespace?: boolean;
}

interface EditPlusInput {
	path: string;
	edits: EditPlusItem[];
}

interface IndexedEdit {
	i: number;
	oldText: string;
	newText: string;
	ignoreWhitespace: boolean;
}

// ---------------------------------------------------------------------------
// Stale-read tracking (feature 4)
// ---------------------------------------------------------------------------

const readMtimes = new Map<string, number>(); // absolute path -> mtimeMs at last read
const MAX_TRACKED = 400;

async function recordMtime(absPath: string): Promise<void> {
	try {
		const s = await fsStat(absPath);
		readMtimes.delete(absPath);
		readMtimes.set(absPath, s.mtimeMs);
		if (readMtimes.size > MAX_TRACKED) {
			const oldest = readMtimes.keys().next().value;
			if (oldest !== undefined) readMtimes.delete(oldest);
		}
	} catch {
		// File may no longer exist — nothing to record.
	}
}

async function staleReadNote(absPath: string): Promise<string | null> {
	const lastRead = readMtimes.get(absPath);
	if (lastRead === undefined) return null;
	try {
		const s = await fsStat(absPath);
		if (s.mtimeMs > lastRead + 1) {
			return `⚠ Note: this file changed on disk after it was last read in this session — verify the edit targets the content you expect.`;
		}
	} catch {
		// ignore
	}
	return null;
}

// ---------------------------------------------------------------------------
// Content helpers (BOM / line endings — mirrors built-in handling)
// ---------------------------------------------------------------------------

function stripBom(text: string): { bom: string; text: string } {
	return text.charCodeAt(0) === 0xfeff ? { bom: "\ufeff", text: text.slice(1) } : { bom: "", text };
}

function detectLineEnding(text: string): string {
	if (text.includes("\r\n")) return "\r\n";
	return text.includes("\r") ? "\r" : "\n";
}

function restoreLineEndings(content: string, ending: string): string {
	return ending === "\n" ? content : content.replace(/\n/g, ending);
}

/** Read a file and return LF-normalized, BOM-stripped content for matching. */
async function readForMatch(absPath: string, displayPath: string): Promise<string> {
	const raw = (await fsReadFile(absPath)).toString("utf-8");
	return stripBom(raw).text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

// ---------------------------------------------------------------------------
// Whitespace-insensitive matching (feature 2 + error diagnostics)
// ---------------------------------------------------------------------------

function normalizeWsLine(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

/** All line-index ranges whose whitespace-normalized content matches oldText. */
function fuzzyFindAll(content: string, oldText: string): Array<{ startLine: number; endLine: number }> {
	const lines = content.split("\n");
	const norm = lines.map(normalizeWsLine);
	let pattern = oldText.split("\n").map(normalizeWsLine);
	while (pattern.length > 0 && pattern[0] === "") pattern.shift();
	while (pattern.length > 0 && pattern[pattern.length - 1] === "") pattern.pop();
	if (pattern.length === 0) return [];

	const out: Array<{ startLine: number; endLine: number }> = [];
	for (let i = 0; i + pattern.length <= lines.length; i++) {
		let ok = true;
		for (let p = 0; p < pattern.length; p++) {
			if (norm[i + p] !== pattern[p]) {
				ok = false;
				break;
			}
		}
		if (ok) out.push({ startLine: i, endLine: i + pattern.length - 1 });
	}
	return out;
}

/** Token-level Dice similarity per line (0–1). Underscore/space and case differences score high. */
function lineSimilarity(a: string, b: string): number {
	const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
	const ta = tokens(a);
	const tb = tokens(b);
	if (ta.size === 0 && tb.size === 0) return 1;
	if (ta.size === 0 || tb.size === 0) return 0;
	let inter = 0;
	for (const t of ta) if (tb.has(t)) inter++;
	return (2 * inter) / (ta.size + tb.size);
}

/**
 * Best-effort closest match: window with the highest average token-similarity
 * against oldText's lines. Returns the 1-based start line and score (0–1).
 */
function findClosestMatch(content: string, oldText: string): { line: number; score: number } | null {
	const contentLines = content.split("\n");
	let pattern = oldText.split("\n").map((l) => l.trim());
	while (pattern.length > 0 && pattern[0] === "") pattern.shift();
	while (pattern.length > 0 && pattern[pattern.length - 1] === "") pattern.pop();
	if (pattern.length === 0 || contentLines.length === 0) return null;

	let best: { line: number; score: number } | null = null;
	for (let i = 0; i + pattern.length <= contentLines.length; i++) {
		let sum = 0;
		for (let p = 0; p < pattern.length; p++) {
			sum += lineSimilarity(contentLines[i + p], pattern[p]);
		}
		const score = sum / pattern.length;
		if (best === null || score > best.score) best = { line: i, score };
		if (score === 1) break;
	}
	return best;
}

/** Line numbers (1-based) of every exact occurrence of text in content. */
function exactOccurrencesWithLines(content: string, text: string): number[] {
	if (!text) return [];
	const lineStarts: number[] = [];
	for (let i = 0; i < content.length; i++) {
		if (i === 0 || content[i - 1] === "\n") lineStarts.push(i);
	}
	const lineForOffset = (offset: number): number => {
		let lo = 0;
		let hi = lineStarts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (lineStarts[mid] <= offset) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	};
	const out: number[] = [];
	let from = 0;
	let idx = content.indexOf(text, from);
	while (idx !== -1) {
		out.push(lineForOffset(idx) + 1);
		from = idx + text.length;
		idx = content.indexOf(text, from);
	}
	return out;
}

function snippet(text: string, maxLines = 5): string {
	const lines = text.split("\n");
	const shown = lines.slice(0, maxLines).map((l) => `  | ${l}`);
	if (lines.length > maxLines) shown.push(`  | … (${lines.length - maxLines} more line(s))`);
	return shown.join("\n");
}

// ---------------------------------------------------------------------------
// Enriched errors (feature 3)
// ---------------------------------------------------------------------------

/**
 * Catch built-in match failures and append diagnostics: closest-match line +
 * actual-vs-attempted snippet for not-found; occurrence line numbers for
 * non-unique. Handles BOTH message variants the built-in emits (indexed
 * "edits[N]" for multi-edit batches, legacy plain text for single edits).
 * `plainEdits` maps delegated indexes back to user-visible ones.
 */
async function enrichEditError(
	err: unknown,
	displayPath: string,
	absPath: string,
	plainEdits: IndexedEdit[],
): Promise<Error> {
	const original = err instanceof Error ? err : new Error(String(err));
	const message = original.message;

	const isNotFound = /Could not find (?:edits\[\d+\] in|the exact text in)/.test(message);
	const isNotUnique = /Found \d+ occurrences of (?:edits\[\d+\]|the text) in/.test(message);
	if (!isNotFound && !isNotUnique) return original;

	const indexMatch = message.match(/edits\[(\d+)\]/);
	const delegatedIdx = indexMatch ? Number(indexMatch[1]) : 0; // legacy variant = single edit = index 0
	const e = plainEdits[delegatedIdx];
	if (!e) return original;
	const userLabel = `edits[${e.i}]`;

	let content: string;
	try {
		content = await readForMatch(absPath, displayPath);
	} catch {
		return original;
	}

	const extra: string[] = [];
	if (isNotUnique) {
		const lines = exactOccurrencesWithLines(content, e.oldText);
		extra.push(
			`Hint: ${userLabel} oldText occurs at line(s) ${lines.join(", ")}. Extend oldText with a surrounding line to disambiguate.`,
		);
	} else {
		const best = findClosestMatch(content, e.oldText);
		if (best && best.score >= 0.3) {
			extra.push(
				`Hint: closest match for ${userLabel} is at line ${best.line + 1} (${Math.round(best.score * 100)}% line similarity).`,
			);
			const actual = content.split("\n").slice(best.line, best.line + e.oldText.split("\n").length).join("\n");
			extra.push(`Attempted oldText:\n${snippet(e.oldText)}`);
			extra.push(`Actual file content at line ${best.line + 1}:\n${snippet(actual)}`);
		} else {
			extra.push(
				`Hint: no similar region found for ${userLabel} — the text may not exist, the file may have changed since it was read, or the difference may be invisible (unicode / whitespace). Re-read the file.`,
			);
		}
	}

	return new Error(`${message}\n${extra.join("\n")}`);
}

function noFuzzyMatchMessage(displayPath: string, e: IndexedEdit, content: string): string {
	const best = findClosestMatch(content, e.oldText);
	const where = best && best.score >= 0.3 ? ` Closest normalized match is at line ${best.line + 1} (${Math.round(best.score * 100)}%).` : "";
	return (
		`Could not find edits[${e.i}] in ${displayPath} even with whitespace-insensitive matching.${where}\n` +
		`Attempted oldText:\n${snippet(e.oldText)}`
	);
}

// ---------------------------------------------------------------------------
// replaceAll application (feature 1)
// ---------------------------------------------------------------------------

interface ReplaceAllOutcome {
	totalReplacements: number;
	diff: string;
	patch: string;
	firstChangedLine?: number;
}

async function applyReplaceAllEdits(
	absPath: string,
	displayPath: string,
	edits: IndexedEdit[],
	signal?: AbortSignal,
): Promise<ReplaceAllOutcome> {
	const throwIfAborted = () => {
		if (signal?.aborted) throw new Error("Operation aborted");
	};

	try {
		await fsAccess(absPath, constants.R_OK | constants.W_OK);
	} catch (error: any) {
		throw new Error(`Could not edit file: ${displayPath}. Error code: ${error?.code}.`);
	}

	throwIfAborted();
	const raw = (await fsReadFile(absPath)).toString("utf-8");
	const { bom, text } = stripBom(raw);
	const ending = detectLineEnding(text);
	const before = ending === "\n" ? text : text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

	let total = 0;
	let content = before;
	const perEditCounts: number[] = [];

	for (const e of edits) {
		throwIfAborted();
		let count = 0;

		if (e.ignoreWhitespace) {
			// Fuzzy line-based replacement: replace each matched region with newText.
			const occurrences = fuzzyFindAll(content, e.oldText);
			const lines = content.split("\n");
			for (let k = occurrences.length - 1; k >= 0; k--) {
				const { startLine, endLine } = occurrences[k];
				lines.splice(startLine, endLine - startLine + 1, ...e.newText.split("\n"));
				count++;
			}
			content = lines.join("\n");
		} else {
			// Exact replacement of every occurrence; guard against newText containing oldText.
			let from = 0;
			let idx = content.indexOf(e.oldText, from);
			while (idx !== -1) {
				content = content.slice(0, idx) + e.newText + content.slice(idx + e.oldText.length);
				count++;
				from = idx + e.newText.length;
				idx = content.indexOf(e.oldText, from);
			}
		}

		perEditCounts.push(count);
		total += count;
	}

	if (total === 0) {
		// Nothing matched — fail loudly with diagnostics instead of a silent no-op.
		const e = edits[0];
		const best = findClosestMatch(content, e.oldText);
		const hint =
			best && best.score >= 0.3
				? ` Closest match is at line ${best.line + 1} (${Math.round(best.score * 100)}% line similarity).\nActual file content there:\n${snippet(content.split("\n").slice(best.line, best.line + e.oldText.split("\n").length).join("\n"))}`
				: "";
		throw new Error(
			`replaceAll edits found 0 occurrences in ${displayPath}.\nAttempted oldText:\n${snippet(e.oldText)}${hint}`,
		);
	}

	throwIfAborted();
	await fsWriteFile(absPath, bom + restoreLineEndings(content, ending), "utf-8");

	const diffResult = generateDiffString(before, content);
	const patch = generateUnifiedPatch(displayPath, before, content);
	return {
		totalReplacements: total,
		diff: diffResult.diff,
		patch,
		firstChangedLine: diffResult.firstChangedLine,
	};
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	// Track file mtimes at read/edit/write time so edit-plus can warn when the
	// on-disk content is newer than what was last read. Await so the mtime is
	// recorded before the tool result is delivered (avoids a same-turn race).
	pi.on("tool_result", async (event: any, ctx: any) => {
		const tool = event?.toolName;
		const input = event?.input;
		if (event?.isError || typeof input?.path !== "string") return;
		if (tool === "read" || tool === "edit" || tool === "edit-plus" || tool === "write") {
			const cwd = typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd();
			await recordMtime(resolvePath(cwd, input.path));
		}
	});

	pi.registerTool({
		name: "edit-plus",
		label: "edit-plus",
		description:
			"Edit a single file using exact text replacement — a superset of the built-in edit tool. Supports edits[].replaceAll (replace every occurrence in one call), edits[].ignoreWhitespace (tolerate indentation/whitespace differences), diagnostic match-failure errors (closest-match line + actual-vs-attempted snippet), and a stale-read warning when the file changed since it was last read.",
		promptSnippet:
			"Edit files with exact text replacement plus replaceAll, whitespace-tolerant matching, and diagnostic match errors",
		promptGuidelines: [
			"Use edit-plus for file edits — it is a superset of edit (same exact-match semantics, better failure diagnostics).",
			"Use edit-plus edits[].replaceAll to replace every occurrence of a pattern in one call (e.g. bulk renames) instead of bash+sed.",
			"Use edit-plus edits[].ignoreWhitespace when oldText indentation or trailing whitespace may differ from the file.",
		],
		parameters: editPlusSchema,

		// Reuse the built-in legacy-shim (folds top-level oldText/newText into edits[]).
		prepareArguments: proto.prepareArguments?.bind(proto),

		// Inherit the built-in diff-preview/diff-result UI. Verified safe: the TUI
		// render context always provides `state` + `cwd`, and renderer exceptions
		// fall back to a plain rendering.
		renderCall: (proto as any).renderCall?.bind(proto),
		renderResult: (proto as any).renderResult?.bind(proto),
		renderShell: proto.renderShell,

		async execute(toolCallId, params: any, signal, onUpdate, ctx) {
			const input = params as EditPlusInput;
			if (!Array.isArray(input?.edits) || input.edits.length === 0) {
				throw new Error("Edit tool input is invalid. edits must contain at least one replacement.");
			}
			const displayPath = input.path;
			const cwd = typeof ctx?.cwd === "string" ? ctx.cwd : process.cwd();
			const absPath = resolvePath(cwd, displayPath);

			const staleNote = await staleReadNote(absPath);

			const replaceAllEdits: IndexedEdit[] = [];
			const plainEdits: IndexedEdit[] = [];
			input.edits.forEach((e, i) => {
				const entry: IndexedEdit = { i, oldText: e.oldText, newText: e.newText, ignoreWhitespace: !!e.ignoreWhitespace };
				(e.replaceAll ? replaceAllEdits : plainEdits).push(entry);
			});

			const notes: string[] = [];
			const diffParts: string[] = [];
			const patchParts: string[] = [];
			let firstChangedLine: number | undefined;

			// Phase 1 — replaceAll (mutates the file; runs before other edits).
			if (replaceAllEdits.length > 0) {
				const outcome = await withFileMutationQueue(absPath, () =>
					applyReplaceAllEdits(absPath, displayPath, replaceAllEdits, signal),
				);
				notes.push(`Replaced ${outcome.totalReplacements} occurrence(s) across ${replaceAllEdits.length} replaceAll edit(s).`);
				diffParts.push(outcome.diff);
				patchParts.push(outcome.patch);
				if (outcome.firstChangedLine !== undefined) {
					firstChangedLine = Math.min(firstChangedLine ?? Infinity, outcome.firstChangedLine);
				}
				void recordMtime(absPath);
			}

			// Phase 2 — rewrite ignoreWhitespace edits to the file's exact bytes,
			// then delegate the whole batch atomically to the built-in tool.
			if (plainEdits.length > 0) {
				let content: string;
				try {
					content = await readForMatch(absPath, displayPath);
				} catch (error: any) {
					throw new Error(`Could not edit file: ${displayPath}. Error code: ${error?.code}.`);
				}

				const delegated: Array<{ oldText: string; newText: string }> = [];
				const lines = content.split("\n");
				for (const e of plainEdits) {
					if (!e.ignoreWhitespace) {
						delegated.push({ oldText: e.oldText, newText: e.newText });
						continue;
					}
					const occurrences = fuzzyFindAll(content, e.oldText);
					if (occurrences.length === 0) {
						throw new Error(noFuzzyMatchMessage(displayPath, e, content));
					}
					if (occurrences.length > 1) {
						const where = occurrences.map((o) => o.startLine + 1).join(", ");
						throw new Error(
							`ignoreWhitespace edits[${e.i}] in ${displayPath} is ambiguous — whitespace-insensitive matches at line(s) ${where}. Extend oldText with a surrounding line to make it unique.`,
						);
					}
					const { startLine, endLine } = occurrences[0];
					delegated.push({
						oldText: lines.slice(startLine, endLine + 1).join("\n"),
						newText: e.newText,
					});
				}

				const builtin = builtinFor(cwd);
				let result: any;
				try {
					result = await builtin.execute(toolCallId, { path: displayPath, edits: delegated }, signal, onUpdate, ctx);
				} catch (err) {
					throw await enrichEditError(err, displayPath, absPath, plainEdits);
				}

				if (result?.details) {
					if (typeof result.details.diff === "string" && result.details.diff.length > 0) diffParts.push(result.details.diff);
					if (typeof result.details.patch === "string" && result.details.patch.length > 0) patchParts.push(result.details.patch);
					if (typeof result.details.firstChangedLine === "number") {
						firstChangedLine = Math.min(firstChangedLine ?? Infinity, result.details.firstChangedLine);
					}
				}
				if (result?.content?.[0]?.text) notes.push(result.content[0].text);
			}

			if (staleNote) notes.push(staleNote);

			return {
				content: [{ type: "text" as const, text: notes.join(" ") }],
				details: {
					diff: diffParts.join("\n"),
					patch: patchParts.join("\n"),
					...(firstChangedLine !== undefined ? { firstChangedLine } : {}),
				},
			};
		},
	});
}
