/**
 * Tool harness for the debugger — drives the real registered tools (snippet,
 * report_bug, and transition tools) against temp files, a live session, and the
 * running log server. Inspects state via state.ts directly.
 *
 * Run: `node snippets.tools.test.mjs`
 *
 * Loads index.ts through jiti (pi's loader) with the SDK aliases, so value
 * imports (typebox, withFileMutationQueue) resolve exactly as they do in pi.
 */
import { createJiti } from "/home/yogibear54/.nvm/versions/node/v22.19.0/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti-static.mjs";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";

const PI = "/home/yogibear54/.nvm/versions/node/v22.19.0/lib/node_modules/@earendil-works/pi-coding-agent";
const EXT = "/home/yogibear54/.pi/agent-git/extensions/debugger";
const require = createRequire(PI + "/x.js");
const jiti = createJiti(import.meta.url, {
	alias: {
		typebox: require.resolve("typebox", { paths: [PI] }),
		"@earendil-works/pi-coding-agent": PI + "/dist/index.js",
		"@earendil-works/pi-tui": require.resolve("@earendil-works/pi-tui", { paths: [PI] }),
	},
	interopDefault: true,
});

let failures = 0;
function ok(cond, msg) { if (cond) console.log("  ok  -", msg); else { failures++; console.log("  FAIL-", msg); } }
function eq(actual, expected, msg) { ok(actual === expected, `${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`); }
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

// --- Load the extension, capture tools + command handler, and state for inspection ---
const tools = {};
let cmdHandler = null;
const mod = await jiti.import(join(EXT, "index.ts"));
const stateMod = await jiti.import(join(EXT, "state.ts"));
mod.default({
	on: () => {},
	registerCommand: (_n, def) => { cmdHandler = def.handler; },
	registerTool: (t) => { tools[t.name] = t; },
	appendEntry: () => {}, // state persistence stub
});
const inject = tools.inject_snippet, remove = tools.remove_snippet, list = tools.list_snippets, cleanup = tools.cleanup_all_snippets;
const rb = tools.report_bug, rh = tools.report_hypothesis, rut = tools.request_user_test, ds = tools.debug_summary;
ok(inject && remove && list && cleanup, "snippet tools registered");
ok(rb && rh && rut && ds, "report_bug + transition tools registered");

// Fake theme (renderDebugWidget only needs fg/bold) + minimal ui (select is controllable).
const theme = { fg: (_c, s) => s, bold: (s) => s };
let selectChoice = "Bug Fixed";
const mkCtx = (cwd) => ({
	cwd,
	ui: {
		theme,
		setWidget: () => {},
		setStatus: () => {},
		notify: () => {},
		custom: () => {},
		select: async (_prompt, _options) => selectChoice,
	},
});

const cwd = mkdtempSync(join(tmpdir(), "dbg-tools-"));
const ctx = mkCtx(cwd);
const file = (n) => join(cwd, n);

console.log("\n[no-session gate — all tools inert]");
{
	ok(strip((await inject.execute("c", { path: "x.js", line: 1, name: "n", language: "js", code: "c" }, undefined, undefined, ctx)).content[0].text).includes("No active debug session"), "inject inert");
	ok(strip((await cleanup.execute("c", {}, undefined, undefined, ctx)).content[0].text).includes("No active debug session"), "cleanup inert");
	ok(strip((await rb.execute("c", { summary: "x" }, undefined, undefined, ctx)).content[0].text).includes("No active debug session"), "report_bug inert");
	ok(strip((await rh.execute("c", { hypothesis: "x" }, undefined, undefined, ctx)).content[0].text).includes("No active debug session"), "report_hypothesis inert");
}

console.log("\n[start session]");
await cmdHandler("", ctx); // "/debugger" → startDebug (binds :8866, initializes state)
eq(stateMod.getState().state, "AWAITING CONTEXT", "initial state = AWAITING CONTEXT");
eq(stateMod.getState().active, true, "state.active = true");

console.log("\n[report_bug — persisted via state]");
{
	const r1 = await rb.execute("c", { summary: "Login fails for empty email" }, undefined, undefined, ctx);
	ok(strip(r1.content[0].text).includes("Bug summary recorded"), "valid summary → recorded");
	eq(stateMod.getState().bug, "Login fails for empty email", "bug persisted in state");
	const r2 = await rb.execute("c", { summary: "" }, undefined, undefined, ctx);
	ok(strip(r2.content[0].text).includes("cleared"), "empty summary → cleared");
	eq(stateMod.getState().bug, null, "bug cleared in state");
}

