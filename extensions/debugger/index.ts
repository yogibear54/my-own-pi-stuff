/**
 * Pi AI Debugger — entry point.
 *
 * Wires the `/debugger` slash command to
 *   • a red "debug" indicator in the footer (like plan-mode), and
 *   • the instrumentation widget above the editor (see widget.ts).
 *   • the HTTP log server (server.ts) whose packets stream into the widget tail
 *     and a scrollable overlay (logstream.ts, opened via `/debugger logs`).
 *
 *   `/debugger`        — start a local debug session (AWAITING CONTEXT) + open the
 *                       live log overlay.
 *   `/debugger logs`   — open the scrollable telemetry overlay.
 *   `/debugger stop`   — stop the session: server, overlay, footer, widget.
 *
 * Note: pi reserves the built-in `/debug` command (screen-capture log), and the
 * TUI intercepts it before extension commands run, so this extension uses
 * `/debugger` instead. See docs/02-slash-commands.md.
 *
 * Snippet injection and the full debugging loop arrive in later parts (docs/04..05).
 */
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { rmSync } from "node:fs";

import { startLogServer, type LogServerHandle, type TelemetryPacket } from "./server.ts";
import { LogStreamOverlay } from "./logstream.ts";
import { formatPacketCompact, initialSnapshot, renderDebugWidget, TAIL_LIMIT, type DebugSnapshot } from "./widget.ts";

const WIDGET_KEY = "debugger";
const STATUS_KEY = "debug";

/** Active session snapshot, or null when no session is running. */
let snapshot: DebugSnapshot | null = null;
/** UI context captured on session_start for out-of-command repaints (onPacket). */
let uiRef: ExtensionUIContext | null = null;
/** Running log server handle, or null when stopped. */
let serverHandle: LogServerHandle | null = null;
/** Session packet history (shared by reference with the overlay). */
const packets: TelemetryPacket[] = [];
/** Open scroll overlay, or null when closed. */
let activeOverlay: LogStreamOverlay | null = null;

export default function debuggerExtension(pi: ExtensionAPI): void {
	// Stash the UI context so onPacket (which fires outside any command) can repaint.
	pi.on("session_start", (_event, ctx) => {
		uiRef = ctx.ui;
	});

	// Ensure the server never outlives the session (reload/new/resume/quit).
	pi.on("session_shutdown", () => {
		if (serverHandle) {
			serverHandle.close();
			serverHandle = null;
		}
	});

	pi.registerCommand("debugger", {
		description: "Start a debug session (/debugger, /debugger logs, /debugger stop)",
		handler: async (args, ctx) => {
			const arg = (args ?? "").trim();
			if (arg === "stop") {
				stopDebug(ctx);
				return;
			}
			if (arg === "logs") {
				openLogOverlay(ctx);
				return;
			}
			// `remote` mode and its ngrok tunnel land in Part 2; for now any other
			// invocation starts a local session.
			await startDebug(ctx);
		},
	});
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
		snapshot.logLines = packets.slice(-TAIL_LIMIT).map((p) => formatPacketCompact(p, uiRef!.theme));
		paintUi(uiRef);
	}
	if (activeOverlay) activeOverlay.refresh();
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

	try {
		serverHandle = await startLogServer({ cwd: ctx.cwd });
	} catch (e) {
		snapshot = null;
		ctx.ui.notify(`Failed to start log server: ${(e as Error).message}`, "error");
		return;
	}
	snapshot.port = serverHandle.port;
	snapshot.telemetryTarget = serverHandle.telemetryTarget;
	serverHandle.onPacket((packet) => onPacket(packet));

	// Footer indicator — red "debug".
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", ctx.ui.theme.bold("debug")));
	// Instrumentation widget above the editor.
	paintUi(ctx.ui);

	ctx.ui.notify(`Debug session started on ${serverHandle.telemetryTarget}.`, "info");

	// Auto-open the live scroll overlay (per requirements; fire-and-forget so the
	// command handler returns promptly). It grabs focus until closed with q/Esc.
	openLogOverlay(ctx);
}

function stopDebug(ctx: ExtensionContext): void {
	if (!snapshot) {
		ctx.ui.notify("No active debug session.", "info");
		return;
	}
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
	snapshot = null;
	ctx.ui.setStatus(STATUS_KEY, undefined);
	ctx.ui.setWidget(WIDGET_KEY, undefined);
	ctx.ui.notify("Debug session stopped.", "info");
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
