/**
 * Stream Output Extension
 *
 * Adds --stream flag that outputs thinking and text content with formatting:
 * - Both thinking and text go to stderr
 * - [thinking] prefix in gray
 * - [text] prefix in cyan
 * - [tool] prefix in yellow (shows tool name, args, and results)
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
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	reset: "\x1b[0m",
};

// Truncate tool args/result for readable output
function truncate(val: unknown, maxLen = 300): string {
	const s = typeof val === "string" ? val : JSON.stringify(val, null, 2);
	if (s.length <= maxLen) return s;
	return s.slice(0, maxLen) + "…";
}

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

	// Stream tool use messages
	pi.on("tool_execution_start", async (event) => {
		if (pi.getFlag("stream") !== "on") return;
		process.stderr.write(
			`${colors.yellow}[tool] ${event.toolName}(${truncate(event.args)})${colors.reset}\n`,
		);
	});

	pi.on("tool_execution_update", async (event) => {
		if (pi.getFlag("stream") !== "on") return;
		if (event.partialResult) {
			process.stderr.write(
				`${colors.yellow}[tool] ${event.toolName} → ${truncate(event.partialResult)}${colors.reset}\n`,
			);
		}
	});

	pi.on("tool_execution_end", async (event) => {
		if (pi.getFlag("stream") !== "on") return;
		const label = event.isError ? `${colors.red}[tool] ${event.toolName} ✗` : `${colors.yellow}[tool] ${event.toolName} ✓`;
		process.stderr.write(`${label} ${truncate(event.result)}${colors.reset}\n\n`);
	});

	pi.on("agent_end", async () => {
		if (pi.getFlag("stream") !== "on") return;
		if (textLines <= 0) return;

		// In a real terminal, these ANSI codes would clear the duplicate output
		// Move cursor up N lines, then clear from cursor to end of screen
		process.stdout.write(`\x1b[${textLines}A\x1b[0J`);
	});
}