console.log("\n[transition tools — state machine]");
{
	// report_hypothesis → HYPOTHESIS & BUG VALIDATION, count=1
	let r = await rh.execute("c", { hypothesis: "token check misses null", files: ["auth.ts"], functions: ["validate"] }, undefined, undefined, ctx);
	ok(strip(r.content[0].text).includes("Hypothesis #1"), "report_hypothesis → #1");
	eq(stateMod.getState().state, "HYPOTHESIS & BUG VALIDATION", "→ HYPOTHESIS & BUG VALIDATION");
	eq(stateMod.getState().hypothesisCount, 1, "hypothesisCount = 1");
	eq(stateMod.getState().attempts, 0, "attempts reset to 0");

	// Continue path: 3 failures (MAX) → AWAITING CONTEXT, hypothesis cleared
	selectChoice = "Continue to Debug";
	await rut.execute("c", { steps: ["repro"] }, undefined, undefined, ctx);
	eq(stateMod.getState().attempts, 1, "continue #1 → attempts=1");
	eq(stateMod.getState().state, "HYPOTHESIS & BUG VALIDATION", "continue #1 still HYPOTHESIS");
	await rut.execute("c", { steps: ["repro"] }, undefined, undefined, ctx);
	eq(stateMod.getState().attempts, 2, "continue #2 → attempts=2");
	await rut.execute("c", { steps: ["repro"] }, undefined, undefined, ctx);
	eq(stateMod.getState().state, "AWAITING CONTEXT", "continue #3 at MAX → AWAITING CONTEXT");
	eq(stateMod.getState().hypothesis, null, "hypothesis cleared at MAX");

	// New hypothesis + fix + summary
	await rh.execute("c", { hypothesis: "second idea" }, undefined, undefined, ctx);
	eq(stateMod.getState().hypothesisCount, 2, "second hypothesis → #2");
	writeFileSync(file("app.js"), "function a(){\n  return 1\n}\n");
	await inject.execute("c", { path: "app.js", line: 1, name: "t", language: "js", code: "probe();" }, undefined, undefined, ctx);
	ok(Object.keys(stateMod.getSnippetMap()).length > 0, "snippet tracked before fix test");
	selectChoice = "Bug Fixed";
	r = await rut.execute("c", { steps: ["repro"] }, undefined, undefined, ctx);
	ok(strip(r.content[0].text).includes("BUG FIXED"), "Bug Fixed → BUG FIXED");
	eq(stateMod.getState().state, "BUG FIXED", "state → BUG FIXED");
	eq(Object.keys(stateMod.getSnippetMap()).length, 0, "snippets cleaned on fix");

	selectChoice = "Exit Debug mode";
	r = await ds.execute("c", { summary: "Fixed: added null check for email." }, undefined, undefined, ctx);
	ok(strip(r.content[0].text).includes("stopped"), "debug_summary Exit → stopped");
	eq(stateMod.getState(), null, "state cleared after stop");
}

// Restart a fresh session for the snippet-behavior tests below.
await cmdHandler("", ctx);

console.log("\n[hybrid id: explicit / auto / collision]");
{
	writeFileSync(file("app.js"), "function a(){\n  return 1\n}\n");
	ok(strip((await inject.execute("c1", { path: "app.js", line: 2, name: "probe", language: "javascript", code: "fetch()", id: 5 }, undefined, undefined, ctx)).content[0].text).includes("ID=5"), "explicit id honored");
	ok(strip((await inject.execute("c2", { path: "app.js", line: 1, name: "top", language: "python", code: "pass", id: 1 }, undefined, undefined, ctx)).content[0].text).includes("ID=1"), "second explicit id (1) honored");
	ok(strip((await inject.execute("c3", { path: "app.js", line: 1, name: "col", language: "js", code: "x", id: 5 }, undefined, undefined, ctx)).content[0].text).includes("ID=2"), "collision → auto-assigned next free id (2)");
	ok(strip((await inject.execute("c4", { path: "app.js", line: 1, name: "auto", language: "js", code: "y" }, undefined, undefined, ctx)).content[0].text).includes("ID=3"), "omitted id → auto-assigned (3)");
}

