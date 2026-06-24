/**
 * Tests for widget.ts (Part 3 skeleton).
 * Run: node --experimental-strip-types scripts/widget-test.ts
 */

import assert from "node:assert/strict";
import { buildWidgetLines, type WidgetTheme } from "../widget.ts";
import { DebugSession, DebugState, type DebugSessionState } from "../state.ts";
import type { LogPacket } from "../server.ts";

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log("  ok -", name);
}

// Fake theme: wraps text in markers so assertions can "see" colors used.
function fakeTheme(): WidgetTheme {
  return {
    fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
    bold: (text: string) => `<b>${text}</b>`,
  };
}

function snap(s: DebugSession): DebugSessionState {
  return s.getSnapshot() as DebugSessionState;
}

const samplePacket: LogPacket = {
  log_id: "1",
  event_timestamp: "2023-11-01T14:53:12.123Z",
  level: "ERROR",
  source: { file: "auth.py", line: 145, function: "validate" },
  message: "token length mismatch",
};

function main(): void {
  check("inactive session renders no lines", () => {
    const s = new DebugSession();
    const lines = buildWidgetLines({ snapshot: snap(s), packets: [], lastPacketAt: null, now: 0 }, fakeTheme());
    assert.deepEqual(lines, []);
  });

  check("AWAITING CONTEXT header shows state + target + port", () => {
    const s = new DebugSession();
    s.start({ mode: "local", telemetryTarget: "http://localhost:8866", logFile: "/l", port: 8866 });
    const lines = buildWidgetLines({ snapshot: snap(s), packets: [], lastPacketAt: null, now: 0 }, fakeTheme());
    const joined = lines.join("\n");
    assert.match(joined, /AWAITING CONTEXT/);
    assert.match(joined, /http:\/\/localhost:8866/);
    assert.match(joined, /:8866 local/);
    assert.match(joined, /Describe the bug/);
  });

  check("LIVE LOGGING tag appears when a packet arrived recently", () => {
    const s = new DebugSession();
    s.start({ mode: "local", telemetryTarget: "t", logFile: "/l", port: 8866 });
    const lines = buildWidgetLines(
      { snapshot: snap(s), packets: [samplePacket], lastPacketAt: 1000, now: 1500 },
      fakeTheme(),
    );
    assert.match(lines.join("\n"), /LIVE LOGGING/);
    assert.match(lines.join("\n"), /Log stream/);
    assert.match(lines.join("\n"), /token length mismatch/);
  });

  check("LIVE LOGGING hidden when no recent packet", () => {
    const s = new DebugSession();
    s.start({ mode: "local", telemetryTarget: "t", logFile: "/l", port: 8866 });
    const lines = buildWidgetLines(
      { snapshot: snap(s), packets: [], lastPacketAt: null, now: 0 },
      fakeTheme(),
    );
    assert.doesNotMatch(lines.join("\n"), /LIVE LOGGING/);
  });

  check("hypothesis region shows statement + counter + files", () => {
    const s = new DebugSession();
    s.start({ mode: "local", telemetryTarget: "t", logFile: "/l", port: 8866 });
    s.reportHypothesis({ statement: "off-by-one in loop", files: ["loop.ts"], functions: ["iter"] });
    s.reportHypothesis({ statement: "second idea", files: ["x.ts"], functions: [] }); // counter -> 2
    const lines = buildWidgetLines({ snapshot: snap(s), packets: [], lastPacketAt: null, now: 0 }, fakeTheme());
    const joined = lines.join("\n");
    assert.match(joined, /Hypothesis/);
    assert.match(joined, /#2/);
    assert.match(joined, /second idea/);
    assert.match(joined, /files: x\.ts/);
  });

  check("FIXING BUG body shows attempts remaining and reply options", () => {
    const s = new DebugSession();
    s.start({ mode: "local", telemetryTarget: "t", logFile: "/l", port: 8866, maxAttempts: 3 });
    s.reportHypothesis({ statement: "h", files: [], functions: [] });
    s.startFix();
    s.recordContinue(); // 1 attempt used
    s.reportHypothesis({ statement: "h2", files: [], functions: [] });
    s.startFix();
    const lines = buildWidgetLines({ snapshot: snap(s), packets: [], lastPacketAt: null, now: 0 }, fakeTheme());
    const joined = lines.join("\n");
    assert.match(joined, /Fix deployed/);
    assert.match(joined, /2 attempt\(s\) left/);
    assert.match(joined, /Bug Fixed|Continue to Debug/);
  });

  check("log stream capped to maxLogLines (tail)", () => {
    const s = new DebugSession();
    s.start({ mode: "local", telemetryTarget: "t", logFile: "/l", port: 8866 });
    const packets: LogPacket[] = Array.from({ length: 10 }, (_, i) => ({
      ...samplePacket,
      log_id: String(i),
      message: `msg-${i}`,
    }));
    const lines = buildWidgetLines(
      { snapshot: snap(s), packets, lastPacketAt: 1, now: 2, maxLogLines: 3 },
      fakeTheme(),
    );
    const joined = lines.join("\n");
    assert.match(joined, /msg-9/);
    assert.match(joined, /msg-8/);
    assert.match(joined, /msg-7/);
    assert.doesNotMatch(joined, /msg-6/);
  });

  check("all 7 states render without throwing", () => {
    const t = fakeTheme();
    for (const st of Object.values(DebugState)) {
      const s = new DebugSession();
      s.start({ mode: "remote", telemetryTarget: "https://x.ngrok", logFile: "/l", port: 8866 });
      // Force each state via the available transitions.
      switch (st) {
        case DebugState.AwaitingContext: s.setAwaitingContext(); break;
        case DebugState.AwaitingContextAmbiguous: s.setAmbiguous(); break;
        case DebugState.ParsingAsset: s.setParsingAsset(); break;
        case DebugState.HypothesisValidation:
          s.reportHypothesis({ statement: "x", files: [], functions: [] }); break;
        case DebugState.FixingBug: s.startFix(); break;
        case DebugState.BugFixed: s.recordFixed(); break;
        case DebugState.DebugSummary: s.setSummary(); break;
      }
      const lines = buildWidgetLines({ snapshot: snap(s), packets: [], lastPacketAt: null, now: 0 }, t);
      assert.ok(lines.length >= 2, `${st} rendered >=2 lines`);
    }
  });

  console.log(`\nOK: all widget assertions passed (${passed}).`);
}

main();
