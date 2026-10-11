/**
 * Stream Output Extension
 *
 * Adds --stream flag that outputs thinking, text, status, and tool content with formatting:
 * - Stream output defaults to stderr, with opt-in stdout or file targets
 * - [thinking] prefix in gray
 * - [text] prefix in cyan
 * - [tool] prefix in yellow (shows tool name, args, and results)
 * - Prefixes only appear at the start of each content block
 *
 * Usage: pi -p --stream=<value> "your prompt"
 *
 * Values (comma-separated):
 *   message   - Stream LLM response text
 *   thinking  - Stream LLM thinking text
 *   tools     - Stream tool calls and results
 *   status    - Stream non-sensitive liveness events and counts
 *   all       - Stream everything (shorthand for message,thinking,tools)
 *   on/true   - Stream message text (safe shorthand)
 *
 * Examples:
 *   pi -p --stream=all "write me a poem"                         # all output to stderr
 *   pi -p --stream=message,thinking "explain recursion"          # text + thinking
 *   pi -p --stream=status "review this code"                     # liveness only, no text/thinking
 *   pi -p --stream=message,status "review this code"             # text + progress counts
 *   pi -p --stream=tools "write me a poem"                      # tool calls only
 *   pi -p --stream=all "write me a poem" 2>/dev/null             # suppress all
 *   pi -p --stream=all "write me a poem" 1>/dev/null             # text only (from stderr)
 *   pi -p --stream=status --stream-output=file --stream-file=/tmp/pi-progress.log "review"
 *   pi -p --stream=message --stream-output=stdout "terminal-only streaming"
 *   pi -p --stream=message --stream-no-ansi=true "plain log output"
 */

import { closeSync, openSync, writeSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ANSI color codes
const colors = {
	gray: "\x1b[90m",
	cyan: "\x1b[36m",
	yellow: "\x1b[33m",
	green: "\x1b[32m",
	red: "\x1b[31m",
	reset: "\x1b[0m",
};

const emptyColors = {
	gray: "",
	cyan: "",
	yellow: "",
	green: "",
	red: "",
	reset: "",
};

const STATUS_INTERVAL_MS = 5000;
const STATUS_DELTA_CHARS = 1000;
type StreamOutputTarget = "stderr" | "stdout" | "file";

// ── Helpers for parsing tool args/results ──────────────────────────────

// Safely parse args that may be a stringified JSON object or already an object
function parseArgs(args: unknown): Record<string, unknown> | null {
	if (!args) return null;
	if (typeof args === "string") {
		try {
			const parsed = JSON.parse(args);
			if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>;
		} catch { /* not JSON */ }
		return null;
	}
	if (typeof args === "object") return args as Record<string, unknown>;
	return null;
}

// Extract the actual text from a content array like [{type: "text", text: "..."}]
function extractText(result: unknown): string | null {
	if (!result) return null;

	let obj: unknown = result;
	if (typeof result === "string") {
		try { obj = JSON.parse(result); } catch { return result; }
	}

	if (typeof obj === "object" && obj !== null) {
		const rec = obj as Record<string, unknown>;
		if (Array.isArray(rec.content)) {
			const texts = rec.content
				.filter((item: any) => typeof item === "object" && item.type === "text" && typeof item.text === "string")
				.map((item: any) => item.text as string);
			if (texts.length > 0) return texts.join("\n");
		}
	}
	return null;
}

// Format tool-specific concise args display
function formatToolArgs(toolName: string, args: unknown): string {
	const obj = parseArgs(args);
	if (!obj) return String(args ?? "");

	switch (toolName) {
		case "bash":
			return obj.command ? `$ ${obj.command}` : formatGeneric(obj);
		case "read": {
			let s = `${obj.path ?? "?"}`;
			if (obj.offset) s += `:${obj.offset}${obj.limit ? `-${Number(obj.offset) + Number(obj.limit)}` : "+"}`;
			return s;
		}
		case "edit": {
			const count = Array.isArray(obj.edits) ? obj.edits.length : 0;
			return `${obj.path ?? "?"} (${count} edit${count !== 1 ? "s" : ""})`;
		}
		case "write":
			return `${obj.path ?? "?"} (${formatBytes(String(obj.content ?? "").length)})`;
		default:
			return formatGeneric(obj);
	}
}

// Format tool-specific result display
function formatToolResult(toolName: string, result: unknown, maxLen = 1500): string {
	// Try extracting text from content array first
	const text = extractText(result);
	if (text !== null) {
		if (text.length === 0) return "(empty)";
		return truncateLines(text, maxLen);
	}

	// Fallback: generic formatting
	return formatGenericObj(result, maxLen);
}

// ── Formatting utilities ───────────────────────────────────────────────

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	return `${(bytes / 1024).toFixed(1)}KB`;
}

