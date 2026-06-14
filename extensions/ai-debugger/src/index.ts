/**
 * AI Debugger Extension for pi
 *
 * Hypothesis-driven debugging: hypothesize → instrument → observe → fix → verify → cleanup.
 *
 * Phase A (MVP): JS/TS only, core loop.
 * See REQUIREMENTS.md in the project root for full specification.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
import { performStart, buildStartMessage, buildStartWidget } from "./commands/start.js";
import { buildStatusNotification } from "./commands/status.js";

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
				const session = store.getActive()!;
				ctx.ui.setWidget("ai-debugger", buildStartWidget(session));
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
			// TODO: implement (TODO-e2a2d95d)
			ctx.ui.notify("No active debug session.", "info");
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
			try {
				const summary = await performCleanup(
					{ store, collector, cwd: process.cwd() },
				);
				ctx.ui.notify(
					`🐛 Cleanup complete: ${summary.files.filter((f) => f.cleaned).length} file(s) cleaned, ${summary.totalBlocksRemoved} block(s) removed.`,
					"info",
				);
			} catch (err) {
				ctx.ui.notify(`Cleanup failed: ${err instanceof Error ? err.message : String(err)}`, "error");
			}
		},
	});

	pi.registerCommand("debug abort", {
		description: "Abort debug session and revert all changes (instrumentation + fixes).",
		handler: async (_args, ctx) => {
			// TODO: implement (TODO-7767f846)
			ctx.ui.notify("No active debug session.", "info");
		},
	});

	pi.registerCommand("debug history", {
		description: "List past debug sessions and their outcomes.",
		handler: async (_args, ctx) => {
			// TODO: implement (TODO-3a231913)
			ctx.ui.notify("No debug sessions found.", "info");
		},
	});

	// ── Lifecycle ────────────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		// Restore active session from disk if present
		const result = onSessionStart(lifecycleDeps);
		if (result.notification) {
			ctx.ui.notify(result.notification.message, result.notification.level);
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
