/**
 * Pi AI Debugger — entry point.
 *
 * First slice: wires the `/debugger` slash command to
 *   • a red "debug" indicator in the footer (like plan-mode), and
 *   • the instrumentation widget above the editor (see widget.ts).
 *
 * `/debugger`        — start a local debug session (AWAITING CONTEXT).
 * `/debugger stop`   — stop the session: clears the footer indicator and widget.
 *
 * Note: pi reserves the built-in `/debug` command (screen-capture log), and the
 * TUI intercepts it before extension commands run, so this extension uses
 * `/debugger` instead. See docs/02-slash-commands.md.
 *
 * The HTTP log server, snippet injection tools, and the full debugging loop
 * arrive in later parts (docs/01..05).
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { initialSnapshot, renderDebugWidget, type DebugSnapshot } from "./widget.ts";

const WIDGET_KEY = "debugger";
const STATUS_KEY = "debug";

/** Active session snapshot, or null when no session is running. */
let snapshot: DebugSnapshot | null = null;

export default function debuggerExtension(pi: ExtensionAPI): void {
	pi.registerCommand("debugger", {
		description: "Start a debug session (/debugger, /debugger remote, /debugger stop)",
		handler: async (args, ctx) => {
			const arg = (args ?? "").trim();
			if (arg === "stop") {
				stopDebug(ctx);
				return;
			}
			// `remote` mode and its ngrok tunnel land in Part 2; for now any
			// non-`stop` invocation starts a local session.
			startDebug(ctx);
		},
	});
}

/** Re-render the widget from the current snapshot. No-op if no session. */
function paint(ctx: ExtensionContext): void {
	if (!snapshot) return;
	ctx.ui.setWidget(WIDGET_KEY, renderDebugWidget(snapshot, ctx.ui.theme));
}

function startDebug(ctx: ExtensionContext): void {
	snapshot = initialSnapshot();

	// Footer indicator — red "debug".
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("error", ctx.ui.theme.bold("debug")));

	// Instrumentation widget above the editor.
	paint(ctx);

	ctx.ui.notify("Debug session started. Describe the bug to begin.", "info");
}

function stopDebug(ctx: ExtensionContext): void {
	if (!snapshot) {
		ctx.ui.notify("No active debug session.", "info");
		return;
	}
	snapshot = null;
	ctx.ui.setStatus(STATUS_KEY, undefined);
	ctx.ui.setWidget(WIDGET_KEY, undefined);
	ctx.ui.notify("Debug session stopped.", "info");
}
