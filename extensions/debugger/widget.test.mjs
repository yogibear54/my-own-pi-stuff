/**
 * Tests for the widget packet formatters (formatPacketCompact / formatPacketExpanded).
 *
 * Run: `node widget.test.mjs` (Node ≥ 22.6 type-stripping). widget.ts is pure
 * (type-only imports), so no SDK resolution is needed.
 */
import { formatPacketCompact, formatPacketExpanded, TAIL_LIMIT } from "./widget.ts";

let failures = 0;
function ok(cond, msg) {
	if (cond) console.log("  ok  -", msg);
	else { failures++; console.log("  FAIL-", msg); }
}
function eq(actual, expected, msg) {
	ok(actual === expected, `${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

// Fake theme: wraps text in <color>…</color> tags so color decisions are assertable.
const theme = {
	fg: (c, s) => `<${c}>${s}</${c}>`,
	bold: (s) => s,
};

const base = {
	log_id: "1",
	event_timestamp: "2023-11-01T14:53:12.123Z",
	level: "ERROR",
	source: { file: "auth.py", line: 145, function: "validate" },
	message: "boom",
};

console.log("\n[formatPacketCompact]");
{
	const out = formatPacketCompact(base, theme);
	// LEVEL colored by severity (ERROR→error), file:line muted, fn dim, message plain
	ok(out.includes("<error>ERROR</error>"), "ERROR level colored error");
	ok(out.includes("<muted>auth.py:145</muted>"), "source rendered as file:line (muted)");
	ok(out.includes("<dim>validate</dim>"), "function rendered dim");
	ok(out.includes("boom"), "message present");

	eq(formatPacketCompact({ ...base, level: "WARN" }, theme).includes("<warning>WARN</warning>"), true, "WARN→warning");
	eq(formatPacketCompact({ ...base, level: "INFO" }, theme).includes("<success>INFO</success>"), true, "INFO→success");
	eq(formatPacketCompact({ ...base, level: "DEBUG" }, theme).includes("<dim>DEBUG</dim>"), true, "DEBUG→dim");
	// custom (non-enum) level: bold only, no <color> wrapper
	const custom = formatPacketCompact({ ...base, level: "VERBOSE" }, theme);
	ok(!custom.includes("<error>") && !custom.includes("<warning>"), "custom level gets no severity color");
	ok(custom.includes("VERBOSE"), "custom level text present");
	// case-insensitive severity matching
	eq(formatPacketCompact({ ...base, level: "error" }, theme).includes("<error>error</error>"), true, "lowercase error still colored");
}

console.log("\n[formatPacketExpanded]");
{
	const out = formatPacketExpanded(base, theme);
	eq(Array.isArray(out), true, "returns an array of lines");
	eq(out.length >= 3, true, "at least header/timestamp/message lines");
	ok(out[0].includes("ERROR") && out[0].includes("auth.py:145") && out[0].includes("validate"), "header line: level + source + fn");
	ok(out.some((l) => l.includes("boom")), "message line present");
	ok(out.some((l) => l.includes("2023-11-01T14:53:12.123Z")), "timestamp line present");
	// no variables/stack_trace section when absent
	ok(!out.some((l) => l.includes("variables")), "no variables section when absent");
	ok(!out.some((l) => l.includes("stack_trace")), "no stack_trace section when absent");

	// with variables
	const withVars = formatPacketExpanded({ ...base, variables: { a: 1, b: "x" } }, theme);
	ok(withVars.some((l) => l.includes("variables")), "variables section header present");
	// keys are muted-tagged, values JSON-stringified: `<muted>a</muted>: 1`, `<muted>b</muted>: "x"`
	ok(withVars.some((l) => l.includes("</muted>: 1")), "variable a rendered (key muted, value JSON)");
	ok(withVars.some((l) => l.includes('</muted>: "x"')), "variable b rendered (string value quoted)");
	// empty variables object → no section
	eq(formatPacketExpanded({ ...base, variables: {} }, theme).some((l) => l.includes("variables")), false, "empty variables object → no section");

	// with multi-line stack_trace
	const withStack = formatPacketExpanded({ ...base, stack_trace: "Frame A\nFrame B" }, theme);
	ok(withStack.some((l) => l.includes("stack_trace")), "stack_trace section present");
	eq(withStack.filter((l) => l.includes("Frame A") || l.includes("Frame B")).length, 2, "stack_trace split into 2 lines");
}

console.log("\n[TAIL_LIMIT]");
eq(TAIL_LIMIT, 3, "TAIL_LIMIT is 3");

console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
