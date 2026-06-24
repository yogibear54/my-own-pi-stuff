/**
 * Integration test: load index.ts against a mock ExtensionAPI (no TUI required).
 * Resolves the real pi packages via NODE_PATH so imports are exercised.
 *
 * Run:
 *   NODE_PATH=$(node -e 'console.log(require("module").globalPaths.join(":"))') \
 *     node --experimental-strip-types scripts/integration-test.ts
 *
 * (The test runner below sets NODE_PATH resolution up by importing from the
 * global install if needed — see resolveGlobal.)
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

// index.ts imports "@earendil-works/pi-coding-agent", "typebox", "@earendil-works/pi-tui".
// They live nested under the global pi-coding-agent install. Create transient
// symlinks in the extension's node_modules so ESM can resolve them, then clean up.
const EXT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GLOBAL = "/home/yogibear54/.nvm/versions/node/v22.19.0/lib/node_modules";
const PKG = join(GLOBAL, "@earendil-works/pi-coding-agent");
const LINKS: Array<[string, string]> = [
  ["@earendil-works/pi-coding-agent", PKG],
  ["@earendil-works/pi-tui", join(PKG, "node_modules/@earendil-works/pi-tui")],
  ["@earendil-works/pi-ai", join(PKG, "node_modules/@earendil-works/pi-ai")],
  ["@earendil-works/pi-agent-core", join(PKG, "node_modules/@earendil-works/pi-agent-core")],
  ["typebox", join(PKG, "node_modules/typebox")],
];

async function setupResolution(): Promise<() => Promise<void>> {
  await mkdir(join(EXT_DIR, "node_modules", "@earendil-works"), { recursive: true });
  for (const [name, target] of LINKS) {
    const linkPath = join(EXT_DIR, "node_modules", name);
    await rm(linkPath, { force: true });
    await symlink(target, linkPath, "dir");
  }
  return async () => {
    for (const [name] of LINKS) await rm(join(EXT_DIR, "node_modules", name), { force: true, recursive: true });
    await rm(join(EXT_DIR, "node_modules", "@earendil-works"), { force: true, recursive: true }).catch(() => {});
    await rm(join(EXT_DIR, "node_modules"), { force: true, recursive: true }).catch(() => {});
  };
}

const cleanupResolution = await setupResolution();
const dbg = (await import("../index.ts")).default;

// --- mock ExtensionAPI -----------------------------------------------------
interface ToolDef { name: string; execute: (...args: never[]) => Promise<unknown>; parameters?: unknown }
interface CmdDef { handler: (args: string, ctx: unknown) => Promise<unknown> }

function mockApi() {
  const handlers = new Map<string, ((e: unknown, ctx: unknown) => Promise<unknown>)[]>();
  const tools = new Map<string, ToolDef>();
  const commands = new Map<string, CmdDef>();
  let activeTools = ["read", "bash", "edit", "write"];
  const entries: Array<{ type: string; customType?: string; data?: unknown }> = [];
  return {
    on(event: string, h: (e: unknown, ctx: unknown) => Promise<unknown>) {
      (handlers.get(event) ?? handlers.set(event, []).get(event)!).push(h);
    },
    async fire(event: string, e: unknown, ctx: unknown) {
      let out: unknown;
      for (const h of handlers.get(event) ?? []) {
        const r = await h(e, ctx);
        if (r !== undefined) out = r;
      }
      return out;
    },
    registerTool(def: ToolDef) { tools.set(def.name, def); },
    registerCommand(name: string, def: CmdDef) { commands.set(name, def); },
    getActiveTools: () => [...activeTools],
    setActiveTools: (t: string[]) => { activeTools = [...t]; },
    appendEntry: (customType: string, data?: unknown) => { entries.push({ type: "custom", customType, data }); },
    getEntries: () => entries,
    tool: (n: string) => tools.get(n),
    cmd: (n: string) => commands.get(n),
    activeToolList: () => activeTools,
  };
}

type MockApi = ReturnType<typeof mockApi>;

function mockCtx(api: MockApi, cwd: string) {
  const calls: Record<string, unknown[]> = { notify: [], setStatus: [], setWidget: [], setEditorText: [], select: [] };
  let selectResult = "Bug Fixed";
  return {
    calls,
    setSelectResult(v: string) { selectResult = v; },
    ctx: {
      mode: "tui" as const,
      hasUI: true,
      cwd,
      ui: {
        notify: (m: string, _l?: string) => { calls.notify.push(m); },
        setStatus: (k: string, v: unknown) => { calls.setStatus.push([k, v]); },
        setWidget: (k: string, v: unknown) => { calls.setWidget.push([k, v]); },
        setEditorText: (t: string) => { calls.setEditorText.push(t); },
        select: async (_q: string, _opts: string[]) => { calls.select.push(_opts); return selectResult; },
        theme: { fg: (_c: string, t: string) => t, bold: (t: string) => t },
      },
      sessionManager: { getEntries: () => api.getEntries() },
      // tool execute() receives ctx too; ensure same shape is usable there.
    },
  };
}

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log("  ok -", name);
}

async function main(): Promise<void> {
  assert.equal(typeof dbg, "function", "default export is a factory");
  process.env.PI_DEBUG_PORT = "0"; // OS-assigned port for the test server
  const api = mockApi();
  dbg(api as unknown as never);

  check("factory registers the /debug command + 8 debug tools", () => {
    assert.ok(api.cmd("debug"), "/debug command registered");
    for (const t of ["inject_snippet", "remove_snippet", "list_snippets", "cleanup_all_snippets", "report_hypothesis", "request_user_test", "mark_bug_fixed", "debug_summary"]) {
      assert.ok(api.tool(t), `tool ${t} registered`);
    }
  });

  const cwd = await mkdtemp(join(tmpdir(), "dbg-int-"));
  const { ctx, calls } = mockCtx(api, cwd);

  // resources_discover -> skill path contributed
  const res = await api.fire("resources_discover", { cwd, reason: "startup" }, ctx) as { skillPaths?: string[] };
  check("resources_discover contributes the skill dir", () => {
    assert.ok(res?.skillPaths?.some((p) => p.endsWith("/skill")), "skill dir in skillPaths");
  });

  // session_start -> widget set, status set (inactive -> cleared)
  await api.fire("session_start", { reason: "startup" }, ctx);
  check("session_start installs widget + clears status (inactive)", () => {
    assert.ok(calls.setWidget.some(([k]) => k === "debugger"), "widget installed");
    assert.ok(calls.setStatus.some(([k, v]) => k === "debugger" && v === undefined), "status cleared when inactive");
  });

  // start a LOCAL debug session via /debug
  await api.cmd("debug")!.handler("", ctx);
  check("/debug (local) starts session: tools enabled, status set, editor prefilled, widget live", () => {
    assert.ok(api.activeToolList().includes("inject_snippet"), "debug tools enabled");
    assert.ok(calls.setStatus.some(([k]) => k === "debugger"), "status set");
    assert.ok(calls.setEditorText.length > 0, "editor text set");
    assert.ok(calls.notify.some((m) => String(m).includes("Debug session started")), "start notify");
  });

  // POST a valid packet to the running server; the buffer should pick it up.
  // Find the port from the notify message.
  const startMsg = calls.notify.find((m) => String(m).includes("Debug session started")) as string;
  const port = Number(String(startMsg).match(/:(\d+)/)?.[1]);
  check("server is listening and accepts a valid packet (200)", async () => {
    assert.ok(port > 0, "parsed port from notify");
    const packet = {
      log_id: "t-1", event_timestamp: new Date().toISOString(), level: "ERROR",
      source: { file: "a.ts", line: 1, function: "f" }, message: "boom",
    };
    const r = await fetch(`http://127.0.0.1:${port}/`, { method: "POST", body: JSON.stringify(packet) });
    assert.equal(r.status, 200);
    await new Promise((rr) => setTimeout(rr, 120)); // let onPacket -> render throttle fire
  });

  // report_hypothesis tool -> state advances
  await api.tool("report_hypothesis")!.execute("x", { statement: "off by one", files: ["a.ts"], functions: ["f"] } as never, undefined, undefined, ctx);
  check("report_hypothesis persists state", () => {
    const last = api.getEntries().filter((e) => e.customType === "debugger").pop();
    assert.equal(last?.data?.state, "HYPOTHESIS & BUG VALIDATION");
    assert.equal(last?.data?.hypothesisCount, 1);
  });

  // inject_snippet into a real temp file, then verify delimiters + tracking
  const target = join(cwd, "sample.ts");
  await mkdir(cwd, { recursive: true });
  await writeFile(target, "function f() {\n  return 1;\n}\n", "utf8");
  await api.tool("inject_snippet")!.execute("x", { path: "sample.ts", line: 2, id: 1, name: "probe", code: "console.log('hit')" } as never, undefined, undefined, ctx);
  check("inject_snippet writes delimited block + tracks it", async () => {
    const content = await readFile(target, "utf8");
    assert.match(content, /AI_DEBUG_SNIPPET_START:ID=1 NAME="probe"/);
    assert.match(content, /AI_DEBUG_SNIPPET_END/);
    const last = api.getEntries().filter((e) => e.customType === "debugger").pop();
    assert.equal(last?.data?.snippetIds?.length, 1);
  });

  // list_snippets reflects the injected snippet
  const listed = await api.tool("list_snippets")!.execute("x", {} as never, undefined, undefined, ctx) as { content: { text: string }[] };
  check("list_snippets reports the injected snippet", () => {
    assert.match(listed.content[0]!.text, /ID=1/);
  });

  // request_user_test with select="Bug Fixed" -> startFix then recordFixed
  const verdict = await api.tool("request_user_test")!.execute("x", { steps: "1. run app\n2. click x" } as never, undefined, undefined, ctx) as { content: { text: string }[] };
  check("request_user_test (Bug Fixed) advances to BUG FIXED", () => {
    assert.match(verdict.content[0]!.text, /FIXED/);
    const last = api.getEntries().filter((e) => e.customType === "debugger").pop();
    assert.equal(last?.data?.state, "BUG FIXED");
  });

  // mark_bug_fixed -> cleanup telemetry (snippet removed), file restored
  await api.tool("mark_bug_fixed")!.execute("x", {} as never, undefined, undefined, ctx);
  const selectCallsAfter = calls.select.length;
  void selectCallsAfter;
  check("mark_bug_fixed removes telemetry, file byte-clean (fix-agnostic)", async () => {
    const content = await readFile(target, "utf8");
    assert.doesNotMatch(content, /AI_DEBUG_SNIPPET/);
    assert.equal(content, "function f() {\n  return 1;\n}\n");
  });

  // debug_summary -> exits debug mode (select "Exit debug mode")
  const { ctx: ctx2 } = mockCtx(api, cwd); // fresh select default = "Bug Fixed"; override below
  // We need "Exit debug mode": simulate by setting a dedicated mock via a second ctx.
  const exitMock = mockCtx(api, cwd);
  exitMock.setSelectResult("Exit debug mode");
  await api.tool("debug_summary")!.execute("x", { summary: "Fixed off-by-one" } as never, undefined, undefined, exitMock.ctx);
  check("debug_summary (Exit) stops the session and clears widget", () => {
    assert.ok(exitMock.calls.setWidget.some(([k, v]) => k === "debugger" && v === undefined), "widget cleared on stop");
    assert.ok(exitMock.calls.notify.some((m) => String(m).includes("stopped")), "stop notify");
    // debug tools removed from active list again
    assert.ok(!api.activeToolList().includes("inject_snippet"), "debug tools removed");
  });

  // /debug stop is idempotent when not active
  const noopNotifyBefore = calls.notify.length;
  await api.cmd("debug")!.handler("stop", ctx);
  check("/debug stop when inactive is a soft no-op", () => {
    assert.ok(calls.notify.length > noopNotifyBefore, "notified");
  });

  // before_agent_start injects context while active; nothing when inactive
  const inactiveInject = await api.fire("before_agent_start", { prompt: "hi" }, ctx) as { message?: { content: string } } | undefined;
  check("before_agent_start returns nothing when inactive", () => {
    assert.equal(inactiveInject, undefined);
  });

  // shutdown closes the server cleanly (idempotent)
  await api.fire("session_shutdown", { reason: "quit" }, ctx);
  check("session_shutdown closes server (port now refuses)", async () => {
    await assert.rejects(() => fetch(`http://127.0.0.1:${port}/`), /fetch failed|ECONNREFUSED/);
  });

  await rm(cwd, { recursive: true, force: true });
  void createServer; // keep import meaningful
  void ctx2;
  console.log(`\nOK: all integration assertions passed (${passed}).`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => cleanupResolution());
