/**
 * Pure snippet helpers — delimiter generation, parsing, and line-level
 * insertion/removal. No pi APIs, no session state, no I/O. Unit-testable in
 * isolation (no imports at all).
 *
 * Three comment styles (see docs/04-snippet-injection-cleanup.md):
 *   - block  : C-family block-comment delimiters — JS/TS/Java/C/C++/Go/Rust/CSS/PHP/...
 *   - hash   : hash line comments — Python/Ruby/Shell/YAML/TOML/...
 *   - liquid : Liquid comment tags (comment / endcomment) — Shopify templates
 *
 * Liquid can't POST telemetry itself; the surrounding host app does. The
 * delimiters just keep the template syntactically valid (marker support).
 */

/** Delimiter comment style for a language. `"block"` is the default. */
export type CommentStyle = "block" | "hash" | "liquid";

/** A located START…END snippet span within a file's text. */
export interface SnippetSpan {
	/** Snippet id (from the START delimiter). */
	id: number;
	/** Snippet name (from the START delimiter). */
	name: string;
	/** 1-based line of the START delimiter. */
	startLine: number;
	/** 1-based line of the END delimiter. */
	endLine: number;
}

const START_TOKEN = "AI_DEBUG_SNIPPET_START";
const END_TOKEN = "AI_DEBUG_SNIPPET_END";

/** Languages that use `#` line comments. Everything else defaults to block. */
const HASH_LANGS = new Set([
	"py", "python",
	"rb", "ruby",
	"sh", "shell", "bash", "zsh",
	"yaml", "yml",
	"toml",
	"pl", "perl",
	"r",
	"dockerfile",
	"makefile",
	"gitignore",
]);

/** Languages using Shopify Liquid `{% comment %}` tags. */
const LIQUID_LANGS = new Set(["liquid", "shopify_liquid", "shopify"]);

/**
 * Resolve the delimiter comment style for a language identifier. Matching is
 * case-insensitive; unknown identifiers (including all C-family) → `"block"`.
 */
export function commentStyleFor(language: string): CommentStyle {
	const lang = (language ?? "").trim().toLowerCase();
	if (LIQUID_LANGS.has(lang)) return "liquid";
	if (HASH_LANGS.has(lang)) return "hash";
	// block is the default: JS/TS/Java/C/C++/Go/Rust/CSS/PHP/Swift/Kotlin/…
	return "block";
}

/**
 * Sanitize a snippet name for embedding inside the `NAME="..."` delimiter.
 * Double quotes would break delimiter parsing, so they're replaced. Names are
 * short labels; this keeps round-trip parsing reliable.
 */
function sanitizeName(name: string): string {
	return (name ?? "").replace(/"/g, "'");
}

/**
 * Build the wrapped snippet block text for the given language's comment style.
 * The block is `START` line, the code body, then `END` line (newline-separated,
 * no trailing newline).
 */
export function generateSnippetBlock(id: number, name: string, language: string, code: string): string {
	const label = `${START_TOKEN}:ID=${id} NAME="${sanitizeName(name)}"`;
	const body = code ?? "";
	switch (commentStyleFor(language)) {
		case "hash":
			return `# ${label}\n${body}\n# ${END_TOKEN}`;
		case "liquid":
			return `{% comment %} ${label} {% endcomment %}\n${body}\n{% comment %} ${END_TOKEN} {% endcomment %}`;
		case "block":
		default:
			return `/* ${label} */\n${body}\n/* ${END_TOKEN} */`;
	}
}

// Match the common START core: `AI_DEBUG_SNIPPET_START:ID=<n> NAME="..."`.
// Style-agnostic — works regardless of the surrounding comment markers.
const START_RE = /AI_DEBUG_SNIPPET_START:ID=(\d+)\s+NAME="(.*?)"/;
// Match the END core: `AI_DEBUG_SNIPPET_END`. Style-agnostic.
const END_RE = /AI_DEBUG_SNIPPET_END/;

/**
 * Scan file content for snippet spans. Handles all three delimiter styles
 * (the START/END cores are comment-style-agnostic). START…END pairs are matched
 * in order (stack-based) so non-nested snippets resolve correctly.
 */
export function findSnippets(content: string): SnippetSpan[] {
	const lines = (content ?? "").split("\n");
	const spans: SnippetSpan[] = [];
	const open: Array<{ startLine: number; id: number; name: string }> = [];
	for (let i = 0; i < lines.length; i++) {
		const sm = lines[i].match(START_RE);
		if (sm) {
			open.push({ startLine: i + 1, id: Number(sm[1]), name: sm[2] });
			continue;
		}
		if (END_RE.test(lines[i]) && open.length > 0) {
			const o = open.pop()!;
			spans.push({ id: o.id, name: o.name, startLine: o.startLine, endLine: i + 1 });
		}
	}
	return spans;
}

/**
 * Insert a (possibly multi-line) block so its first line becomes 1-based
 * `atLine` (the existing line at `atLine` shifts down). `atLine` is clamped to
 * `[1, lines.length + 1]`. Returns a NEW lines array (does not mutate input).
 */
export function injectIntoLines(lines: string[], atLine: number, block: string): string[] {
	const blockLines = (block ?? "").split("\n");
	const idx = Math.max(0, Math.min(atLine - 1, lines.length));
	return [...lines.slice(0, idx), ...blockLines, ...lines.slice(idx)];
}

/**
 * Remove 1-based lines `[startLine, endLine]` inclusive. If removal leaves a
 * doubled blank line at the seam (one from each side), collapse one — this
 * removes the orphan blank a multi-line snippet typically leaves behind.
 * Returns a NEW lines array (does not mutate input).
 */
export function removeSpan(lines: string[], startLine: number, endLine: number): string[] {
	const s = Math.max(1, startLine);
	const e = Math.min(lines.length, endLine);
	if (s > e) return [...lines];
	const before = lines.slice(0, s - 1);
	const after = lines.slice(e);
	const merged = [...before, ...after];
	// Collapse a single doubled blank at the seam (last before-line + first after-line).
	const seam = before.length - 1;
	if (seam >= 0 && seam + 1 < merged.length && merged[seam].trim() === "" && merged[seam + 1].trim() === "") {
		return [...merged.slice(0, seam + 1), ...merged.slice(seam + 2)];
	}
	return merged;
}
