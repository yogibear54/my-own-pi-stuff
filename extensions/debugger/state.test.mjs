/**
 * Unit tests for state.ts — the debug state machine + persisted snippet map.
 *
 * Run: `node state.test.mjs` (Node ≥ 22.6 type-stripping). state.ts has only a
 * type-only import, so no SDK resolution is needed.
 */
import {
	init, getState, setState, clearState, initialDebugState, resetForNewBug,
	assignSnippetId, trackSnippet, untrackSnippet, getSnippetMap, clearSnippets,
	setBug, reportHypothesis, transition, recordTestResult, serialize, deserialize,
	DEFAULT_MAX_ATTEMPTS,
} from "./state.ts";

let failures = 0;
function ok(cond, msg) { if (cond) console.log("  ok  -", msg); else { failures++; console.log("  FAIL-", msg); } }
function eq(actual, expected, msg) { ok(actual === expected, `${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`); }

// Stub persist + onChange so we can assert side effects without pi.
let persistCalls = 0, changeCalls = 0;
init({ persist: () => persistCalls++, onChange: () => changeCalls++ });

console.log("\n[initialDebugState + setState/clearState]");
{
	const s = initialDebugState("local", "http://localhost:8866");
	eq(s.active, true, "initial active");
	eq(s.state, "AWAITING CONTEXT", "initial state");
	eq(s.mode, "local", "initial mode");
	eq(s.hypothesisCount, 0, "initial hypothesisCount");
	eq(s.snippetMap !== undefined && Object.keys(s.snippetMap).length, 0, "empty snippetMap");
	const before = persistCalls;
	setState(s);
	eq(persistCalls, before + 1, "setState persists");
	eq(changeCalls, before + 1, "setState notifies");
	eq(getState(), s, "getState returns current");
	clearState();
	eq(getState(), null, "clearState → null");
}

console.log("\n[setBug]");
{
	setState(initialDebugState("local", "t"));
	setBug("Login fails for empty email");
	eq(getState().bug, "Login fails for empty email", "string bug stored");
	setBug("   ");
	eq(getState().bug, null, "blank bug clears");
	setBug(null);
	eq(getState().bug, null, "null bug clears");
}

console.log("\n[reportHypothesis]");
{
	setState(initialDebugState("local", "t"));
	reportHypothesis("token check misses null");
	const s = getState();
	eq(s.state, "HYPOTHESIS & BUG VALIDATION", "state advanced");
	eq(s.hypothesisCount, 1, "count incremented");
	eq(s.attempts, 0, "attempts reset");
	reportHypothesis("second idea");
	eq(getState().hypothesisCount, 2, "second hypothesis increments count");
}

console.log("\n[recordTestResult — fixed]");
{
	setState(initialDebugState("local", "t"));
	reportHypothesis("h");
	eq(recordTestResult("fixed"), "BUG FIXED", "fixed → BUG FIXED");
}

console.log("\n[recordTestResult — continue up to MAX then AWAITING CONTEXT]");
{
	setState(initialDebugState("local", "t"));
	reportHypothesis("h");
	for (let i = 1; i < DEFAULT_MAX_ATTEMPTS; i++) {
		eq(recordTestResult("continue"), "HYPOTHESIS & BUG VALIDATION", `attempt ${i} < MAX → retry`);
		eq(getState().attempts, i, `attempts == ${i}`);
	}
	// MAX-th failure → AWAITING CONTEXT, hypothesis cleared
	eq(recordTestResult("continue"), "AWAITING CONTEXT", "at MAX → AWAITING CONTEXT");
	eq(getState().hypothesis, null, "hypothesis cleared at MAX");
}

console.log("\n[snippet map — hybrid id + track/untrack/clear]");
{
	setState(initialDebugState("local", "t"));
	eq(assignSnippetId(5), 5, "explicit free id honored");
	trackSnippet(5, { file: "a.js", name: "p", line: 3 });
	eq(assignSnippetId(5), 1, "collision → auto-assign next free (1)");
	eq(assignSnippetId(undefined), 2, "omitted → next free (2)");
	trackSnippet(1, { file: "a.js", name: "x", line: 1 });
	trackSnippet(2, { file: "b.js", name: "y", line: 9 });
	eq(Object.keys(getSnippetMap()).length, 3, "3 tracked");
	untrackSnippet(1);
	eq(Object.keys(getSnippetMap()).length, 2, "untrack removes 1");
	clearSnippets();
	eq(Object.keys(getSnippetMap()).length, 0, "clearSnippets empties map");
}

console.log("\n[serialize → JSON → deserialize round-trip (numeric keys restored)]");
{
	setState(initialDebugState("local", "http://localhost:8866"));
	reportHypothesis("h");
	setBug("the bug");
	trackSnippet(7, { file: "a.js", name: "p", line: 4 });
	trackSnippet(12, { file: "b.js", name: "q", line: 8 });
	const before = getState();
	// Simulate appendEntry (JSON) + restore.
	const persisted = JSON.parse(JSON.stringify(serialize()));
	clearState();
	eq(getState(), null, "cleared before restore");
	const restored = deserialize(persisted);
	ok(restored !== null, "deserialize yields a state");
	setState(restored);
	const after = getState();
	eq(after.bug, "the bug", "bug restored");
	eq(after.hypothesisCount, 1, "hypothesisCount restored");
	eq(after.state, "HYPOTHESIS & BUG VALIDATION", "state restored");
	// snippetMap keys must be NUMBERS (JSON stringifies them) and ids preserved
	const ids = Object.keys(after.snippetMap).map(Number).sort((a, b) => a - b);
	eq(ids.join(","), "7,12", "snippet ids restored as numeric keys");
	eq(after.snippetMap[7].file, "a.js", "snippet info restored");
	eq(after.snippetMap[12].line, 8, "second snippet line restored");
}

console.log("\n[deserialize rejects invalid]");
{
	eq(deserialize(null), null, "null → null");
	eq(deserialize("nope"), null, "non-object → null");
	eq(deserialize({ active: true }), null, "missing state → null");
	const ok2 = deserialize({ active: true, state: "AWAITING CONTEXT", telemetryTarget: "t" });
	eq(ok2 !== null && ok2.active, true, "minimal valid entry accepted");
}

console.log("\n[resetForNewBug]");
{
	setState(initialDebugState("local", "t"));
	reportHypothesis("h");
	setBug("b");
	recordTestResult("fixed");
	resetForNewBug();
	const s = getState();
	eq(s.state, "AWAITING CONTEXT", "reset → AWAITING CONTEXT");
	eq(s.bug, null, "bug cleared");
	eq(s.hypothesis, null, "hypothesis cleared");
	eq(s.hypothesisCount, 0, "count reset");
}

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
