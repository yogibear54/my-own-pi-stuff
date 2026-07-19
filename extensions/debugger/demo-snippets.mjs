/**
 * Visual demo for Part 4 — shows delimited telemetry snippets in each comment
 * style (block / hash / liquid), injects them into a sample file, then removes
 * them and proves the file is restored byte-identical (except any accepted fix).
 *
 * Run: `node demo-snippets.mjs` (Node ≥ 22.6 type-stripping). Uses only the pure
 * helpers from snippets.ts — no pi, no jiti.
 */
import { commentStyleFor, generateSnippetBlock, injectIntoLines, removeSpan, findSnippets } from "./snippets.ts";

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const hr = "─".repeat(64);

console.log("1. Delimiter styles per language\n" + hr);
for (const [lang, code] of [
	["javascript", "fetch('http://localhost:8866', { method: 'POST', body: JSON.stringify(pkt) })"],
	["python", "requests.post('http://localhost:8866', json=pkt)"],
	["php", "curl_post('http://localhost:8866', $pkt);"],
	["liquid", "<!-- host app (Ruby/Node) emits the POST; Liquid cannot -->"],
]) {
	const style = commentStyleFor(lang);
	const block = generateSnippetBlock(1, "probe", lang, code);
	console.log(`\n${lang.padEnd(11)} → ${style}`);
	console.log(block.split("\n").map((l) => "    " + l).join("\n"));
}

console.log("\n\n2. Inject into a JS file, then remove → byte-identical\n" + hr);
{
	const original = ["function validate(token) {", "  if (!token) return false", "  return decode(token)", "}"];
	const block = generateSnippetBlock(7, "token probe", "javascript", "  probe(token);");
	const injected = injectIntoLines(original, 3, block);
	console.log("\nAFTER INJECT (snippet at line 3):");
	console.log(injected.map((l, i) => `  ${String(i + 1).padStart(2)}│ ${l}`).join("\n"));

	const span = findSnippets(injected.join("\n"))[0];
	const restored = removeSpan(injected, span.startLine, span.endLine);
	console.log("\nAFTER REMOVE:");
	console.log(restored.map((l, i) => `  ${String(i + 1).padStart(2)}│ ${l}`).join("\n"));
	console.log("\nbyte-identical to original?", restored.join("\n") === original.join("\n") ? "✅ YES" : "❌ NO");
}

console.log("\n\n3. Cleanup keeps an accepted fix, removes only the snippet\n" + hr);
{
	// Original has a bug (returns wrong value); the "fix" changes line 3.
	const before = ["function val(x) {", "  log(x)", "  return x     // BUG: missing +1", "}"];
	const fixed = ["function val(x) {", "  log(x)", "  return x + 1 // FIX", "}"];
	const block = generateSnippetBlock(1, "log", "javascript", "  postLog(x);");
	const instrumented = injectIntoLines(fixed, 2, block);
	const span = findSnippets(instrumented.join("\n"))[0];
	const after = removeSpan(instrumented, span.startLine, span.endLine);
	console.log("\nfile after fix + snippet + cleanup:");
	console.log(after.map((l) => "    " + l).join("\n"));
	console.log("\nfix preserved?", after.join("\n") === fixed.join("\n") ? "✅ YES (snippet gone, fix kept)" : "❌ NO");
	console.log("snippet gone?", !after.some((l) => l.includes("AI_DEBUG_SNIPPET")) ? "✅ YES" : "❌ NO");
}

console.log("\n" + hr + "\nManual testing: see the writeup — run the .test.mjs suites for full coverage.");
