/**
 * Unit tests for the DebugSession state machine (Part 5 core).
 * Run: node --experimental-strip-types scripts/state-test.ts
 */

import assert from "node:assert/strict";
import { DebugSession, DebugState, type Hypothesis } from "../state.ts";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log("  ok -", name);
}

function main(): void {
  const hyp: Hypothesis = { statement: "token length check off", files: ["auth.py"], functions: ["validate"] };

  check("inactive by default; throws on transitions before start", () => {
    const s = new DebugSession();
    assert.equal(s.isActive(), false);
    assert.throws(() => s.setAwaitingContext(), /not active/);
  });

  check("start() enters AWAITING CONTEXT and captures target/port/logfile", () => {
    const s = new DebugSession();
    s.start({ mode: "local", telemetryTarget: "http://localhost:8866", logFile: "/tmp/x.log", port: 8866 });
    assert.equal(s.isActive(), true);
    assert.equal(s.getSnapshot().state, DebugState.AwaitingContext);
    assert.equal(s.getSnapshot().telemetryTarget, "http://localhost:8866");
    assert.equal(s.getSnapshot().port, 8866);
    assert.equal(s.attemptsRemaining(), 3);
  });

  check("reportHypothesis increments hypothesisCount and enters HYPOTHESIS", () => {
    const s = new DebugSession();
    s.start({ mode: "local", telemetryTarget: "t", logFile: "l", port: 8866 });
    s.reportHypothesis(hyp);
    s.reportHypothesis({ ...hyp, statement: "second" });
    assert.equal(s.getSnapshot().hypothesisCount, 2);
    assert.equal(s.getSnapshot().state, DebugState.HypothesisValidation);
    assert.equal(s.getSnapshot().hypothesis?.statement, "second");
  });

  check("ambiguous/parsingAsset transitions", () => {
    const s = new DebugSession();
    s.start({ mode: "local", telemetryTarget: "t", logFile: "l", port: 8866 });
    s.setAmbiguous();
    assert.equal(s.getSnapshot().state, DebugState.AwaitingContextAmbiguous);
    s.setParsingAsset();
    assert.equal(s.getSnapshot().state, DebugState.ParsingAsset);
  });

  const loop = (() => {
    const s = new DebugSession();
    s.start({ mode: "local", telemetryTarget: "t", logFile: "l", port: 8866, maxAttempts: 3 });
    s.reportHypothesis(hyp);
    s.startFix();
    assert.equal(s.getSnapshot().state, DebugState.FixingBug);
    // 2 continues stay within the budget -> each returns to HYPOTHESIS
    assert.equal(s.recordContinue(), DebugState.HypothesisValidation);
    assert.equal(s.attemptsRemaining(), 2);
    assert.equal(s.recordContinue(), DebugState.HypothesisValidation);
    assert.equal(s.attemptsRemaining(), 1);
    // 3rd continue hits cap -> AWAITING CONTEXT, attempts reset
    assert.equal(s.recordContinue(), DebugState.AwaitingContext);
    assert.equal(s.getSnapshot().state, DebugState.AwaitingContext);
    assert.equal(s.getSnapshot().attempts, 0);
    assert.equal(s.attemptsRemaining(), 3);
    return s;
  })();
  check("fix loop: 3 continues fall back to AWAITING CONTEXT and reset attempts", () => {});

  check("recordFixed -> BUG FIXED; setSummary -> DEBUG SUMMARY", () => {
    const s = new DebugSession();
    s.start({ mode: "remote", telemetryTarget: "t", logFile: "l", port: 8866 });
    s.recordFixed();
    assert.equal(s.getSnapshot().state, DebugState.BugFixed);
    s.setSummary();
    assert.equal(s.getSnapshot().state, DebugState.DebugSummary);
  });

  check("snippet tracking add/remove/get", () => {
    const s = new DebugSession();
    s.start({ mode: "local", telemetryTarget: "t", logFile: "l", port: 8866 });
    s.addSnippet({ id: 1, file: "a.py", name: "n1", line: 10 });
    s.addSnippet({ id: 2, file: "b.py", name: "n2", line: 20 });
    assert.equal(s.getSnippets().length, 2);
    // duplicate id replaces
    s.addSnippet({ id: 1, file: "a.py", name: "n1-updated", line: 11 });
    assert.equal(s.getSnippets().length, 2);
    assert.equal(s.getSnippets().find((x) => x.id === 1)?.name, "n1-updated");
    const removed = s.removeSnippet(2);
    assert.equal(removed?.id, 2);
    assert.equal(s.getSnippets().length, 1);
    assert.equal(s.removeSnippet(999), undefined);
  });

  check("stop() resets to inactive", () => {
    const s = new DebugSession();
    s.start({ mode: "local", telemetryTarget: "t", logFile: "l", port: 8866 });
    s.stop();
    assert.equal(s.isActive(), false);
    assert.equal(s.getSnapshot().snippetIds.length, 0);
  });

  check("subscribers fire on change; subscribeAndEmit fires immediately", () => {
    const s = new DebugSession();
    let calls = 0;
    const unsub = s.subscribe(() => calls++);
    s.start({ mode: "local", telemetryTarget: "t", logFile: "l", port: 8866 });
    assert.ok(calls >= 1);
    unsub();
    const before = calls;
    s.setAmbiguous();
    assert.equal(calls, before, "unsubscribed listener not called");

    let emitted = 0;
    s.subscribeAndEmit(() => emitted++);
    assert.equal(emitted, 1);
  });

  check("serialization round-trip preserves state", () => {
    const s = new DebugSession();
    s.start({ mode: "remote", telemetryTarget: "http://x.ngrok", logFile: "/l.log", port: 8866 });
    s.reportHypothesis(hyp);
    s.addSnippet({ id: 1, file: "a.py", name: "n", line: 5 });
    const snap = s.getSnapshot();

    const restored = DebugSession.fromSerialized(snap);
    const r = restored.getSnapshot();
    assert.equal(r.active, true);
    assert.equal(r.state, DebugState.HypothesisValidation);
    assert.equal(r.hypothesisCount, 1);
    assert.equal(r.snippetIds.length, 1);
    assert.equal(r.telemetryTarget, "http://x.ngrok");
  });

  check("fromSerialized tolerates bad enum + partial data", () => {
    const restored = DebugSession.fromSerialized({ active: true, state: "NOPE", mode: "local" });
    assert.equal(restored.getSnapshot().state, DebugState.AwaitingContext);
    const empty = DebugSession.fromSerialized({});
    assert.equal(empty.isActive(), false);
    const fromNull = DebugSession.fromSerialized(null);
    assert.equal(fromNull.isActive(), false);
  });

  void loop;
  console.log(`\nOK: all state machine assertions passed (${passed}).`);
}

main();
