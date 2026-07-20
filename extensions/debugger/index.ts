/**
 * Pi AI Debugger — entry point.
 *
 * Wires the `/debugger` slash command to:
 *   • a red "debug" indicator in the footer (like plan-mode), and
 *   • the instrumentation widget above the editor (see widget.ts).
 *   • the HTTP log server (server.ts) whose packets stream into the widget tail
 *     and a scrollable overlay (logstream.ts, opened via `/debugger logs`).
 *   • the debug-loop state machine (state.ts, persisted) + transition tools
 *     (tools.ts): report_bug → report_hypothesis → inject_snippet →
 *     request_user_test → debug_summary.
 *
 *   `/debugger`            — start a local debug session (AWAITING CONTEXT) + open the
 *                            live log overlay.
 *   `/debugger logs`       — open the scrollable telemetry overlay.
 *   `/debugger bug`        — view the full bug summary in a read-only overlay.
 *   `/debugger bug <text>` — set the bug summary shown in the widget.
 *   `/debugger bug edit`   — edit the bug summary via a prompt.
 *   `/debugger hypothesis` — view the full hypothesis in a read-only overlay.
 *   `/debugger stop`       — stop the session: cleanup snippets, server, overlay, footer, widget.
 *
 * Note: pi reserves the built-in `/debug` command (screen-capture log), and the
 * TUI intercepts it before extension commands run, so this extension uses
 * `/debugger` instead. See docs/02-slash-commands.md.
 */
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { rmSync } from "node:fs";

import { startLogServer, type LogServerHandle, type TelemetryPacket } from "./server.ts";
import { LogStreamOverlay } from "./logstream.ts";
import { TextOverlay } from "./textoverlay.ts";
import { formatPacketCompact, initialSnapshot, renderDebugWidget, TAIL_LIMIT, type DebugSnapshot } from "./widget.ts";
import * as state from "./state.ts";
import { cleanupAllSnippets, registerReportBugTool, registerSnippetTools, registerTransitionTools } from "./tools.ts";

const WIDGET_KEY = "debugger";
const STATUS_KEY = "debug";

/** Active session snapshot (live telemetry + state-owned fields), or null. */
let snapshot: DebugSnapshot | null = null;
/** UI context captured on session_start for out-of-command repaints (onPacket). */
let uiRef: ExtensionUIContext | null = null;
/** Running log server handle, or null when stopped. */
let serverHandle: LogServerHandle | null = null;
/** Session packet history (shared by reference with the overlay). */
const packets: TelemetryPacket[] = [];
/** Open scroll overlay, or null when closed. */
let activeOverlay: LogStreamOverlay | null = null;
/** Open read-only text overlay (bug / hypothesis viewer), or null when closed. */
let activeTextOverlay: TextOverlay | null = null;

export default function debuggerExtension(pi: ExtensionAPI): void {
	// Wire state.ts persistence + widget sync. Every state mutation persists an
	// entry and repaints via syncSnapshot.
	state.init({
		persist: () => pi.appendEntry("debugger", state.serialize()),
		onChange: syncSnapshot,
	});

	pi.on("session_start", async (_event, ctx) => {
		uiRef = ctx.ui;
		await restoreOnResume(ctx);
	});

	// Ensure the server never outlives the session (reload/new/resume/quit).
	pi.on("session_shutdown", () => {
		if (serverHandle) {
			serverHandle.close();
			serverHandle = null;
		}
	});

	// Each turn, remind the model of the current debug phase + the loop protocol.
	pi.on("before_agent_start", async () => {
		const s = state.getState();
		if (!s || !s.active) return;
		const content = [
			"[DEBUG SESSION ACTIVE]",
			`Phase: ${s.state}`,
			`Bug: ${s.bug ?? "(not yet described)"}`,
			`Hypothesis #${s.hypothesisCount}: ${s.hypothesis ?? "(none yet)"}`,
			`Fix attempts: ${s.attempts}/${state.DEFAULT_MAX_ATTEMPTS}`,
			`Telemetry target: ${s.telemetryTarget}`,
			"",
			`Loop: report_bug → report_hypothesis → inject_snippet → request_user_test. On "Bug Fixed": call debug_summary. On "Continue to Debug": revert your fix, then report_hypothesis again (after ${state.DEFAULT_MAX_ATTEMPTS} failed attempts, ask the user for more context). Use inject_snippet/remove_snippet (not raw edit) for telemetry so cleanup is reliable.`,
		].join("\n");
		return { message: { customType: "debugger-phase", content, display: false } };
	});

	pi.registerCommand("debugger", {
		description: "Debug session (/debugger, /debugger logs, /debugger bug, /debugger hypothesis, /debugger stop)",
		handler: async (args, ctx) => {
			const arg = (args ?? "").trim();
			if (arg === "stop") {
				await stopDebug(ctx);
				return;
			}
			if (arg === "logs") {
				openLogOverlay(ctx);
				return;
			}
			if (arg === "bug") {
				openTextOverlay(ctx, "BUG", snapshot?.bug ?? null, "No bug described yet.");
				return;
			}
			if (arg.startsWith("bug ")) {
				const text = arg.slice("bug ".length);
				// `bug edit` keeps the old prompt path; any other text sets the summary.
				await editBug(ctx, text.trim() === "edit" ? "" : text);
				return;
			}
			if (arg === "hypothesis") {
				const n = snapshot?.hypothesisCount ?? 0;
				openTextOverlay(ctx, `HYPOTHESIS #${n}`, snapshot?.hypothesis ?? null, "No hypothesis yet.");
				return;
			}
			// `remote` mode and its ngrok tunnel land in a later todo; for now any
			// other invocation starts a local session.
			await startDebug(ctx);
		},
	});

	// All LLM tools live in tools.ts; applyBug is owned here (it also serves the
	// /debugger bug command and touches session-owned state).
	registerReportBugTool(pi, () => snapshot, applyBug);
	registerSnippetTools(pi, () => snapshot);
	registerTransitionTools(pi, {
		isActive: () => snapshot != null,
		getSnapshot: () => snapshot,
		repaint: () => {
			if (uiRef) paintUi(uiRef);
		},
		stop: (ctx) => stopDebug(ctx),
	});
}

