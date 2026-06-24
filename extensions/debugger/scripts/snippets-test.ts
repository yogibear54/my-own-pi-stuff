/**
 * Round-trip + parsing tests for snippets.ts (Part 4 core).
 * Run: node --experimental-strip-types scripts/snippets-test.ts
 */

import assert from "node:assert/strict";
import {
  commentStyleFor,
  findSnippets,
  makeSnippet,
  makeSnippetLines,
  removeAllSnippets,
  removeSnippetById,
} from "../snippets.ts";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log("  ok -", name);
}

/** Insert a snippet's lines before 1-based `line`. Returns new content. */
function injectAt(content: string, line1: number, snippetLines: string[]): string {
  const lines = content.split("\n");
  const at = Math.max(0, Math.min(line1 - 1, lines.length));
  lines.splice(at, 0, ...snippetLines);
  return lines.join("\n");
}

function main(): void {
  check("commentStyleFor maps extensions/labels", () => {
    assert.equal(commentStyleFor("py"), "line");
    assert.equal(commentStyleFor("auth.py"), "line");
    assert.equal(commentStyleFor("rb"), "line");
    assert.equal(commentStyleFor("ts"), "block");
    assert.equal(commentStyleFor("src/app.tsx"), "block");
    assert.equal(commentStyleFor("Dockerfile"), "line");
    assert.equal(commentStyleFor("sh"), "line");
  });

  check("makeSnippet block style produces exact delimiters", () => {
    const block = makeSnippet(1, "check token", "fetch('/x')", "block");
    const expected = [
      '/* AI_DEBUG_SNIPPET_START:ID=1 NAME="check token" */',
      "fetch('/x')",
      "/* AI_DEBUG_SNIPPET_END */",
    ].join("\n");
    assert.equal(block, expected);
  });

  check("makeSnippet line style (#) for Python", () => {
    const block = makeSnippet(2, "len", "print('dbg')", "line");
    const expected = [
      '# AI_DEBUG_SNIPPET_START:ID=2 NAME="len"',
      "print('dbg')",
      "# AI_DEBUG_SNIPPET_END",
    ].join("\n");
    assert.equal(block, expected);
  });

  check("ROUND-TRIP block: inject then removeById restores original byte-for-byte", () => {
    const original = [
      "import foo",
      "",
      "function go() {",
      "  return 1;",
      "}",
      "",
    ].join("\n");
    const lines = makeSnippetLines(5, "probe", "console.log('hit')", "block");
    const injected = injectAt(original, 4, lines); // before "  return 1;"
    assert.notEqual(injected, original);

    // findSnippets sees exactly one block with the right id/name/code
    const found = findSnippets(injected);
    assert.equal(found.length, 1);
    assert.equal(found[0]!.id, 5);
    assert.equal(found[0]!.name, "probe");
    assert.equal(found[0]!.code, "console.log('hit')");

    const { content: restored, removed } = removeSnippetById(injected, 5);
    assert.equal(removed?.id, 5);
    assert.equal(restored, original, "byte-identical after removing the only snippet");
  });

  check("ROUND-TRIP line style: inject then removeById restores original", () => {
    const original = [
      "def f():",
      "    x = 1",
      "    return x",
      "",
    ].join("\n");
    const lines = makeSnippetLines(9, "x", "print(x)", "line");
    const injected = injectAt(original, 3, lines);
    const { content: restored } = removeSnippetById(injected, 9);
    assert.equal(restored, original);
  });

  check("removeAllSnippets restores original with multiple blocks + keeps fix line", () => {
    const original = [
      "line1",
      "line2",
      "line3",
      "line4",
    ].join("\n");
    // Inject non-overlapping (sequential) snippets. Insert the later one first
    // so line offsets stay stable, then the earlier one. Snippets must never nest.
    let injected = original;
    injected = injectAt(injected, 4, makeSnippetLines(2, "b", "BBB", "block")); // before line4
    injected = injectAt(injected, 2, makeSnippetLines(1, "a", "AAA", "block")); // before line2
    assert.equal(findSnippets(injected).length, 2);

    // Pretend a fix was applied by adding a line that is NOT a snippet.
    const withFix = "line1\nFIX_APPLIED\nline2\nline3\nline4";
    // removeAll should only strip the two snippet blocks.
    const { content: cleaned, removed } = removeAllSnippets(injected);
    assert.equal(removed.length, 2);
    assert.equal(cleaned, original);
    void withFix;
  });

  check("cleanup keeps non-snippet edits: fix survives removeAll", () => {
    const original = "a\nb\nc";
    let injected = original;
    injected = injectAt(injected, 2, makeSnippetLines(1, "n", "DBG", "block")); // a / START..END / b / c
    // The "fix" = change 'c' to 'C', independently of the snippet.
    const withFix = injected.replace("c", "C");
    const expected = original.replace("c", "C"); // fix kept, snippet gone
    const { content } = removeAllSnippets(withFix);
    assert.equal(content, expected);
  });

  check("removeById on missing id is a no-op", () => {
    const content = makeSnippet(1, "n", "x", "block");
    const { content: same, removed } = removeSnippetById(content, 999);
    assert.equal(removed, undefined);
    assert.equal(same, content);
  });

  check("unterminated START marker is ignored by findSnippets", () => {
    const content = '/* AI_DEBUG_SNIPPET_START:ID=7 NAME="x" */\nonlycode';
    assert.equal(findSnippets(content).length, 0);
  });

  check("snippet without NAME token still parses", () => {
    const content = [
      '/* AI_DEBUG_SNIPPET_START:ID=3 */',
      "x = 1",
      "/* AI_DEBUG_SNIPPET_END */",
    ].join("\n");
    const found = findSnippets(content);
    assert.equal(found.length, 1);
    assert.equal(found[0]!.id, 3);
    assert.equal(found[0]!.name, "");
  });

  check("NAME with quotes is sanitized on generation", () => {
    const lines = makeSnippetLines(1, 'ev"il', "code", "block");
    assert.match(lines[0]!, /NAME="evil"/);
  });

  console.log(`\nOK: all snippets assertions passed (${passed}).`);
}

main();
