/**
 * Unit tests for snippets.ts — pure delimiter helpers (no pi, no I/O).
 *
 * Run: `node snippets.test.mjs` (Node ≥ 22.6 type-stripping). snippets.ts has no
 * imports, so no SDK resolution is needed.
 */
import {
	commentStyleFor,
	generateSnippetBlock,
	findSnippets,
	injectIntoLines,
	removeSpan,
} from "./snippets.ts";

let failures = 0;
function ok(cond, msg) {
	if (cond) console.log("  ok  -", msg);
	else { failures++; console.log("  FAIL-", msg); }
}
function eq(actual, expected, msg) {
	ok(actual === expected, `${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

console.log("\n[commentStyleFor]");
eq(commentStyleFor("javascript"), "block", "js → block");
eq(commentStyleFor("JS"), "block", "case-insensitive (JS)");
eq(commentStyleFor("typescript"), "block", "ts → block");
eq(commentStyleFor("go"), "block", "go → block");
eq(commentStyleFor("rust"), "block", "rust → block");
eq(commentStyleFor("php"), "block", "php → block");
eq(commentStyleFor("phtml"), "block", "phtml → block");
eq(commentStyleFor("python"), "hash", "python → hash");
eq(commentStyleFor("PY"), "hash", "case-insensitive (PY)");
eq(commentStyleFor("ruby"), "hash", "ruby → hash");
eq(commentStyleFor("bash"), "hash", "bash → hash");
eq(commentStyleFor("yaml"), "hash", "yaml → hash");
eq(commentStyleFor("liquid"), "liquid", "liquid → liquid");
eq(commentStyleFor("Shopify_Liquid"), "liquid", "shopify_liquid alias → liquid");
eq(commentStyleFor("wibble"), "block", "unknown → block default");
eq(commentStyleFor(""), "block", "empty → block default");

console.log("\n[generateSnippetBlock — block]");
{
	const block = generateSnippetBlock(7, "check token", "javascript", "fetch('/log', { method:'POST', body: '{}' })");
	const lines = block.split("\n");
	eq(lines.length, 3, "block form = 3 lines");
	eq(lines[0], "/* AI_DEBUG_SNIPPET_START:ID=7 NAME=\"check token\" */", "block START delimiter");
	eq(lines[2], "/* AI_DEBUG_SNIPPET_END */", "block END delimiter");
	ok(lines[1].includes("fetch('/log'"), "code body present");
}
{
	// PHP also uses block form.
	const block = generateSnippetBlock(3, "x", "php", "curl_post($url, $payload);");
	ok(block.startsWith("/* AI_DEBUG_SNIPPET_START:ID=3"), "php uses block START");
	ok(block.endsWith("/* AI_DEBUG_SNIPPET_END */"), "php uses block END");
}
{
	// Name with a double quote is sanitized to keep parsing reliable.
	const block = generateSnippetBlock(1, 'say "hi"', "js", "code;");
	ok(block.includes('NAME="say \'hi\'"'), "double quote in name sanitized to single");
}

console.log("\n[generateSnippetBlock — hash]");
{
	const block = generateSnippetBlock(2, "check token len", "python", "requests.post(URL, json=payload)");
	const lines = block.split("\n");
	eq(lines.length, 3, "hash form = 3 lines");
	eq(lines[0], "# AI_DEBUG_SNIPPET_START:ID=2 NAME=\"check token len\"", "hash START delimiter");
	eq(lines[2], "# AI_DEBUG_SNIPPET_END", "hash END delimiter");
}

console.log("\n[generateSnippetBlock — liquid]");
{
	const block = generateSnippetBlock(5, "theme marker", "liquid", "<!-- host app reads this -->");
	const lines = block.split("\n");
	eq(lines.length, 3, "liquid form = 3 lines");
	eq(lines[0], "{% comment %} AI_DEBUG_SNIPPET_START:ID=5 NAME=\"theme marker\" {% endcomment %}", "liquid START delimiter");
	eq(lines[2], "{% comment %} AI_DEBUG_SNIPPET_END {% endcomment %}", "liquid END delimiter");
}

console.log("\n[findSnippets — all three styles]");
{
	const content = [
		"line1",
		"/* AI_DEBUG_SNIPPET_START:ID=1 NAME=\"a\" */",
		"codeA",
		"/* AI_DEBUG_SNIPPET_END */",
		"# AI_DEBUG_SNIPPET_START:ID=2 NAME=\"b\"",
		"codeB",
		"# AI_DEBUG_SNIPPET_END",
		"{% comment %} AI_DEBUG_SNIPPET_START:ID=3 NAME=\"c\" {% endcomment %}",
		"codeC",
		"{% comment %} AI_DEBUG_SNIPPET_END {% endcomment %}",
		"lineEnd",
	].join("\n");
	const spans = findSnippets(content);
	eq(spans.length, 3, "finds all 3 styles");
	eq(spans[0].id, 1, "span0 id"); eq(spans[0].name, "a", "span0 name");
	eq(spans[0].startLine, 2, "span0 startLine"); eq(spans[0].endLine, 4, "span0 endLine");
	eq(spans[1].id, 2, "span1 id"); eq(spans[1].startLine, 5, "span1 startLine"); eq(spans[1].endLine, 7, "span1 endLine");
	eq(spans[2].id, 3, "span2 id"); eq(spans[2].startLine, 8, "span2 startLine"); eq(spans[2].endLine, 10, "span2 endLine");
}
{
	eq(findSnippets("no snippets here").length, 0, "no snippets → empty");
	// Unpaired START (no END) is ignored.
	eq(findSnippets("/* AI_DEBUG_SNIPPET_START:ID=9 NAME=\"x\" */\ncode").length, 0, "unpaired START ignored");
}

console.log("\n[round-trip: inject → find → remove == original, per style]");
for (const [lang, label] of [["javascript", "block"], ["python", "hash"], ["liquid", "liquid"], ["php", "php"]]) {
	const original = "import { a } from './a'\n\nexport function main() {\n  return a()\n}\n";
	const block = generateSnippetBlock(1, "probe", lang, "TELEMETRY");
	const injected = injectIntoLines(original.split("\n"), 3, block).join("\n");
	const span = findSnippets(injected)[0];
	ok(span != null, `${label}: snippet located after inject`);
	const restored = removeSpan(injected.split("\n"), span.startLine, span.endLine).join("\n");
	eq(restored, original, `${label}: byte-identical round-trip`);
}

console.log("\n[injectIntoLines — positioning & clamping]");
{
	const lines = ["a", "b", "c"];
	const out = injectIntoLines(lines, 2, "X\nY");
	eq(out.join(","), "a,X,Y,b,c", "insert at line 2 pushes existing line 2 down");
}
{
	const lines = ["a", "b"];
	const out = injectIntoLines(lines, 99, "Z");
	eq(out.join(","), "a,b,Z", "atLine beyond end → append");
}
{
	const lines = ["a", "b"];
	const out = injectIntoLines(lines, 1, "Z");
	eq(out.join(","), "Z,a,b", "atLine 1 → prepend");
}

console.log("\n[removeSpan — seam blank collapse]");
{
	// Snippet sat between two blank lines → removing collapses the doubled blank.
	const lines = ["x", "", "/* START */", "code", "/* END */", "", "y"];
	const out = removeSpan(lines, 3, 5);
	eq(out.join(","), "x,,y", "removes span and collapses one doubled blank at seam");
}
{
	// No adjacent blanks → exact removal, nothing collapsed.
	const lines = ["a", "/* START */", "code", "/* END */", "b"];
	const out = removeSpan(lines, 2, 4);
	eq(out.join(","), "a,b", "exact removal with no seam blanks");
}

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
