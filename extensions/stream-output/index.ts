/**
 * Stream Output Extension
 *
 * Adds --stream flag that outputs thinking and text content with formatting:
 * - Both thinking and text go to stderr
 * - [thinking] prefix in gray
 * - [text] prefix in cyan
 * - Prefixes only appear at the start of each content block
 *
 * Usage: pi -p --stream=on "your prompt"
 *
 * Example:
 *   pi -p --stream=on "write me a poem"            # all output to stderr
 *   pi -p --stream=on "write me a poem" 2>/dev/null    # suppress all
 *   pi -p --stream=on "write me a poem" 1>/dev/null    # text only (from stderr)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ANSI color codes
const colors = {
	gray: "\x1b[90m",
	cyan: "\x1b[36m",
	reset: "\x1b[0m",
};

export default function streamOutputExtension(pi: ExtensionAPI): void {
	pi.registerFlag("stream", {
		description: "Stream thinking and text output to stderr",
		type: "string",
		default: "off",
	});

	let inThinkingBlock = false;
	let inTextBlock = false;
	let streamedText = "";
	let textLines = 0;

	pi.on("message_update", async (event) => {
		if (pi.getFlag("stream") !== "on") return;

		const assistantEvent = event.assistantMessageEvent;
		if (!assistantEvent) return;

		if (assistantEvent.type === "thinking_start") {
			inThinkingBlock = true;
			process.stderr.write(`${colors.gray}[thinking] `);
		} else if (assistantEvent.type === "thinking_delta") {
			if (inThinkingBlock) {
				process.stderr.write(assistantEvent.delta);
			}
		} else if (assistantEvent.type === "thinking_end") {
			inThinkingBlock = false;
			process.stderr.write(`${colors.reset}\n\n`);
		} else if (assistantEvent.type === "text_start") {
			inTextBlock = true;
			streamedText = "";
			textLines = 1;
			process.stderr.write(`${colors.cyan}[text] `);
		} else if (assistantEvent.type === "text_delta") {
			if (inTextBlock) {
				process.stderr.write(assistantEvent.delta);
				streamedText += assistantEvent.delta;
				textLines += (assistantEvent.delta.match(/\n/g) || []).length;
			}
		} else if (assistantEvent.type === "text_end") {
			inTextBlock = false;
			process.stderr.write(`${colors.reset}\n\n`);
		}
	});

	pi.on("agent_end", async () => {
		if (pi.getFlag("stream") !== "on") return;
		if (textLines <= 0) return;

		// In a real terminal, these ANSI codes would clear the duplicate output
		// Move cursor up N lines, then clear from cursor to end of screen
		process.stdout.write(`\x1b[${textLines}A\x1b[0J`);
	});
}