function formatGeneric(obj: Record<string, unknown>): string {
	return Object.entries(obj)
		.filter(([k]) => k !== "content")
		.map(([k, v]) => {
			const s = typeof v === "string" ? v : JSON.stringify(v);
			return `${k}: ${s.length > 80 ? s.slice(0, 80) + "…" : s}`;
		})
		.join(", ");
}

function formatGenericObj(val: unknown, maxLen = 500): string {
	let s: string;
	if (typeof val === "string") {
		try {
			const parsed = JSON.parse(val);
			if (typeof parsed === "object" && parsed !== null) {
				s = JSON.stringify(parsed, null, 2);
			} else {
				s = val;
			}
		} catch { s = val; }
	} else if (typeof val === "object" && val !== null) {
		s = JSON.stringify(val, null, 2);
	} else {
		s = String(val);
	}
	if (s.length > maxLen) s = s.slice(0, maxLen) + "…";
	return s;
}

function truncateLines(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	const lines = text.split("\n");
	let result = "";
	let i = 0;
	for (; i < lines.length; i++) {
		const next = result + (i > 0 ? "\n" : "") + lines[i];
		if (next.length > maxLen) break;
		result = next;
	}
	if (i < lines.length) {
		const remaining = lines.length - i;
		result += `\n… (${remaining} more line${remaining !== 1 ? "s" : ""})`;
	}
	return result;
}

// Indent multiline content with hanging padding
function indentContent(text: string, indent: number): string {
	const padding = " ".repeat(indent);
	return text
		.split("\n")
		.map((line, i) => (i === 0 ? line : padding + line))
		.join("\n");
}

