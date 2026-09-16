/**
 * Subagents Check Extension
 *
 * AGENTS.md routes subagent work through the `Agent` tool, which comes from the
 * `pi-subagents-lite` package. If that package isn't installed or failed to
 * load, the tool silently disappears and subagent routing breaks. This
 * extension detects that and warns the user with the fix.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const INSTALL_HINT =
	"Install/repair it with: pi install npm:pi-subagents-lite, then restart pi.";

export default function (pi: ExtensionAPI) {
	let toastShown = false;

	pi.on("before_agent_start", (event, ctx) => {
		const activeTools = event.systemPromptOptions?.selectedTools ?? [];
		if (activeTools.includes("Agent")) return;

		// One-time visible toast (interactive mode only).
		if (!toastShown) {
			toastShown = true;
			ctx.ui.notify(
				`pi-subagents-lite is not loaded, so the Agent tool (AGENTS.md subagent routing) is unavailable. ${INSTALL_HINT}`,
				"warning",
			);
		}

		// Also tell the model, so headless/print sessions surface the problem too.
		return {
			systemPrompt: `${event.systemPrompt}\n\nNOTE: The Agent tool is unavailable because the pi-subagents-lite package is not loaded. Do not attempt to spawn subagents. If subagents would help for this task, tell the user: ${INSTALL_HINT}`,
		};
	});
}