/** Merge state-owned fields into the live snapshot and repaint. No-op if no session/widget. */
function syncSnapshot(): void {
	const s = state.getState();
	if (!snapshot || !s) return;
	snapshot.mode = s.mode;
	snapshot.state = s.state;
	snapshot.telemetryTarget = s.telemetryTarget;
	snapshot.bug = s.bug;
	snapshot.hypothesis = s.hypothesis;
	snapshot.hypothesisCount = s.hypothesisCount;
	if (uiRef) paintUi(uiRef);
}

/** Repaint the widget from the current snapshot. No-op if no session. */
function paintUi(ui: ExtensionUIContext): void {
	if (!snapshot) return;
	ui.setWidget(WIDGET_KEY, renderDebugWidget(snapshot, ui.theme));
}

/** Called per validated packet (registered on serverHandle.onPacket). */
function onPacket(packet: TelemetryPacket): void {
	packets.push(packet);
	if (snapshot && uiRef) {
		snapshot.logCount = packets.length;
		snapshot.liveLogging = true;
		snapshot.logLines = packets.slice(-TAIL_LIMIT).map((p) => formatPacketCompact(p, uiRef!.theme));
		paintUi(uiRef);
	}
	if (activeOverlay) activeOverlay.refresh();
}

/** Restore persisted debug state on resume (rebuilds widget + snippet map). */
async function restoreOnResume(ctx: ExtensionContext): Promise<void> {
	const entries = ctx.sessionManager.getEntries() as Array<{ type: string; customType?: string; data?: unknown }>;
	const entry = entries.filter((e) => e.type === "custom" && e.customType === "debugger").pop();
	const restored = entry?.data ? state.deserialize(entry.data) : null;
	if (!restored || !restored.active) return;

	// Rebuild the widget snapshot BEFORE state.setState (syncSnapshot needs it).
	snapshot = initialSnapshot();
	snapshot.mode = restored.mode;
	snapshot.state = restored.state;
	snapshot.telemetryTarget = restored.telemetryTarget;
	snapshot.bug = restored.bug;
	snapshot.hypothesis = restored.hypothesis;
	snapshot.hypothesisCount = restored.hypothesisCount;
	state.setState(restored); // persist + syncSnapshot (repaint)
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", ctx.ui.theme.bold("debug")));

	// Best-effort: restart the log server so resumed telemetry flows.
	try {
		const handle = await startLogServer({ cwd: ctx.cwd });
		serverHandle = handle;
		snapshot!.port = handle.port;
		snapshot!.telemetryTarget = handle.telemetryTarget;
		const s = state.getState();
		if (s) {
			s.telemetryTarget = handle.telemetryTarget;
			state.setState(s);
		}
		handle.onPacket((p) => onPacket(p));
	} catch {
		ctx.ui.notify("Debug session resumed; telemetry server did not restart.", "warning");
	}
}