console.log("\n[list + remove by id]");
{
	eq(JSON.parse((await list.execute("c", {}, undefined, undefined, ctx)).content[0].text).length, 4, "list shows 4 tracked");
	ok(strip((await remove.execute("c", { path: "app.js", id: 5 }, undefined, undefined, ctx)).content[0].text).includes("Removed 1"), "remove by id removes 1");
	eq(JSON.parse((await list.execute("c", {}, undefined, undefined, ctx)).content[0].text).length, 3, "list shows 3 after remove");
}

console.log("\n[style dispatch: php → block, liquid → tag form]");
{
	writeFileSync(file("srv.php"), "<?php\nfunction f(){\n  return 1;\n}\n");
	ok(strip((await inject.execute("c", { path: "srv.php", line: 2, name: "p", language: "php", code: "curl_post();" }, undefined, undefined, ctx)).content[0].text).includes("block"), "php → block style");
	ok(readFileSync(file("srv.php"), "utf8").includes("/* AI_DEBUG_SNIPPET_START"), "php file got block delimiters");
	writeFileSync(file("theme.liquid"), "<div>\n  {{ product.title }}\n</div>\n");
	ok(strip((await inject.execute("c", { path: "theme.liquid", line: 2, name: "m", language: "liquid", code: "<!-- host app -->" }, undefined, undefined, ctx)).content[0].text).includes("liquid"), "liquid → liquid style");
	ok(readFileSync(file("theme.liquid"), "utf8").includes("{% comment %} AI_DEBUG_SNIPPET_START"), "liquid file got tag delimiters");
}

console.log("\n[byte-identical round-trip + AC3 fix-kept]");
{
	writeFileSync(file("rt.js"), "function a(){\n  return 1\n}\n");
	const original = readFileSync(file("rt.js"), "utf8");
	await inject.execute("c", { path: "rt.js", line: 2, name: "t", language: "js", code: "probe();" }, undefined, undefined, ctx);
	await cleanup.execute("c", {}, undefined, undefined, ctx);
	eq(readFileSync(file("rt.js"), "utf8"), original, "single-snippet round-trip byte-identical");
	const fixed = "function a(){\n  return 2\n}\n";
	writeFileSync(file("fix.js"), fixed);
	await inject.execute("c", { path: "fix.js", line: 2, name: "tel", language: "js", code: "probe();" }, undefined, undefined, ctx);
	await cleanup.execute("c", {}, undefined, undefined, ctx);
	const after = readFileSync(file("fix.js"), "utf8");
	eq(after, fixed, "cleanup kept the fix, removed the snippet");
	ok(!after.includes("AI_DEBUG_SNIPPET"), "no delimiters remain");
}

console.log("\n[concurrency: two parallel injects on one file don't corrupt]");
{
	writeFileSync(file("conc.js"), "a\nb\nc\nd\n");
	const [r1, r2] = await Promise.all([
		inject.execute("c", { path: "conc.js", line: 1, name: "one", language: "js", code: "one();", id: 70 }, undefined, undefined, ctx),
		inject.execute("c", { path: "conc.js", line: 1, name: "two", language: "js", code: "two();", id: 71 }, undefined, undefined, ctx),
	]);
	ok(strip(r1.content[0].text).includes("Injected") && strip(r2.content[0].text).includes("Injected"), "both parallel injects succeeded");
	eq((readFileSync(file("conc.js"), "utf8").match(/AI_DEBUG_SNIPPET_START/g) || []).length, 2, "both snippets landed (queue serialized)");
}

console.log("\n[AC6: schema-valid packet POST → 200]");
{
	const status = await new Promise((resolve) => {
		const req = http.request("http://localhost:8866", { method: "POST", headers: { "content-type": "application/json" } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
		req.on("error", () => resolve(0));
		req.end(JSON.stringify({ log_id: "1", event_timestamp: "2023-11-01T14:53:12.123Z", level: "ERROR", source: { file: "app.js", line: 42, function: "validate" }, message: "boom" }));
	});
	eq(status, 200, "server accepts schema-valid packet");
}

console.log("\n[teardown: /debugger stop]");
{
	await cmdHandler("stop", ctx);
	eq(stateMod.getState(), null, "state cleared on stop");
}

rmSync(cwd, { recursive: true, force: true });
console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