export default function streamOutputExtension(pi: ExtensionAPI): void {
	pi.registerFlag("stream", {
		description: "Stream output. Comma-separated values: message, thinking, tools, status, all",
		type: "string",
		default: "off",
	});
	pi.registerFlag("stream-no-ansi", {
		description: "Disable ANSI colors and terminal cleanup for --stream output",
		type: "boolean",
		default: false,
	});
	pi.registerFlag("stream-output", {
		description: "Where to write streamed output: stderr, stdout, or file",
		type: "string",
		default: "stderr",
	});
	pi.registerFlag("stream-file", {
		description: "Path to append streamed output when --stream-output=file",
		type: "string",
		default: "",
	});

	type StreamOption = "message" | "thinking" | "tools" | "status";

	let warnedInvalidStreamFlag = "";
	let warnedInvalidOutputFlag = "";
	let warnedMissingStreamFile = false;
	let warnedFileWriteError = "";
	let outputFileFd: number | undefined;
	let outputFilePath = "";

	function writeStderr(text: string): void {
		writeSync(2, text);
	}

	function getStreamOutputTarget(): StreamOutputTarget {
		const raw = String(pi.getFlag("stream-output") || "stderr").trim().toLowerCase();
		if (raw === "stderr" || raw === "stdout" || raw === "file") return raw;
		if (warnedInvalidOutputFlag !== raw) {
			warnedInvalidOutputFlag = raw;
			writeStderr(`[stream-output] unknown --stream-output value "${raw}", using stderr\n`);
		}
		return "stderr";
	}

	function getStreamFilePath(): string {
		const value = pi.getFlag("stream-file");
		return typeof value === "string" ? value.trim() : "";
	}

	function closeOutputFile(): void {
		if (outputFileFd === undefined) return;
		const fd = outputFileFd;
		outputFileFd = undefined;
		outputFilePath = "";
		closeSync(fd);
	}

	function getOutputFileFd(path: string): number | undefined {
		if (outputFileFd !== undefined && outputFilePath === path) return outputFileFd;
		closeOutputFile();
		try {
			outputFileFd = openSync(path, "a");
			outputFilePath = path;
			warnedFileWriteError = "";
			return outputFileFd;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const key = `${path}:${message}`;
			if (warnedFileWriteError !== key) {
				warnedFileWriteError = key;
				writeStderr(`[stream-output] could not open --stream-file "${path}": ${message}; using stderr\n`);
			}
			return undefined;
		}
	}

	function writeOutput(text: string): void {
		const target = getStreamOutputTarget();
		if (target === "stdout") {
			// Pi print/json modes guard process.stdout.write; raw fd writes make
			// stdout opt-in explicit and predictable.
			writeSync(1, text);
			return;
		}
		if (target === "file") {
			const path = getStreamFilePath();
			if (!path) {
				if (!warnedMissingStreamFile) {
					warnedMissingStreamFile = true;
					writeStderr("[stream-output] --stream-output=file requires --stream-file=<path>; using stderr\n");
				}
				writeStderr(text);
				return;
			}
			const fd = getOutputFileFd(path);
			if (fd === undefined) {
				writeStderr(text);
				return;
			}
			writeSync(fd, text);
			return;
		}
		writeStderr(text);
	}

	function useAnsi(): boolean {
		if (pi.getFlag("stream-no-ansi") === true) return false;
		const target = getStreamOutputTarget();
		if (target === "stderr") return process.stderr.isTTY === true;
		if (target === "stdout") return process.stdout.isTTY === true;
		return false;
	}

	function palette(): typeof colors {
		return useAnsi() ? colors : emptyColors;
	}

	function timestamp(): string {
		return new Date().toISOString();
	}

	function writeStatus(message: string): void {
		const c = palette();
		writeOutput(`${c.green}[status] ${timestamp()} ${message}${c.reset}\n`);
	}

	function maybeWarnInvalidStreamValues(invalid: string[], flag: string): void {
		if (invalid.length === 0 || warnedInvalidStreamFlag === flag) return;
		warnedInvalidStreamFlag = flag;
		const c = palette();
		writeOutput(
			`${c.yellow}[stream-output] ignoring unknown --stream value${invalid.length === 1 ? "" : "s"}: ${invalid.join(", ")}${c.reset}\n`,
		);
	}

	function getStreamOptions(): Set<StreamOption> {
		const flag = pi.getFlag("stream");
		if (!flag || flag === "off" || flag === false) return new Set();

		const rawFlag = String(flag);
		const parts = rawFlag.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
		const valid: StreamOption[] = ["message", "thinking", "tools", "status"];
		const opts = new Set<StreamOption>();
		const invalid: string[] = [];

		for (const part of parts) {
			if (part === "all") {
				opts.add("message");
				opts.add("thinking");
				opts.add("tools");
			} else if (part === "on" || part === "true") {
				opts.add("message");
			} else if (valid.includes(part as StreamOption)) {
				opts.add(part as StreamOption);
			} else {
				invalid.push(part);
			}
		}

		maybeWarnInvalidStreamValues(invalid, rawFlag);
		return opts;
	}

	let inThinkingBlock = false;
	let inTextBlock = false;
	let textLines = 0;
	let textChars = 0;
	let thinkingChars = 0;
	let lastStatusAt = 0;
	let lastStatusTextChars = 0;
	let lastStatusThinkingChars = 0;

	function maybeWriteCountStatus(kind: "message" | "thinking"): void {
		const opts = getStreamOptions();
		if (!opts.has("status")) return;

		const now = Date.now();
		const chars = kind === "message" ? textChars : thinkingChars;
		const lastChars = kind === "message" ? lastStatusTextChars : lastStatusThinkingChars;
		if (now - lastStatusAt < STATUS_INTERVAL_MS && chars - lastChars < STATUS_DELTA_CHARS) return;

		lastStatusAt = now;
		if (kind === "message") lastStatusTextChars = chars;
		else lastStatusThinkingChars = chars;
		writeStatus(`${kind} streaming: ${chars} chars`);
	}

	pi.on("message_update", async (event) => {
		const opts = getStreamOptions();
		if (opts.size === 0) return;

		const assistantEvent = event.assistantMessageEvent;
		if (!assistantEvent) return;
		const c = palette();

		if (assistantEvent.type === "thinking_start") {
			if (opts.has("status")) writeStatus("thinking started");
			if (opts.has("thinking")) {
				inThinkingBlock = true;
				writeOutput(`${c.gray}[thinking] `);
			}
		} else if (assistantEvent.type === "thinking_delta") {
			thinkingChars += assistantEvent.delta.length;
			maybeWriteCountStatus("thinking");
			if (inThinkingBlock) writeOutput(assistantEvent.delta);
		} else if (assistantEvent.type === "thinking_end") {
			if (opts.has("status")) writeStatus(`thinking finished: ${thinkingChars} chars`);
			if (inThinkingBlock) {
				inThinkingBlock = false;
				writeOutput(`${c.reset}\n\n`);
			}
		} else if (assistantEvent.type === "text_start") {
			if (opts.has("status")) writeStatus("message started");
			if (opts.has("message")) {
				inTextBlock = true;
				textLines = 1;
				textChars = 0;
				lastStatusTextChars = 0;
				writeOutput(`${c.cyan}[text] `);
			}
		} else if (assistantEvent.type === "text_delta") {
			textChars += assistantEvent.delta.length;
			maybeWriteCountStatus("message");
			if (inTextBlock) {
				writeOutput(assistantEvent.delta);
				textLines += (assistantEvent.delta.match(/\n/g) || []).length;
			}
		} else if (assistantEvent.type === "text_end") {
			if (opts.has("status")) writeStatus(`message finished: ${textChars} chars`);
			if (inTextBlock) {
				inTextBlock = false;
				writeOutput(`${c.reset}\n\n`);
			}
		}
	});

	// Track running tool progress (used to overwrite previous [running] line)
	let hasRunningLine = false;

	// [calling] — concise, tool-specific args
	pi.on("tool_execution_start", async (event) => {
		const opts = getStreamOptions();
		if (opts.has("status")) writeStatus(`tool started: ${event.toolName}`);
		if (!opts.has("tools")) return;

		const c = palette();
		hasRunningLine = false;
		const argsDisplay = formatToolArgs(event.toolName, event.args);
		writeOutput(
			`${c.yellow}[tool] [calling] ${event.toolName}${c.reset}\n` +
			`${c.yellow}        ${indentContent(argsDisplay, 8)}${c.reset}\n`,
		);
	});

	// [running] — compact progress indicator, overwrites itself to avoid spam
	pi.on("tool_execution_update", async (event) => {
		const opts = getStreamOptions();
		if (!event.partialResult) return;

		const text = extractText(event.partialResult);
		const bytes = text !== null ? text.length : JSON.stringify(event.partialResult).length;
		const sizeStr = formatBytes(bytes);
		if (opts.has("status")) writeStatus(`tool running: ${event.toolName} (${sizeStr})`);
		if (!opts.has("tools")) return;

		const c = palette();
		if (hasRunningLine && useAnsi()) {
			writeOutput("\x1b[1A\x1b[2K\r");
		}
		writeOutput(`${c.yellow}[tool] [running] ${event.toolName} → ${sizeStr}${c.reset}\n`);
		hasRunningLine = true;
	});

	// [result] / [error] — formatted output with real newlines
	pi.on("tool_execution_end", async (event) => {
		const opts = getStreamOptions();
		if (opts.has("status")) writeStatus(`tool ${event.isError ? "failed" : "finished"}: ${event.toolName}`);
		if (!opts.has("tools")) return;

		const c = palette();
		if (hasRunningLine && useAnsi()) {
			writeOutput("\x1b[1A\x1b[2K\r");
			hasRunningLine = false;
		}

		const resultDisplay = formatToolResult(event.toolName, event.result);
		const indented = indentContent(resultDisplay, 8);

		if (event.isError) {
			writeOutput(
				`${c.red}[tool] [error] ${event.toolName}${c.reset}\n` +
				`${c.red}        ${indentContent(resultDisplay, 8)}${c.reset}\n\n`,
			);
		} else {
			writeOutput(
				`${c.yellow}[tool] [result] ${event.toolName}${c.reset}\n` +
				`${c.yellow}        ${indented}${c.reset}\n\n`,
			);
		}
	});

	pi.on("agent_end", async () => {
		const opts = getStreamOptions();
		if (opts.has("status")) writeStatus(`agent finished: ${textChars} message chars, ${thinkingChars} thinking chars`);
		if (opts.size > 0 && textLines > 0 && useAnsi()) {
			// In a real terminal, these ANSI codes clear the duplicate final output.
			writeOutput(`\x1b[${textLines}A\x1b[0J`);
		}
		closeOutputFile();
	});
}
