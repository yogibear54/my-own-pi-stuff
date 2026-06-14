/**
 * AI Debugger Extension for pi
 *
 * Hypothesis-driven debugging: hypothesize → instrument → observe → fix → verify → cleanup.
 *
 * Phase A (MVP): JS/TS only, core loop.
 * See REQUIREMENTS.md in the project root for full specification.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { SessionStore } from "./session-store.js";
import { loadConfig } from "./config.js";
import type { DebugConfig } from "./config.js";
import { LogCollector } from "./log-collector.js";
import { detectProfiles } from "./language-profiles/index.js";
import type { LanguageProfile } from "./language-profiles/index.js";
import {
	onSessionStart,
	onSessionShutdown,
	onBeforeAgentStart,
} from "./lifecycle.js";
import { createHypothesizeTool } from "./tools/hypothesize.js";
import { createInstrumentTool } from "./tools/instrument.js";
import { createLogsTool } from "./tools/logs.js";
import { createFixTool } from "./tools/fix.js";
import { createCleanupTool, performCleanup } from "./tools/cleanup.js";
import { createStatusTool } from "./tools/status.js";
import { performStart, buildStartMessage } from "./commands/start.js";
import { buildStatusNotification } from "./commands/status.js";
import { buildLogsNotification, RECENT_LOG_COUNT } from "./commands/logs.js";
import {
	buildCleanupConfirmationTitle,
	buildCleanupConfirmationMessage,
	buildCleanupNotification,
} from "./commands/cleanup.js";
import {
	buildAbortConfirmationTitle,
	buildAbortConfirmationMessage,
	buildAbortNotification,
	performAbort,
} from "./commands/abort.js";
import { buildHistoryNotification } from "./commands/history.js";
import { DebugWidgetManager } from "./widget.js";
import type { CompletionSummary } from "./widget.js";

export default function (pi: ExtensionAPI) {
	// ── State ───────────────────────────────────────────────────────────────

	const store = new SessionStore(process.cwd());
	const config: DebugConfig = loadConfig(process.cwd());
	const collector = new LogCollector(process.cwd(), config.maxLogEntries);
	const profiles: LanguageProfile[] = detectProfiles(process.cwd());
	const lifecycleDeps = {
		store,
		collector,
		showDebugContextMessage: config.showDebugContextMessage,
	};

	// ── Widget ─────────────────────────────────────────────────────────────

	const widgetManager = new DebugWidgetManager();
	let widgetUI: ExtensionContext["ui"] | null = null;
	const SUMMARY_DISPLAY_MS = 5000;

	/** Render the widget from the manager's current state, applying theme colors. */
	function renderWidget(): void {
		if (!widgetUI) return;
		const lines = widgetManager.getLines();
		if (lines.length === 0) {
			widgetUI.setWidget("ai-debugger", undefined);
			return;
		}
		const colored = lines.map((line) =>
			line.color ? widgetUI!.theme.fg(line.color, line.text) : line.text,
		);
		widgetUI.setWidget("ai-debugger", colored);
	}

	/** Show a completion summary, then clear the widget after 5 seconds. */
	function showCompletionSummary(summary: CompletionSummary, ctx: ExtensionContext): void {
		widgetUI = ctx.ui;
		widgetManager.showSummary(summary);
		renderWidget();
		setTimeout(() => {
			widgetManager.clear();
			renderWidget();
		}, SUMMARY_DISPLAY_MS);
	}

	/** Live-update the widget when logs arrive at the collector. */
	collector.on("log", (entry) => {
		const session = store.getActive();
		if (session && entry.session === session.id) {
			store.incrementLogCount(session.id);
			widgetManager.updateSession(store.getActive()!);
			widgetManager.onLog(entry);
			renderWidget();
		}
	});

	// ── Custom Tools (LLM-callable) ──────────────────────────────────────────

	pi.registerTool(
		createHypothesizeTool({
			store,
			collector,
			config,
		}),
	);

	pi.registerTool(
		createInstrumentTool({
			store,
			collector,
			config,
			cwd: process.cwd(),
		}),
	);

	pi.registerTool(
		createLogsTool({
			store,
			collector,
		}),
	);

	pi.registerTool(
		createFixTool({
			store,
		}),
	);

	pi.registerTool(
		createCleanupTool({
			store,
			collector,
			cwd: process.cwd(),
		}),
	);

	pi.registerTool(
		createStatusTool({
			store,
		}),
	);

	// ── Commands (User-facing) ───────────────────────────────────────────────

	pi.registerCommand("debug start", {
		description: "Start a debug session. Sets up log collector and session state.",
		handler: async (args, ctx) => {
			try {
				const summary = await performStart(
					{ store, collector, config, cwd: process.cwd() },
					(args ?? "").trim(),
				);
				ctx.ui.notify(buildStartMessage(summary), "info");
				widgetUI = ctx.ui;
				widgetManager.attach(store.getActive()!);
				renderWidget();
			} catch (err) {
				ctx.ui.notify(
					`${err instanceof Error ? err.message : String(err)}`,
					"warning",
				);
			}
		},
	});

	pi.registerCommand("debug status", {
		description: "Display current debug session state.",
		handler: async (_args, ctx) => {
			const session = store.getActive();
			if (!session) {
				ctx.ui.notify("No active debug session.", "info");
				return;
			}
			ctx.ui.notify(buildStatusNotification(session), "info");
		},
	});

	pi.registerCommand("debug logs", {
		description: "View collected debug logs.",
		handler: async (_args, ctx) => {
			const session = store.getActive();
			if (!session) {
				ctx.ui.notify("No active debug session.", "info");
				return;
			}
			const recent = collector.getRecent(session.id, RECENT_LOG_COUNT);
			const total = collector.getRecent(session.id, Infinity).length;
			ctx.ui.notify(buildLogsNotification(session.id, recent, total), "info");
		},
	});

	pi.registerCommand("debug cleanup", {
		description: "Remove all instrumentation from the codebase, keeping fixes.",
		handler: async (_args, ctx) => {
			const session = store.getActive();
			if (!session) {
				ctx.ui.notify("No active debug session to clean up.", "info");
				return;
			}
			const confirmed = await ctx.ui.confirm(
				buildCleanupConfirmationTitle(session.id),
				buildCleanupConfirmationMessage(),
			);
			if (!confirmed) return;
			try {
				const summary = await performCleanup(
					{ store, collector, cwd: process.cwd() },
				);
				ctx.ui.notify(buildCleanupNotification(summary), "info");
				showCompletionSummary({
					sessionId: summary.sessionId,
					status: "completed",
					filesCleaned: summary.files.filter((f) => f.cleaned).length,
					logsCollected: summary.logsCollected,
					fixCount: summary.fixCount,
				}, ctx);
			} catch (err) {
				ctx.ui.notify(`Cleanup failed: ${err instanceof Error ? err.message : String(err)}`, "error");
			}
		},
	});

	pi.registerCommand("debug abort", {
		description: "Abort debug session and revert all changes (instrumentation + fixes).",
		handler: async (_args, ctx) => {
			const session = store.getActive();
			if (!session) {
				ctx.ui.notify("No active debug session to abort.", "info");
				return;
			}
			const confirmed = await ctx.ui.confirm(
				buildAbortConfirmationTitle(session.id),
				buildAbortConfirmationMessage(),
			);
			if (!confirmed) return;
			try {
				const abortLogCount = session.logCount;
				const abortFixCount = session.fixes.length;
				const summary = await performAbort(
					{ store, collector, cwd: process.cwd() },
				);
				ctx.ui.notify(buildAbortNotification(summary), "info");
				showCompletionSummary({
					sessionId: session.id,
					status: "aborted",
					filesCleaned: summary.revertedCount,
					logsCollected: abortLogCount,
					fixCount: abortFixCount,
				}, ctx);
			} catch (err) {
				ctx.ui.notify(`Abort failed: ${err instanceof Error ? err.message : String(err)}`, "error");
			}
		},
	});

	pi.registerCommand("debug history", {
		description: "List past debug sessions and their outcomes.",
		handler: async (_args, ctx) => {
			ctx.ui.notify(buildHistoryNotification(store.list()), "info");
		},
	});

	// ── Lifecycle ────────────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		widgetUI = ctx.ui;
		// Restore active session from disk if present
		const result = onSessionStart(lifecycleDeps);
		if (result.notification) {
			ctx.ui.notify(result.notification.message, result.notification.level);
		}
		// Attach widget if a session was restored
		const restored = store.getActive();
		if (restored) {
			widgetManager.attach(restored);
			renderWidget();
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const result = await onSessionShutdown(lifecycleDeps);
		if (result.notification) {
			ctx.ui.notify(result.notification.message, result.notification.level);
		}
	});

	pi.on("before_agent_start", async () => {
		// Inject debug-state context so the LLM knows it's in a debug session
		return onBeforeAgentStart(lifecycleDeps);
	});
}
