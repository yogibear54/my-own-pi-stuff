/**
 * Tool harness for Part 4 — drives the real registered snippet tools against
 * temp files, a live debug session, and the running log server.
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
function eq(actual, expected, msg) { ok(actual === expected, `${msg} (expected ${JSON.stringify(expected).slice(0,80)}, got ${JSON.stringify(actual).slice(0,80)})`); }
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

// --- Load the extension and capture the registered tools + command handler ---
const tools = {};
let cmdHandler = null;
const mod = await jiti.import(join(EXT, "index.ts"));
mod.default({
	on: () => {},
	registerCommand: (_n, def) => { cmdHandler = def.handler; },
	registerTool: (t) => { tools[t.name] = t; },
});
const inject = tools.inject_snippet, remove = tools.remove_snippet, list = tools.list_snippets, cleanup = tools.cleanup_all_snippets;
ok(inject && remove && list && cleanup, "factory registers all 4 snippet tools (+ report_bug)");
const rb = tools.report_bug;
ok(rb, "report_bug tool registered (moved to tools.ts)");

// Fake theme (renderDebugWidget only needs fg/bold) + minimal ui.
const theme = { fg: (_c, s) => s, bold: (s) => s };
const mkCtx = (cwd) => ({ cwd, ui: { theme, setWidget: () => {}, setStatus: () => {}, notify: () => {}, custom: () => {} } });

const cwd = mkdtempSync(join(tmpdir(), "dbg-tools-"));
const ctx = mkCtx(cwd);
const file = (n) => join(cwd, n);

console.log("\n[no-session gate — all tools inert]");
{
	const r = await inject.execute("c", { path: "x.js", line: 1, name: "n", language: "js", code: "c" }, undefined, undefined, ctx);
	ok(strip(r.content[0].text).includes("No active debug session"), "inject inert without session");
	const r2 = await cleanup.execute("c", {}, undefined, undefined, ctx);
	ok(strip(r2.content[0].text).includes("No active debug session"), "cleanup inert without session");
	const rb0 = await rb.execute("c", { summary: "x" }, undefined, undefined, ctx);
	ok(strip(rb0.content[0].text).includes("No active debug session"), "report_bug inert without session");
}

console.log("\n[start session]");
await cmdHandler("", ctx); // "/debugger" → startDebug (binds :8866)
ok(true, "session started");

console.log("\n[report_bug — moved tool + empty-input defect fix]");
{
	const r1 = await rb.execute("c", { summary: "Login fails for empty email" }, undefined, undefined, ctx);
	ok(strip(r1.content[0].text).includes("Bug summary recorded"), "valid summary → recorded");
	const r2 = await rb.execute("c", { summary: "" }, undefined, undefined, ctx);
	ok(strip(r2.content[0].text).includes("cleared"), "empty summary → cleared (no throw)");
	const r3 = await rb.execute("c", { summary: "multi\nline\nsummary" }, undefined, undefined, ctx);
	ok(strip(r3.content[0].text).includes("Bug summary recorded"), "multi-line summary → recorded");
}

console.log("\n[hybrid id: explicit / auto / collision]");
{
	writeFileSync(file("app.js"), "function a(){\n  return 1\n}\n");
	const r1 = await inject.execute("c1", { path: "app.js", line: 2, name: "probe", language: "javascript", code: "fetch('/log',{method:'POST',body:'{}'})", id: 5 }, undefined, undefined, ctx);
	ok(strip(r1.content[0].text).includes("ID=5"), "explicit id honored");
	ok(strip(r1.content[0].text).includes("block"), "block style reported");

	const r2 = await inject.execute("c2", { path: "app.js", line: 1, name: "top", language: "python", code: "pass", id: 1 }, undefined, undefined, ctx);
	ok(strip(r2.content[0].text).includes("ID=1"), "second explicit id (1) honored");

	// Collision: id 5 is used → auto-assign next free (2).
	const r3 = await inject.execute("c3", { path: "app.js", line: 1, name: "col", language: "js", code: "x", id: 5 }, undefined, undefined, ctx);
	ok(strip(r3.content[0].text).includes("ID=2"), "collision → auto-assigned next free id (2)");

	// Omitted id → next free (3).
	const r4 = await inject.execute("c4", { path: "app.js", line: 1, name: "auto", language: "js", code: "y" }, undefined, undefined, ctx);
	ok(strip(r4.content[0].text).includes("ID=3"), "omitted id → auto-assigned (3)");
}

console.log("\n[list + remove by id]");
{
	const r = await list.execute("c", {}, undefined, undefined, ctx);
	const arr = JSON.parse(r.content[0].text);
	eq(arr.length, 4, "list shows 4 tracked snippets");

	const rr = await remove.execute("c", { path: "app.js", id: 5 }, undefined, undefined, ctx);
	ok(strip(rr.content[0].text).includes("Removed 1"), "remove by id removes 1");

	const after = JSON.parse((await list.execute("c", {}, undefined, undefined, ctx)).content[0].text);
	eq(after.length, 3, "list shows 3 after remove");
}

console.log("\n[style dispatch: php → block, liquid → tag form]");
{
	writeFileSync(file("srv.php"), "<?php\nfunction f(){\n  return 1;\n}\n");
	const rp = await inject.execute("c", { path: "srv.php", line: 2, name: "p", language: "php", code: "curl_post();" }, undefined, undefined, ctx);
	ok(strip(rp.content[0].text).includes("block"), "php → block style");
	const php = readFileSync(file("srv.php"), "utf8");
	ok(php.includes("/* AI_DEBUG_SNIPPET_START"), "php file got block delimiters");

	writeFileSync(file("theme.liquid"), "<div>\n  {{ product.title }}\n</div>\n");
	const rl = await inject.execute("c", { path: "theme.liquid", line: 2, name: "m", language: "liquid", code: "<!-- host app -->" }, undefined, undefined, ctx);
	ok(strip(rl.content[0].text).includes("liquid"), "liquid → liquid style");
	const liq = readFileSync(file("theme.liquid"), "utf8");
	ok(liq.includes("{% comment %} AI_DEBUG_SNIPPET_START"), "liquid file got tag delimiters");
}

console.log("\n[byte-identical round-trip: inject → cleanup == original]");
{
	writeFileSync(file("rt.js"), "function a(){\n  return 1\n}\n");
	const original = readFileSync(file("rt.js"), "utf8");
	await inject.execute("c", { path: "rt.js", line: 2, name: "t", language: "js", code: "probe();" }, undefined, undefined, ctx);
	await cleanup.execute("c", {}, undefined, undefined, ctx); // clears ALL tracked — includes this one
	const after = readFileSync(file("rt.js"), "utf8");
	eq(after, original, "single-snippet round-trip is byte-identical");
}

console.log("\n[AC3: cleanup keeps an accepted fix, removes only snippets]");
{
	const fixed = "function a(){\n  return 2\n}\n"; // the "fix": 1 → 2
	writeFileSync(file("fix.js"), fixed);
	await inject.execute("c", { path: "fix.js", line: 2, name: "tel", language: "js", code: "probe();" }, undefined, undefined, ctx);
	await cleanup.execute("c", {}, undefined, undefined, ctx);
	const after = readFileSync(file("fix.js"), "utf8");
	eq(after, fixed, "cleanup removed the snippet but kept the fix");
	ok(!after.includes("AI_DEBUG_SNIPPET"), "no snippet delimiters remain");
}

console.log("\n[concurrency: two parallel injects on one file don't corrupt]");
{
	writeFileSync(file("conc.js"), "a\nb\nc\nd\n");
	const [r1, r2] = await Promise.all([
		inject.execute("c", { path: "conc.js", line: 1, name: "one", language: "js", code: "one();", id: 70 }, undefined, undefined, ctx),
		inject.execute("c", { path: "conc.js", line: 1, name: "two", language: "js", code: "two();", id: 71 }, undefined, undefined, ctx),
	]);
	ok(strip(r1.content[0].text).includes("Injected") && strip(r2.content[0].text).includes("Injected"), "both parallel injects succeeded");
	const content = readFileSync(file("conc.js"), "utf8");
	const count = (content.match(/AI_DEBUG_SNIPPET_START/g) || []).length;
	eq(count, 2, "both snippets landed (no lost write) — queue serialized mutations");
}

console.log("\n[AC6: schema-valid packet POST to the session target → 200]");
{
	const target = "http://localhost:8866";
	const packet = {
		log_id: "1698844392123-4",
		event_timestamp: "2023-11-01T14:53:12.123Z",
		level: "ERROR",
		source: { file: "app.js", line: 42, function: "validate" },
		message: "boom",
	};
	const status = await new Promise((resolve) => {
		const req = http.request(target, { method: "POST", headers: { "content-type": "application/json" } }, (res) => {
			res.resume();
			res.on("end", () => resolve(res.statusCode));
		});
		req.on("error", () => resolve(0));
		req.end(JSON.stringify(packet));
	});
	eq(status, 200, "server accepts schema-valid packet (the target snippets POST to)");
}

console.log("\n[teardown: /debugger stop removes remaining snippets]");
{
	await cmdHandler("stop", ctx); // stopDebug → cleanupAllSnippets + server close
	ok(true, "stop completed without error");
}

rmSync(cwd, { recursive: true, force: true });
console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
