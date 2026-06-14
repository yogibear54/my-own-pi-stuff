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

	pi.registerTool({
		name: "debug_fix",
		label: "Debug: Fix",
		description:
			"Record a fix applied for a confirmed hypothesis. " +
			"The actual code edit is done via the edit tool — this tracks the fix separately from instrumentation.",
		parameters: Type.Object({
			hypothesisId: Type.Number({ description: "The hypothesis ID this fix addresses" }),
			description: Type.String({ description: "What the fix does and why" }),
			files: Type.Array(
				Type.Object({
					path: Type.String({ description: "File that was modified" }),
					changes: Type.String({ description: "Description of the changes made" }),
				}),
			),
		}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			// TODO: implement (TODO-8f058f8a)
			return {
				content: [{ type: "text", text: "debug_fix not yet implemented" }],
				details: {},
			};
		},
	});

	pi.registerTool({
		name: "debug_cleanup",
		label: "Debug: Cleanup",
		description:
			"Remove all injected instrumentation from the codebase, keeping only verified fixes. " +
			"Call when the bug is confirmed fixed. Shuts down the log collector.",
		parameters: Type.Object({
			sessionId: Type.Optional(Type.String({ description: "Session to clean up (defaults to active)" })),
		}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			// TODO: implement (TODO-7953f604)
			return {
				content: [{ type: "text", text: "debug_cleanup not yet implemented" }],
				details: {},
			};
		},
	});

	pi.registerTool({
		name: "debug_status",
		label: "Debug: Status",
		description: "Return the current debug session state: phase, iteration, hypotheses, files modified, log count.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			const session = store.getActive();
			if (!session) {
				return {
					content: [{ type: "text", text: "No active debug session." }],
					details: {},
				};
			}
			return {
				content: [{ type: "text", text: `Active session: ${session.id} (status tool not yet fully implemented)` }],
				details: {},
			};
		},
	});

	// ── Commands (User-facing) ───────────────────────────────────────────────

	pi.registerCommand("debug start", {
		description: "Start a debug session. Sets up log collector and session state.",
		handler: async (_args, ctx) => {
			// TODO: implement fully (TODO-415787ba)
			if (store.getActive()) {
				const active = store.getActive()!;
				ctx.ui.notify(
					`A debug session is already active (${active.id}). Run /debug cleanup or /debug abort first.`,
					"warning",
				);
				return;
			}
			ctx.ui.notify("🐛 Debug session start not yet implemented", "info");
		},
	});

	pi.registerCommand("debug status", {
		description: "Display current debug session state.",
		handler: async (_args, ctx) => {
			// TODO: implement (TODO-b0b2561d)
			ctx.ui.notify("No active debug session.", "info");
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
			// TODO: implement (TODO-5a3274e7)
			ctx.ui.notify("No active debug session.", "info");
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
