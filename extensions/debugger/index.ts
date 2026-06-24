/**
 * Pi AI Debugger — extension entry point.
 *
 * Composes the four pure modules into a debug mode:
 *   server.ts   (Part 1) — HTTP telemetry receiver
 *   state.ts    (Part 5) — session state machine
 *   snippets.ts (Part 4) — telemetry snippet delimiters
 *   widget.ts   (Part 3) — instrumentation widget (skeleton; pending wireframes)
 *
 * Install: copy this directory to ~/.pi/agent/extensions/debugger/ (global) or
 * .pi/extensions/debugger/ (project-local). No package.json needed (Node built-ins
 * + pi packages only).
 *
 * Design reference: docs/ARCHITECTURE.md
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { truncateToWidth } from "@earendil-works/pi-tui";

import {
  type LogPacket,
  type LogServerHandle,
  isValidPacket,
  startLogServer,
} from "./server.ts";
import { DebugSession, DebugState, type DebugMode, type Hypothesis } from "./state.ts";
import { commentStyleFor, findSnippets, makeSnippetLines, removeAllSnippets, removeSnippetById } from "./snippets.ts";
import { buildWidgetLines } from "./widget.ts";

const EXT_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(EXT_DIR, "skill");
// Default 8866; overridable via PI_DEBUG_PORT (e.g. 0 = OS-assigned, for tests).
const DEFAULT_PORT = Number(process.env.PI_DEBUG_PORT ?? 8866);
const PACKET_BUFFER_CAP = 500;

const DEBUG_TOOLS = [
  "inject_snippet",
  "remove_snippet",
  "list_snippets",
  "cleanup_all_snippets",
  "report_hypothesis",
  "request_user_test",
  "mark_bug_fixed",
  "debug_summary",
] as const;

export default function debuggerExtension(pi: ExtensionAPI): void {
  // --- per-session runtime state (rebound on each session_start) -----------
  let session = new DebugSession();
  let server: LogServerHandle | null = null;
  let unsubPackets: (() => void) | null = null;
  let packetBuffer: LogPacket[] = [];
  let lastPacketAt: number | null = null;
  let ngrokProc: ChildProcess | null = null;
  let ngrokUrl: string | null = null;

  let ui: ExtensionContext["ui"] | null = null;
  let logsDir = "";
  let capturedTui: { requestRender: () => void } | null = null;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  let stateSubscribed = false;
  let toolsBeforeDebug: string[] | undefined;

  // --- helpers -------------------------------------------------------------

  function persist(): void {
    if (!session.isActive() && session.getSnapshot().hypothesisCount === 0) return;
    pi.appendEntry("debugger", session.getSnapshot());
  }

  function scheduleRender(): void {
    if (!capturedTui) return;
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      capturedTui?.requestRender();
    }, 50);
  }

  function activeToolsWith(tools: readonly string[]): string[] {
    return [...new Set(tools)];
  }

  function enableDebugTools(): void {
    if (toolsBeforeDebug === undefined) toolsBeforeDebug = pi.getActiveTools();
    pi.setActiveTools(activeToolsWith([...toolsBeforeDebug, ...DEBUG_TOOLS]));
  }

  function restoreTools(): void {
    if (toolsBeforeDebug) {
      pi.setActiveTools(toolsBeforeDebug);
      toolsBeforeDebug = undefined;
    } else {
      const active = pi.getActiveTools();
      pi.setActiveTools(active.filter((t) => !(DEBUG_TOOLS as readonly string[]).includes(t)));
    }
  }

  // --- widget (set once per session; reads live state on each render) ------

  function setupWidget(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    ui = ctx.ui;
    ctx.ui.setWidget("debugger", (tui, theme) => {
      capturedTui = tui as { requestRender: () => void };
      return {
        render: (width: number) => {
          const lines = buildWidgetLines(
            {
              snapshot: session.getSnapshot(),
              packets: packetBuffer,
              lastPacketAt,
              now: Date.now(),
            },
            theme,
          );
          return lines.map((l) => truncateToWidth(l, Math.max(1, width)));
        },
        invalidate: () => {},
      };
    });
  }

  function setStatus(): void {
    if (!ui) return;
    if (session.isActive()) {
      const s = session.getSnapshot();
      ui.setStatus("debugger", ui.theme.fg("warning", `🐞 ${s.state}`));
    } else {
      ui.setStatus("debugger", undefined);
    }
  }

  function subscribeStateOnce(): void {
    if (stateSubscribed) return;
    stateSubscribed = true;
    session.subscribe(() => {
      persist();
      setStatus();
      scheduleRender();
    });
  }

  // --- snippet file helpers (queue-aware) ----------------------------------

  async function readMaybe(path: string): Promise<string> {
    try {
      return await readFile(path, "utf8");
    } catch {
      return "";
    }
  }

  async function injectSnippetFile(absPath: string, line: number, id: number, name: string, language: string | undefined, code: string): Promise<number> {
    return withFileMutationQueue(absPath, async () => {
      let content = "";
      try {
        content = await readFile(absPath, "utf8");
      } catch {
        // new file
      }
      const lines = content.split("\n");
      const style = commentStyleFor(language ?? absPath);
      const block = makeSnippetLines(id, name, code, style);
      const at = Math.max(0, Math.min(line - 1, lines.length));
      lines.splice(at, 0, ...block);
      await writeFile(absPath, lines.join("\n"), "utf8");
      return at + 1; // 1-based line of the START marker
    });
  }

  // --- remote (ngrok) ------------------------------------------------------

  async function startNgrok(port: number): Promise<string> {
    return new Promise((resolveP, rejectP) => {
      let proc: ChildProcess;
      try {
        proc = spawn("ngrok", ["http", String(port), "--log=stdout"], {
          stdio: ["ignore", "pipe", "pipe"],
          detached: false,
        });
      } catch (e) {
        rejectP(new Error("ngrok failed to start. Is it installed?"));
        return;
      }
      ngrokProc = proc;
      const timeout = setTimeout(async () => {
        const url = await fetchNgrokUrl().catch(() => null);
        if (url) {
          clearTimeout(timeout);
          resolveP(url);
        } else {
          clearTimeout(timeout);
          rejectP(new Error("Could not determine ngrok public URL (is ngrok authenticated?)."));
        }
      }, 3000);
      proc.on("error", () => {
        clearTimeout(timeout);
        rejectP(new Error("ngrok not found. Install it from https://ngrok.com"));
      });
    });
  }

  async function fetchNgrokUrl(): Promise<string | null> {
    const res = await fetch("http://127.0.0.1:4040/api/tunnels");
    if (!res.ok) return null;
    const data = (await res.json()) as { tunnels?: Array<{ public_url?: string; proto?: string }> };
    const tunnel = data.tunnels?.find((t) => t.public_url?.startsWith("https://")) ?? data.tunnels?.[0];
    return tunnel?.public_url ?? null;
  }

  function stopNgrok(): void {
    if (ngrokProc) {
      try {
        ngrokProc.kill("SIGTERM");
      } catch {
        // ignore
      }
      ngrokProc = null;
    }
    ngrokUrl = null;
  }

  // --- session lifecycle ---------------------------------------------------

  async function startDebug(ctx: ExtensionContext, mode: DebugMode): Promise<void> {
    if (session.isActive()) {
      ctx.ui.notify("A debug session is already active. Use /debugger stop first.", "warning");
      return;
    }
    logsDir = join(ctx.cwd, CONFIG_DIR_NAME, "logs");
    await mkdir(logsDir, { recursive: true });

    try {
      server = await startLogServer({ port: DEFAULT_PORT, logsDir });
    } catch (e) {
      ctx.ui.notify(`Failed to start log server on :${DEFAULT_PORT}: ${(e as Error).message}`, "error");
      return;
    }

    packetBuffer = [];
    lastPacketAt = null;
    unsubPackets = server.onPacket((p) => {
      if (isValidPacket(p)) {
        packetBuffer.push(p);
        if (packetBuffer.length > PACKET_BUFFER_CAP) packetBuffer.shift();
        lastPacketAt = Date.now();
        scheduleRender();
      }
    });

    let target = `http://localhost:${server.port}`;
    if (mode === "remote") {
      try {
        const url = await startNgrok(server.port);
        ngrokUrl = url;
        target = url;
      } catch (e) {
        await server.close();
        server = null;
        unsubPackets?.();
        unsubPackets = null;
        ctx.ui.notify(`Remote mode unavailable: ${(e as Error).message}`, "error");
        return;
      }
    }

    subscribeStateOnce();
    session.start({ mode, telemetryTarget: target, logFile: server.logFile, port: server.port });
    enableDebugTools();
    setStatus();

    const where = mode === "remote" ? `remote (${ngrokUrl})` : `local :${server.port}`;
    ctx.ui.notify(`🐞 Debug session started — ${where}\nTarget: ${target}`, "info");
    if (mode === "local") {
      ctx.ui.setEditorText?.("Describe the bug: paste a stack trace, error text, or a screenshot path.");
    } else {
      ctx.ui.setEditorText?.("Describe the remote bug. I'll give you copy-paste patches to apply.");
    }
  }

  async function cleanupAllSnippets(ctx: ExtensionContext): Promise<number> {
    // Group tracked snippets by file and strip them all. Fixes are separate edits.
    const byFile = new Map<string, number[]>();
    for (const s of session.getSnippets()) {
      const arr = byFile.get(s.file) ?? [];
      arr.push(s.id);
      byFile.set(s.file, arr);
    }
    let removed = 0;
    for (const [file] of byFile) {
      const abs = resolve(ctx.cwd, file.replace(/^@/, ""));
      await withFileMutationQueue(abs, async () => {
        let content = "";
        try {
          content = await readFile(abs, "utf8");
        } catch {
          return;
        }
        const res = removeAllSnippets(content);
        removed += res.removed.length;
        await writeFile(abs, res.content, "utf8");
      });
    }
    // Clear tracking in state.
    for (const s of [...session.getSnippets()]) session.removeSnippet(s.id);
    return removed;
  }

  async function stopDebug(ctx: ExtensionContext): Promise<void> {
    if (!session.isActive()) {
      ctx.ui.notify("No active debug session.", "info");
      return;
    }
    const removed = await cleanupAllSnippets(ctx).catch(() => 0);
    stopNgrok();
    unsubPackets?.();
    unsubPackets = null;
    if (server) {
      await server.close().catch(() => {});
      server = null;
    }
    session.stop();
    persist();
    restoreTools();
    setStatus();
    if (ctx.hasUI) ctx.ui.setWidget("debugger", undefined);
    ctx.ui.notify(`Debug session stopped. Removed ${removed} telemetry snippet(s).`, "info");
  }

  // --- commands ------------------------------------------------------------

  pi.registerCommand("debugger", {
    description: "Start a debug session (/debugger | /debugger remote | /debugger stop)",
    getArgumentCompletions: (prefix: string) => {
      const opts = ["local", "remote", "stop"];
      const items = opts.map((o) => ({ value: o, label: o }));
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args: string, ctx) => {
      const arg = (args ?? "").trim().toLowerCase();
      if (arg === "stop") return stopDebug(ctx);
      if (arg === "" || arg === "local") return startDebug(ctx, "local");
      if (arg === "remote") return startDebug(ctx, "remote");
      ctx.ui.notify(`Unknown /debugger argument: "${args}". Use local, remote, or stop.`, "warning");
    },
  });

  // --- tools (Part 4: snippets) --------------------------------------------

  function notActive(): { content: { type: "text"; text: string }[] } {
    return {
      content: [
        { type: "text", text: "No active debug session. Start one with /debugger (or /debugger remote), then retry." },
      ],
    };
  }

  pi.registerTool({
    name: "inject_snippet",
    label: "Inject Snippet",
    description:
      "Inject a delimited telemetry snippet into a file at a given 1-based line. Use to validate a hypothesis by streaming app state to the debug server. Returns the resulting line number — use it as source.line in the packet.",
    promptSnippet: "Inject a delimited telemetry logging snippet into a file",
    promptGuidelines: [
      "Use inject_snippet (not raw edit) when adding telemetry during a debug session, so cleanup can remove it reliably.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Target file path (relative to cwd)." }),
      line: Type.Integer({ description: "1-based line to insert before." }),
      id: Type.Integer({ description: "Unique snippet id (matches AI_DEBUG_SNIPPET_START:ID=)." }),
      name: Type.String({ description: "Short label for the snippet." }),
      language: Type.Optional(Type.String({ description: "Language or file path hint for comment style." })),
      code: Type.String({ description: "Snippet body: code that POSTs a telemetry packet to the target." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!session.isActive()) return notActive();
      const file = (params.path as string).replace(/^@/, "");
      const abs = resolve(ctx.cwd, file);
      const startLine = await injectSnippetFile(
        abs,
        params.line as number,
        params.id as number,
        params.name as string,
        params.language as string | undefined,
        params.code as string,
      );
      session.addSnippet({ id: params.id as number, file, name: params.name as string, line: startLine });
      return {
        content: [
          {
            type: "text",
            text: `Injected snippet ID=${params.id} at ${file}:${startLine}. Set source.line=${startLine} in the packet.`,
          },
        ],
        details: { file, line: startLine, id: params.id },
      };
    },
  });

  pi.registerTool({
    name: "remove_snippet",
    label: "Remove Snippet",
    description: "Remove a single telemetry snippet by id from a file. Use when a hypothesis/fix attempt is abandoned.",
    promptSnippet: "Remove one telemetry snippet by id",
    parameters: Type.Object({
      path: Type.String(),
      id: Type.Optional(Type.Integer()),
      all: Type.Optional(Type.Boolean({ description: "Remove all snippets in this file." })),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!session.isActive()) return notActive();
      const file = (params.path as string).replace(/^@/, "");
      const abs = resolve(ctx.cwd, file);
      const result = await withFileMutationQueue(abs, async () => {
        const content = await readMaybe(abs);
        if (!content) return { removed: 0 };
        if (params.all) {
          const res = removeAllSnippets(content);
          await writeFile(abs, res.content, "utf8");
          return { removed: res.removed.length };
        }
        const res = removeSnippetById(content, params.id as number);
        if (res.removed) {
          await writeFile(abs, res.content, "utf8");
          session.removeSnippet(params.id as number);
          return { removed: 1 };
        }
        return { removed: 0 };
      });
      return { content: [{ type: "text", text: `Removed ${result.removed} snippet(s) from ${file}.` }], details: result };
    },
  });

  pi.registerTool({
    name: "list_snippets",
    label: "List Snippets",
    description: "List telemetry snippets currently injected in a file (or all tracked snippets if no path).",
    promptSnippet: "List injected telemetry snippets",
    parameters: Type.Object({ path: Type.Optional(Type.String()) }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!session.isActive()) return notActive();
      if (params.path) {
        const abs = resolve(ctx.cwd, (params.path as string).replace(/^@/, ""));
        const content = await readMaybe(abs);
        const found = findSnippets(content).map((b) => `ID=${b.id} NAME="${b.name}" @${params.path}:${b.startIndex + 1}`);
        return { content: [{ type: "text", text: found.length ? found.join("\n") : "No snippets in that file." }] };
      }
      const tracked = session.getSnippets().map((s) => `ID=${s.id} NAME="${s.name}" @${s.file}:${s.line}`);
      return { content: [{ type: "text", text: tracked.length ? tracked.join("\n") : "No snippets tracked." }] };
    },
  });

  pi.registerTool({
    name: "cleanup_all_snippets",
    label: "Cleanup Snippets",
    description: "Remove ALL telemetry snippets from every tracked file, keeping any applied fixes. Called automatically on /debugger stop and when a bug is fixed.",
    promptSnippet: "Remove all telemetry snippets, keep fixes",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      if (!session.isActive()) return notActive();
      const removed = await cleanupAllSnippets(ctx);
      return { content: [{ type: "text", text: `Removed ${removed} telemetry snippet(s). Fixes are preserved.` }] };
    },
  });

  // --- tools (Part 5: loop transitions) ------------------------------------

  pi.registerTool({
    name: "report_hypothesis",
    label: "Report Hypothesis",
    description: "Record a defect hypothesis (suspected cause + file(s)/function(s)). Enters the HYPOTHESIS & BUG VALIDATION phase. Call once you have enough context to form a theory.",
    promptSnippet: "Record a defect hypothesis to start validation",
    promptGuidelines: ["Use report_hypothesis when you have a theory about the bug's cause and the files/functions involved."],
    parameters: Type.Object({
      statement: Type.String({ description: "The hypothesized root cause." }),
      files: Type.Array(Type.String(), { description: "Suspected source files." }),
      functions: Type.Array(Type.String(), { description: "Suspected functions/methods." }),
    }),
    async execute(_id, params) {
      if (!session.isActive()) return notActive();
      const hypothesis: Hypothesis = {
        statement: params.statement as string,
        files: (params.files as string[]) ?? [],
        functions: (params.functions as string[]) ?? [],
      };
      session.reportHypothesis(hypothesis);
      return {
        content: [
          {
            type: "text",
            text: `Hypothesis #${session.getSnapshot().hypothesisCount} recorded. Now inject telemetry (inject_snippet) to validate it, then implement the fix and call request_user_test.`,
          },
        ],
      };
    },
  });

  pi.registerTool({
    name: "request_user_test",
    label: "Request User Test",
    description: "Present reproduction steps to the user and ask them to verify. Returns the user's verdict: BUG_FIXED or CONTINUE. On CONTINUE, remove the failed fix + its telemetry, then form a new hypothesis.",
    promptSnippet: "Ask the user to reproduce and report Bug Fixed / Continue",
    promptGuidelines: ["Use request_user_test after deploying a fix to get the user's Bug Fixed / Continue verdict."],
    parameters: Type.Object({
      steps: Type.String({ description: "Step-by-step reproduction instructions for the user." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!session.isActive()) return notActive();
      session.startFix();
      const choice = await ctx.ui.select(
        `Please reproduce using these steps:\n\n${params.steps as string}\n\nWhat happened?`,
        ["Bug Fixed", "Continue to Debug"],
      );
      if (choice === "Bug Fixed") {
        session.recordFixed();
        return {
          content: [
            {
              type: "text",
              text: 'User reports FIXED. Call mark_bug_fixed to strip telemetry (keeping the fix), then debug_summary.',
            },
          ],
        };
      }
      const next = session.recordContinue();
      const remaining = session.getSnapshot().maxAttempts - session.getSnapshot().attempts;
      if (next === DebugState.AwaitingContext) {
        return {
          content: [
            {
              type: "text",
              text: "Max fix attempts reached. Remove the failed fix AND all telemetry for this attempt (cleanup_all_snippets + revert the fix), then gather more context from the user (we're back in AWAITING CONTEXT).",
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `User says still broken. Remove the failed fix AND this attempt's telemetry (cleanup_all_snippets / remove_snippet + revert the fix), then call report_hypothesis with a new theory. ${remaining} attempt(s) left.`,
          },
        ],
      };
    },
  });

  pi.registerTool({
    name: "mark_bug_fixed",
    label: "Mark Bug Fixed",
    description: "Accept the fix: removes all telemetry snippets while keeping the fix, then prompts the user for a final validation. Call after the user confirms the bug is fixed.",
    promptSnippet: "Accept fix, strip telemetry, keep the fix",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      if (!session.isActive()) return notActive();
      session.recordFixed();
      const removed = await cleanupAllSnippets(ctx);
      const ok = await ctx.ui.select(
        `Telemetry removed (${removed} snippet(s)); the fix is kept. Please run a final check.`,
        ["Looks good", "Bug came back"],
      );
      if (ok === "Bug came back") {
        const next = session.recordContinue();
        return {
          content: [
            {
              type: "text",
              text:
                next === DebugState.AwaitingContext
                  ? "Final check failed and attempts exhausted. Gather more context from the user."
                  : "Final check failed. Form a new hypothesis (report_hypothesis) and retry.",
            },
          ],
        };
      }
      return {
        content: [
          { type: "text", text: "Final validation passed. Call debug_summary with a short summary of the bug and the fix." },
        ],
      };
    },
  });

  pi.registerTool({
    name: "debug_summary",
    label: "Debug Summary",
    description: "End the loop with a summary of the bug and the fix applied. Asks the user whether to exit debug mode or continue with a new bug.",
    promptSnippet: "Finish the debug loop with a summary",
    parameters: Type.Object({
      summary: Type.String({ description: "Concise summary: the bug, root cause, and the fix applied." }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!session.isActive()) return notActive();
      session.setSummary();
      const choice = await ctx.ui.select(`${params.summary as string}\n\nDebug complete.`, [
        "Exit debug mode",
        "Continue with a new bug",
      ]);
      if (choice === "Exit debug mode") {
        await stopDebug(ctx);
        return { content: [{ type: "text", text: "Exited debug mode." }] };
      }
      session.setAwaitingContext();
      packetBuffer = [];
      lastPacketAt = null;
      return { content: [{ type: "text", text: "Ready for the next bug. Gather context from the user." }] };
    },
  });

  // --- events --------------------------------------------------------------

  // Contribute the skill so /skill:debugger and auto-discovery work.
  pi.on("resources_discover", async () => {
    return { skillPaths: [SKILL_DIR] };
  });

  // Inject current debug state + loop guidance into the LLM context each turn.
  pi.on("before_agent_start", async () => {
    if (!session.isActive()) return;
    const s = session.getSnapshot();
    return {
      message: {
        customType: "debugger-context",
        display: false,
        content: debugGuide(s.state, s.telemetryTarget, s.attempts, s.maxAttempts),
      },
    };
  });

  pi.on("session_start", async (_event, ctx) => {
    ui = ctx.hasUI ? ctx.ui : null;
    logsDir = join(ctx.cwd, CONFIG_DIR_NAME, "logs");

    // Restore persisted state so snippet cleanup still works after /resume.
    const entries = ctx.sessionManager.getEntries() as Array<{ type: string; customType?: string; data?: unknown }>;
    const persisted = [...entries]
      .reverse()
      .find((e) => e.type === "custom" && e.customType === "debugger");
    if (persisted?.data) {
      session = DebugSession.fromSerialized(persisted.data);
    }

    setupWidget(ctx);
    subscribeStateOnce();
    setStatus();
    scheduleRender();
  });

  pi.on("session_shutdown", async () => {
    unsubPackets?.();
    unsubPackets = null;
    if (server) {
      await server.close().catch(() => {});
      server = null;
    }
    stopNgrok();
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    capturedTui = null;
  });
}

function debugGuide(state: string, target: string, attempts: number, maxAttempts: number): string {
  return `[DEBUG MODE ACTIVE] state=${state} target=${target} attempts=${attempts}/${maxAttempts}

You are driving the Pi AI Debugger loop. Follow the debugger skill (/skill:debugger):
1. Gather context (ask targeted questions if vague).
2. report_hypothesis, then validate by inject_snippet telemetry around the suspected failure.
3. Implement the fix, then request_user_test with reproduction steps.
4. On "Continue": remove the failed fix + its telemetry, then a new report_hypothesis.
5. On "Bug Fixed": mark_bug_fixed (keeps fix, strips telemetry), then debug_summary.

Telemetry packets must match the schema and POST to ${target}. Always use inject_snippet
(wrapped in AI_DEBUG_SNIPPET_START/END) so cleanup is reliable. In remote mode, give
copy-paste patches instead of editing files.`;
}
