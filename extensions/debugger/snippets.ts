/**
 * Telemetry snippet delimiters: generation, parsing, and cleanup (Part 4 core).
 *
 * Framework-agnostic and independently unit-testable. The pi tool registration
 * (file IO, withFileMutationQueue) lives in index.ts.
 *
 * Snippet format:
 *   Block (C-family):
 *     /* AI_DEBUG_SNIPPET_START:ID=<n> NAME="<label>" *\/
 *     <POST-to-server code>
 *     /* AI_DEBUG_SNIPPET_END *\/
 *   Line (#-comment languages):
 *     # AI_DEBUG_SNIPPET_START:ID=<n> NAME="<label>"
 *     <POST-to-server code>
 *     # AI_DEBUG_SNIPPET_END
 *
 * Design reference: docs/04-snippet-injection-cleanup.md
 */

export type CommentStyle = "block" | "line";

export interface SnippetBlock {
  id: number;
  name: string;
  /** 0-based index of the START marker line. */
  startIndex: number;
  /** 0-based index of the END marker line (inclusive). */
  endIndex: number;
  /** Inner code (lines between the markers, joined by \n). */
  code: string;
}

export const START_PREFIX = "AI_DEBUG_SNIPPET_START";
export const END_PREFIX = "AI_DEBUG_SNIPPET_END";

const START_RE = /AI_DEBUG_SNIPPET_START:ID=(\d+)(?:\s+NAME="([^"]*)")?/;
const END_RE = /AI_DEBUG_SNIPPET_END/;

// Languages whose only line comment is '#'. Everything else defaults to block style.
const HASH_LANGS = new Set([
  "py", "pyw", "pyi", "rb", "sh", "bash", "zsh", "fish", "ksh",
  "yml", "yaml", "toml", "r", "pl", "pm", "ps1", "psm1",
  "dockerfile", "makefile", "mk", "cmake", "gitignore", "ini", "cfg", "conf",
]);

export function commentStyleFor(languageOrPath: string): CommentStyle {
  const key = languageOrPath.trim().toLowerCase();
  const ext = key.includes(".") || key.includes("/")
    ? (key.split(/[/\\]/).pop() ?? key)
    : key;
  const bare = ext.includes(".") ? ext.split(".").pop() ?? ext : ext;
  return HASH_LANGS.has(bare) ? "line" : "block";
}

/** Sanitize a name so it can sit inside the NAME="..." token safely. */
function sanitizeName(name: string): string {
  return (name ?? "").replace(/["\r\n]/g, "").slice(0, 64);
}

/**
 * Build the snippet block as an array of lines (no trailing newline), ready to
 * splice into a file's line array. Insertion/removal use exactly these lines so
 * cleanup is byte-clean.
 */
export function makeSnippetLines(id: number, name: string, code: string, style: CommentStyle): string[] {
  const safe = sanitizeName(name);
  const header = style === "block"
    ? `/* ${START_PREFIX}:ID=${id} NAME="${safe}" */`
    : `# ${START_PREFIX}:ID=${id} NAME="${safe}"`;
  const footer = style === "block"
    ? `/* ${END_PREFIX} */`
    : `# ${END_PREFIX}`;
  const codeLines = code.length === 0 ? [] : code.replace(/\n$/, "").split("\n");
  return [header, ...codeLines, footer];
}

/** Convenience: full block as a single string (markers + code, joined by \n). */
export function makeSnippet(id: number, name: string, code: string, style: CommentStyle): string {
  return makeSnippetLines(id, name, code, style).join("\n");
}

/** Parse every snippet block out of file content. Returns blocks in source order. */
export function findSnippets(content: string): SnippetBlock[] {
  const lines = content.split("\n");
  const blocks: SnippetBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = START_RE.exec(lines[i]!);
    if (!m) continue;
    const id = Number(m[1]);
    const name = m[2] ?? "";
    // Find the matching END marker at a deeper index.
    let j = i + 1;
    while (j < lines.length && !END_RE.test(lines[j]!)) j++;
    if (j >= lines.length) continue; // unterminated marker: skip, don't claim a block
    blocks.push({ id, name, startIndex: i, endIndex: j, code: lines.slice(i + 1, j).join("\n") });
    i = j;
  }
  return blocks;
}

function spliceLines(lines: string[], from: number, to: number): string[] {
  // Remove [from..to] inclusive, collapsing a single leftover blank line so the
  // gap doesn't double up with an existing blank neighbour.
  const next = [...lines];
  next.splice(from, to - from + 1);
  if (from > 0 && from < next.length && next[from] === "" && next[from - 1] === "") {
    next.splice(from, 1);
  }
  return next;
}

/** Remove the snippet with the given id. Returns the new content and what was removed. */
export function removeSnippetById(content: string, id: number): { content: string; removed?: SnippetBlock } {
  const block = findSnippets(content).find((b) => b.id === id);
  if (!block) return { content };
  return { content: spliceLines(content.split("\n"), block.startIndex, block.endIndex).join("\n"), removed: block };
}

/** Remove every snippet block. Returns the cleaned content and all removed blocks. */
export function removeAllSnippets(content: string): { content: string; removed: SnippetBlock[] } {
  const blocks = findSnippets(content);
  if (blocks.length === 0) return { content, removed: [] };
  let lines = content.split("\n");
  // Remove from the end backwards so earlier indices stay valid.
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]!;
    lines = spliceLines(lines, b.startIndex, b.endIndex);
  }
  return { content: lines.join("\n"), removed: blocks };
}