async function startDebug(ctx: ExtensionContext): Promise<void> {
	uiRef = ctx.ui;

	// Tear down any prior session first (idempotent restart).
	if (serverHandle) {
		serverHandle.close();
		serverHandle = null;
	}
	packets.length = 0;
	snapshot = initialSnapshot();

	let handle: LogServerHandle;
	try {
		handle = await startLogServer({ cwd: ctx.cwd });
	} catch (e) {
		snapshot = null;
		state.clearState();
		ctx.ui.notify(`Failed to start log server: ${(e as Error).message}`, "error");
		return;
	}
	serverHandle = handle;
	snapshot.port = handle.port;
	snapshot.telemetryTarget = handle.telemetryTarget;
	// Canonical state (persists + syncSnapshot repaints).
	state.setState(state.initialDebugState("local", handle.telemetryTarget));

	// Footer indicator — red "debug".
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", ctx.ui.theme.bold("debug")));

	ctx.ui.notify(`Debug session started on ${handle.telemetryTarget}.`, "info");

	// Auto-open the live scroll overlay (per requirements; fire-and-forget so the
	// command handler returns promptly). It grabs focus until closed with q/Esc.
	openLogOverlay(ctx);
}

async function stopDebug(ctx: ExtensionContext): Promise<void> {
	if (!snapshot) {
		ctx.ui.notify("No active debug session.", "info");
		return;
	}
	// Remove injected telemetry snippets (best-effort); fixes are kept.
	await cleanupAllSnippets();
	state.clearState();
	if (serverHandle) {
		const logFile = serverHandle.logFile;
		serverHandle.close();
		serverHandle = null;
		// Clear this session's per-session JSONL log file.
		rmSync(logFile, { force: true });
	}
	packets.length = 0;
	if (activeOverlay) {
		activeOverlay.close();
		activeOverlay = null;
	}
	if (activeTextOverlay) {
		activeTextOverlay.close();
		activeTextOverlay = null;
	}
	snapshot = null;
	ctx.ui.setStatus(STATUS_KEY, undefined);
	ctx.ui.setWidget(WIDGET_KEY, undefined);
	ctx.ui.notify("Debug session stopped.", "info");
}

/** Assign the bug summary into state and repaint. A null/blank value clears it. */
function applyBug(ctx: ExtensionContext, summary: string | null): void {
	if (!snapshot) return;
	uiRef = ctx.ui;
	state.setBug(summary); // persists + syncSnapshot repaints
}

/**
 * `/debugger bug edit` / `/debugger bug <text>` — set the bug summary directly,
 * or (`edit`) edit it via a prompt. `ui.input` has no prefill, so the current
 * bug is shown as placeholder hint text. The override is single-line;
 * multi-line summaries come via report_bug. Bare `/debugger bug` opens the
 * read-only viewer (openTextOverlay).
 */
async function editBug(ctx: ExtensionContext, text: string): Promise<void> {
	if (!snapshot) {
		ctx.ui.notify("No active debug session.", "info");
		return;
	}
	const direct = text.trim();
	const summary =
		direct.length > 0 ? direct : await ctx.ui.input("Edit bug summary", snapshot.bug ?? "Describe the bug…");
	if (summary === undefined) return; // user cancelled
	applyBug(ctx, summary);
	ctx.ui.notify(state.getState()?.bug ? "Bug summary updated." : "Bug summary cleared.", "info");
}

/** Open the scrollable telemetry overlay. No-op-with-notify if no session. */
function openLogOverlay(ctx: ExtensionContext): void {
	if (!snapshot || !serverHandle) {
		ctx.ui.notify("No active debug session. Start one with /debugger.", "info");
		return;
	}
	uiRef = ctx.ui;
	void ctx.ui.custom(
		(tui, theme, _kb, done) => {
			const overlay = new LogStreamOverlay(packets, tui, theme, () => {
				activeOverlay = null;
				done(undefined);
			});
			activeOverlay = overlay;
			return overlay;
		},
		{
			overlay: true,
			overlayOptions: {
				width: "80%",
				maxHeight: "90%",
				anchor: "center",
				margin: { top: 1 },
			},
		},
	);
}

/**
 * Open a read-only scrollable overlay showing full text (bug / hypothesis).
 * No-op-with-notify if no session. Content is a static snapshot at open time.
 */
function openTextOverlay(ctx: ExtensionContext, title: string, text: string | null, emptyMsg: string): void {
	if (!snapshot) {
		ctx.ui.notify("No active debug session. Start one with /debugger.", "info");
		return;
	}
	uiRef = ctx.ui;
	void ctx.ui.custom(
		(tui, theme, _kb, done) => {
			const content = text !== null ? text.split("\n") : [theme.fg("dim", emptyMsg)];
			const overlay = new TextOverlay(title, content, tui, theme, () => {
				activeTextOverlay = null;
				done(undefined);
			});
			activeTextOverlay = overlay;
			return overlay;
		},
		{
			overlay: true,
			overlayOptions: {
				width: "80%",
				maxHeight: "90%",
				anchor: "center",
				margin: { top: 1 },
			},
		},
	);
}
