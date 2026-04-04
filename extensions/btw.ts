import {
	buildSessionContext,
	codingTools,
	createAgentSession,
	createExtensionRuntime,
	getMarkdownTheme,
	SessionManager,
	type AgentSession,
	type AgentSessionEvent,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type ResourceLoader,
	type SessionEntry,
} from "@mariozechner/pi-coding-agent";
import { type AssistantMessage, type Message, type ThinkingLevel as AiThinkingLevel } from "@mariozechner/pi-ai";
import {
	Container,
	Input,
	Markdown,
	truncateToWidth,
	visibleWidth,
	type Focusable,
	type KeybindingsManager,
	type OverlayHandle,
	type TUI,
} from "@mariozechner/pi-tui";

const BTW_ENTRY_TYPE = "btw-thread-entry";
const BTW_RESET_TYPE = "btw-thread-reset";
const BTW_CONFIG_TYPE = "btw-config";

const BTW_SYSTEM_PROMPT = [
	"You are BTW, a side-channel assistant embedded in the user's coding agent.",
	"You have access to the main conversation context — use it to give informed answers.",
	"Help with focused questions, planning, and quick explorations.",
	"Be direct and practical.",
].join(" ");

const BTW_SUMMARY_PROMPT =
	"Summarize this side conversation for handoff into the main conversation. Keep key decisions, findings, risks, and next actions. Output only the summary.";

type SessionThinkingLevel = "off" | AiThinkingLevel;

type BtwThinkingLevel = "default" | SessionThinkingLevel;

interface BtwDisplayConfig {
	showReasoning: boolean;
	showReasoningEmoji: string;
	showAnswerEmoji: string;
	showToolCalls: boolean;
	showToolCallEmoji: string;
	showToolResultEmoji: string;
}

interface BtwConfig {
	thinkingLevel: BtwThinkingLevel;
	display: BtwDisplayConfig;
}

const DEFAULT_DISPLAY_CONFIG: BtwDisplayConfig = {
	showReasoning: false,
	showReasoningEmoji: "🧠",
	showAnswerEmoji: "💫",
	showToolCalls: true,
	showToolCallEmoji: "🔧",
	showToolResultEmoji: "📋",
};

const DEFAULT_CONFIG: BtwConfig = {
	thinkingLevel: "default",
	display: { ...DEFAULT_DISPLAY_CONFIG },
};

type BtwDetails = {
	question: string;
	answer: string;
	timestamp: number;
	provider: string;
	model: string;
	thinkingLevel: SessionThinkingLevel;
	usage?: AssistantMessage["usage"];
};

type BtwResetDetails = {
	timestamp: number;
};

type OverlayRuntime = {
	handle?: OverlayHandle;
	refresh?: () => void;
	close?: () => void;
	finish?: () => void;
	setDraft?: (value: string) => void;
	closed?: boolean;
};

type SideSessionRuntime = {
	session: AgentSession;
	modelKey: string;
	unsubscribe: () => void;
};

type ToolCallInfo = {
	toolCallId: string;
	toolName: string;
	args: string;
	status: "running" | "done" | "error";
};

function stripDynamicSystemPromptFooter(systemPrompt: string): string {
	return systemPrompt
		.replace(/\nCurrent date and time:[^\n]*(?:\nCurrent working directory:[^\n]*)?$/u, "")
		.replace(/\nCurrent working directory:[^\n]*$/u, "")
		.trim();
}

function createBtwResourceLoader(ctx: ExtensionContext, appendSystemPrompt: string[] = [BTW_SYSTEM_PROMPT]): ResourceLoader {
	const extensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() };
	const systemPrompt = stripDynamicSystemPromptFooter(ctx.getSystemPrompt());

	return {
		getExtensions: () => extensionsResult,
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => systemPrompt,
		getAppendSystemPrompt: () => appendSystemPrompt,
		getPathMetadata: () => new Map(),
		extendResources: () => {},
		reload: async () => {},
	};
}

function extractText(parts: AssistantMessage["content"]): string {
	return parts
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function extractEventAssistantText(message: unknown): string {
	if (!message || typeof message !== "object") {
		return "";
	}

	const maybeMessage = message as { role?: unknown; content?: unknown };
	if (maybeMessage.role !== "assistant" || !Array.isArray(maybeMessage.content)) {
		return "";
	}

	return maybeMessage.content
		.filter((part): part is { type: "text"; text: string } => {
			return !!part && typeof part === "object" && (part as { type?: unknown }).type === "text";
		})
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function getLastAssistantMessage(session: AgentSession): AssistantMessage | null {
	for (let i = session.messages.length - 1; i >= 0; i--) {
		const message = session.messages[i];
		if (message.role === "assistant") {
			return message as AssistantMessage;
		}
	}

	return null;
}

function buildSeedMessages(ctx: ExtensionContext, thread: BtwDetails[]): Message[] {
	const seed: Message[] = [];

	try {
		const contextMessages = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId()).messages;
		seed.push(...contextMessages);
	} catch {
		// Ignore context seed failures and continue with an empty side thread.
	}

	for (const item of thread) {
		seed.push(
			{
				role: "user",
				content: [{ type: "text", text: item.question }],
				timestamp: item.timestamp,
			},
			{
				role: "assistant",
				content: [{ type: "text", text: item.answer }],
				provider: item.provider,
				model: item.model,
				api: ctx.model?.api ?? "openai-responses",
				usage:
					item.usage ??
					{
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
				stopReason: "stop",
				timestamp: item.timestamp,
			},
		);
	}

	return seed;
}

function formatThread(thread: BtwDetails[]): string {
	return thread
		.map((item) => `User: ${item.question.trim()}\nAssistant: ${item.answer.trim()}`)
		.join("\n\n---\n\n");
}

function notify(ctx: ExtensionContext | ExtensionCommandContext, message: string, level: "info" | "warning" | "error"): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
	}
}


class BtwOverlay extends Container implements Focusable {
	private readonly input: Input;
	private readonly tui: TUI;
	private readonly theme: ExtensionContext["ui"]["theme"];
	private readonly keybindings: KeybindingsManager;
	private readonly getTranscript: (width: number, theme: ExtensionContext["ui"]["theme"]) => string[];
	private readonly getStatus: () => string;
	private readonly onSubmitCallback: (value: string) => void;
	private readonly onDismissCallback: () => void;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value;
	}

	constructor(
		tui: TUI,
		theme: ExtensionContext["ui"]["theme"],
		keybindings: KeybindingsManager,
		getTranscript: (width: number, theme: ExtensionContext["ui"]["theme"]) => string[],
		getStatus: () => string,
		onSubmit: (value: string) => void,
		onDismiss: () => void,
	) {
		super();
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.getTranscript = getTranscript;
		this.getStatus = getStatus;
		this.onSubmitCallback = onSubmit;
		this.onDismissCallback = onDismiss;

		this.input = new Input();
		this.input.onSubmit = (value) => {
			this.onSubmitCallback(value);
		};
		this.input.onEscape = () => {
			this.onDismissCallback();
		};
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "selectCancel")) {
			this.onDismissCallback();
			return;
		}

		this.input.handleInput(data);
	}

	setDraft(value: string): void {
		this.input.setValue(value);
		this.tui.requestRender();
	}

	getDraft(): string {
		return this.input.getValue();
	}

	private frameLine(content: string, innerWidth: number): string {
		const truncated = truncateToWidth(content, innerWidth, "");
		const padding = Math.max(0, innerWidth - visibleWidth(truncated));
		return `${this.theme.fg("borderMuted", "│")}${truncated}${" ".repeat(padding)}${this.theme.fg("borderMuted", "│")}`;
	}

	private borderLine(innerWidth: number, edge: "top" | "bottom"): string {
		const left = edge === "top" ? "┌" : "└";
		const right = edge === "top" ? "┐" : "┘";
		return this.theme.fg("borderMuted", `${left}${"─".repeat(innerWidth)}${right}`);
	}

	override render(width: number): string[] {
		const dialogWidth = Math.max(56, Math.min(width, Math.floor(width * 0.9)));
		const innerWidth = Math.max(40, dialogWidth - 2);
		const terminalRows = process.stdout.rows ?? 30;
		const dialogHeight = Math.max(16, Math.min(30, Math.floor(terminalRows * 0.75)));
		const chromeHeight = 7;
		const transcriptHeight = Math.max(6, dialogHeight - chromeHeight);

		// Markdown renders to innerWidth already — no manual wrapping needed
		const transcript = this.getTranscript(innerWidth, this.theme);
		const visibleTranscript = transcript.slice(-transcriptHeight);
		const transcriptPadding = Math.max(0, transcriptHeight - visibleTranscript.length);

		const status = this.getStatus();

		const previousFocused = this.input.focused;
		this.input.focused = false;
		const inputLine = this.input.render(innerWidth)[0] ?? "";
		this.input.focused = previousFocused;

		const lines = [
			this.borderLine(innerWidth, "top"),
			this.frameLine(this.theme.fg("accent", this.theme.bold(" BTW side chat ")), innerWidth),
			this.frameLine(this.theme.fg("dim", "Separate side conversation. Esc closes."), innerWidth),
			this.theme.fg("borderMuted", `├${"─".repeat(innerWidth)}┤`),
		];

		for (const line of visibleTranscript) {
			lines.push(this.frameLine(line, innerWidth));
		}
		for (let i = 0; i < transcriptPadding; i++) {
			lines.push(this.frameLine("", innerWidth));
		}

		lines.push(this.theme.fg("borderMuted", `├${"─".repeat(innerWidth)}┤`));
		lines.push(this.frameLine(this.theme.fg("warning", status), innerWidth));
		lines.push(
			`${this.theme.fg("borderMuted", "│")}${inputLine}${this.theme.fg("borderMuted", "│")}`,
		);
		lines.push(this.frameLine(this.theme.fg("dim", "Enter submit · Esc close"), innerWidth));
		lines.push(this.borderLine(innerWidth, "bottom"));

		return lines;
	}
}

export default function (pi: ExtensionAPI) {
	let thread: BtwDetails[] = [];
	let pendingQuestion: string | null = null;
	let pendingAnswer = "";
	let pendingError: string | null = null;
	let pendingToolCalls: ToolCallInfo[] = [];
	let sideBusy = false;
	let overlayStatus = "Ready";
	let overlayDraft = "";
	let overlayRuntime: OverlayRuntime | null = null;
	let activeSideSession: SideSessionRuntime | null = null;
	let overlayRefreshTimer: ReturnType<typeof setTimeout> | null = null;

	// Config state - persisted in session
	let config: BtwConfig = { ...DEFAULT_CONFIG };

	const mdTheme = getMarkdownTheme();

	function getModelKey(ctx: ExtensionContext): string {
		const model = ctx.model;
		return model ? `${model.provider}/${model.id}` : "none";
	}

	function renderMarkdownLines(text: string, width: number): string[] {
		if (!text) return [];
		try {
			const md = new Markdown(text, 0, 0, mdTheme);
			return md.render(width);
		} catch {
			// Fall back to plain text wrapping if Markdown rendering fails
			return text.split("\n").flatMap((line) => {
				if (!line) return [""];
				const wrapped: string[] = [];
				for (let i = 0; i < line.length; i += width) {
					wrapped.push(line.slice(i, i + width));
				}
				return wrapped.length > 0 ? wrapped : [""];
			});
		}
	}

	function formatToolArgs(toolName: string, args: unknown): string {
		if (!args || typeof args !== "object") return "";
		const a = args as Record<string, unknown>;
		switch (toolName) {
			case "bash":
				return typeof a.command === "string" ? truncateToWidth(a.command.split("\n")[0], 50, "…") : "";
			case "read":
			case "write":
			case "edit":
				return typeof a.path === "string" ? a.path : "";
			default: {
				const first = Object.values(a)[0];
				return typeof first === "string" ? truncateToWidth(first.split("\n")[0], 40, "…") : "";
			}
		}
	}

	function renderToolCallLines(toolCalls: ToolCallInfo[], theme: ExtensionContext["ui"]["theme"], width: number): string[] {
		const lines: string[] = [];
		for (const tc of toolCalls) {
			const statusIcon = tc.status === "running" ? "⚙" : tc.status === "error" ? "✗" : "✓";
			const statusColor = tc.status === "error" ? "error" : tc.status === "done" ? "success" : "dim";
			const emoji = config.display.showToolCallEmoji;
			const label = theme.fg(statusColor, `${statusIcon} `) + theme.fg("toolTitle", `${emoji}${tc.toolName}`);
			const argsText = tc.args ? theme.fg("dim", ` ${tc.args}`) : "";
			lines.push(truncateToWidth(`  ${label}${argsText}`, width, ""));
		}
		return lines;
	}

	function getTranscriptLines(width: number, theme: ExtensionContext["ui"]["theme"]): string[] {
		try {
			return getTranscriptLinesInner(width, theme);
		} catch (error) {
			return [theme.fg("error", `Render error: ${error instanceof Error ? error.message : String(error)}`)];
		}
	}

	function getTranscriptLinesInner(width: number, theme: ExtensionContext["ui"]["theme"]): string[] {
		if (thread.length === 0 && !pendingQuestion && !pendingAnswer && !pendingError) {
			return [theme.fg("dim", "No BTW messages yet. Type a question below.")];
		}

		const lines: string[] = [];
		for (const item of thread.slice(-6)) {
				// User message
				const userText = item.question.trim().split("\n")[0];
				lines.push(theme.fg("accent", theme.bold("You: ")) + truncateToWidth(userText, width - 5, "…"));
				lines.push("");

				// Assistant message rendered as markdown
				const answerPrefix = config.display.showAnswerEmoji ? `${config.display.showAnswerEmoji} ` : "";
				const mdLines = renderMarkdownLines(`${answerPrefix}${item.answer}`, width);
				lines.push(...mdLines);
				lines.push("");
			}

		if (pendingQuestion) {
			const userText = pendingQuestion.trim().split("\n")[0];
			lines.push(theme.fg("accent", theme.bold("You: ")) + truncateToWidth(userText, width - 5, "…"));

			// Show tool calls inline if enabled
			if (config.display.showToolCalls && pendingToolCalls.length > 0) {
				lines.push(...renderToolCallLines(pendingToolCalls, theme, width));
			}

			if (pendingError) {
				lines.push(theme.fg("error", `❌ ${pendingError}`));
			} else if (pendingAnswer) {
				lines.push("");
				const answerPrefix = config.display.showAnswerEmoji ? `${config.display.showAnswerEmoji} ` : "";
				const mdLines = renderMarkdownLines(`${answerPrefix}${pendingAnswer}`, width);
				lines.push(...mdLines);
			} else if (pendingToolCalls.length === 0 || !config.display.showToolCalls) {
				lines.push(theme.fg("dim", "…"));
			}
		}

		// Trim trailing empty line
		while (lines.length > 0 && lines[lines.length - 1] === "") {
			lines.pop();
		}
		return lines;
	}

	function syncOverlay(): void {
		overlayRuntime?.refresh?.();
	}

	function scheduleOverlayRefresh(): void {
		if (overlayRefreshTimer) {
			return;
		}

		overlayRefreshTimer = setTimeout(() => {
			overlayRefreshTimer = null;
			syncOverlay();
		}, 16);
	}

	function setOverlayStatus(status: string, throttled = false): void {
		overlayStatus = status;
		if (throttled) {
			scheduleOverlayRefresh();
		} else {
			syncOverlay();
		}
	}

	function dismissOverlay(): void {
		overlayRuntime?.close?.();
		overlayRuntime = null;
		if (overlayRefreshTimer) {
			clearTimeout(overlayRefreshTimer);
			overlayRefreshTimer = null;
		}
	}

	function setOverlayDraft(value: string): void {
		overlayDraft = value;
		overlayRuntime?.setDraft?.(value);
	}

	async function disposeSideSession(): Promise<void> {
		const current = activeSideSession;
		activeSideSession = null;
		if (!current) {
			return;
		}

		try {
			current.unsubscribe();
		} catch {
			// Ignore unsubscribe errors during cleanup.
		}

		try {
			await current.session.abort();
		} catch {
			// Ignore abort errors during cleanup.
		}
		current.session.dispose();

		if (overlayRefreshTimer) {
			clearTimeout(overlayRefreshTimer);
			overlayRefreshTimer = null;
		}
	}

	async function resetThread(ctx: ExtensionContext | ExtensionCommandContext, persist = true): Promise<void> {
		thread = [];
		pendingQuestion = null;
		pendingAnswer = "";
		pendingError = null;
		pendingToolCalls = [];
		sideBusy = false;
		setOverlayDraft("");
		setOverlayStatus("Ready");
		await disposeSideSession();
		if (persist) {
			const details: BtwResetDetails = { timestamp: Date.now() };
			pi.appendEntry(BTW_RESET_TYPE, details);
		}
		syncOverlay();
	}

	async function restoreThread(ctx: ExtensionContext): Promise<void> {
		await disposeSideSession();
		thread = [];
		pendingQuestion = null;
		pendingAnswer = "";
		pendingError = null;
		pendingToolCalls = [];
		sideBusy = false;
		overlayStatus = "Ready";
		overlayDraft = "";
		const branch = ctx.sessionManager.getBranch();
		let lastResetIndex = -1;
		for (let i = 0; i < branch.length; i++) {
			const entry = branch[i];
			if (entry.type === "custom" && entry.customType === BTW_RESET_TYPE) {
				lastResetIndex = i;
			}
		}

		for (const entry of branch.slice(lastResetIndex + 1)) {
			if (entry.type !== "custom" || entry.customType !== BTW_ENTRY_TYPE) {
				continue;
			}
			const details = entry.data as BtwDetails | undefined;
			if (!details?.question || !details.answer) {
				continue;
			}
			thread.push(details);
		}

		restoreConfig(ctx.sessionManager.getEntries());
		syncOverlay();
	}

	function restoreConfig(entries: SessionEntry[]): void {
		// Find the most recent config entry
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type === "custom" && entry.customType === BTW_CONFIG_TYPE) {
				const saved = entry.data as BtwConfig | undefined;
				if (saved) {
					config = {
						thinkingLevel: saved.thinkingLevel ?? DEFAULT_CONFIG.thinkingLevel,
						display: {
							...DEFAULT_DISPLAY_CONFIG,
							...saved.display,
						},
					};
					return;
					}
			}
		}
		// No config found, use defaults
		config = { ...DEFAULT_CONFIG };
	}

	function saveConfig(): void {
		pi.appendEntry(BTW_CONFIG_TYPE, config);
	}

	function getEffectiveThinkingLevel(ctx: ExtensionContext | ExtensionCommandContext): SessionThinkingLevel {
		if (config.thinkingLevel === "default") {
			return pi.getThinkingLevel() as SessionThinkingLevel;
		}
		return config.thinkingLevel;
	}

	async function createSideSession(ctx: ExtensionCommandContext): Promise<SideSessionRuntime | null> {
		if (!ctx.model) {
			return null;
		}

		const { session } = await createAgentSession({
			sessionManager: SessionManager.inMemory(),
			model: ctx.model,
			modelRegistry: ctx.modelRegistry as AgentSession["modelRegistry"],
			thinkingLevel: getEffectiveThinkingLevel(ctx),
			tools: codingTools,
			resourceLoader: createBtwResourceLoader(ctx),
		});

		const seedMessages = buildSeedMessages(ctx, thread);
		if (seedMessages.length > 0) {
			session.agent.state.messages = seedMessages;
		}

		const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
			if (!sideBusy || !pendingQuestion) {
				return;
			}

			switch (event.type) {
				case "message_start":
				case "message_update":
				case "message_end": {
					const streamed = extractEventAssistantText(event.message);
					if (streamed) {
						pendingAnswer = streamed;
						pendingError = null;
					}
					setOverlayStatus(event.type === "message_end" ? "Finalizing side response..." : "Streaming side response...", true);
					return;
				}
				case "tool_execution_start": {
					const toolName = (event as { toolName?: string }).toolName ?? "unknown";
					try {
						pendingToolCalls.push({
							toolCallId: (event as { toolCallId?: string }).toolCallId ?? "",
							toolName,
							args: formatToolArgs(toolName, (event as { args?: unknown }).args),
							status: "running",
						});
					} catch {
						// Ignore tool tracking failures
					}
					setOverlayStatus(`Running tool: ${toolName}...`, true);
					return;
				}
				case "tool_execution_end": {
					const endToolName = (event as { toolName?: string }).toolName ?? "unknown";
					const tc = pendingToolCalls.find(
						(t) => t.toolName === endToolName && t.status === "running",
					);
					if (tc) {
						tc.status = (event as { isError?: boolean }).isError ? "error" : "done";
					}
					setOverlayStatus("Streaming side response...", true);
					return;
				}
				case "turn_end": {
					setOverlayStatus("Finalizing side response...", true);
					return;
				}
				default:
					return;
			}
		});

		return {
			session,
			modelKey: getModelKey(ctx),
			unsubscribe,
		};
	}

	async function ensureSideSession(ctx: ExtensionCommandContext): Promise<SideSessionRuntime | null> {
		if (!ctx.model) {
			return null;
		}

		const expectedModelKey = getModelKey(ctx);
		if (activeSideSession && activeSideSession.modelKey === expectedModelKey) {
			return activeSideSession;
		}

		await disposeSideSession();
		activeSideSession = await createSideSession(ctx);
		return activeSideSession;
	}

	async function ensureOverlay(ctx: ExtensionCommandContext | ExtensionContext): Promise<void> {
		if (!ctx.hasUI) {
			return;
		}

		if (overlayRuntime?.handle) {
			overlayRuntime.handle.setHidden(false);
			overlayRuntime.handle.focus();
			overlayRuntime.refresh?.();
			return;
		}

		const runtime: OverlayRuntime = {};
		const closeRuntime = () => {
			if (runtime.closed) {
				return;
			}
			runtime.closed = true;
			runtime.handle?.hide();
			if (overlayRuntime === runtime) {
				overlayRuntime = null;
			}
			runtime.finish?.();
		};
		runtime.close = closeRuntime;
		overlayRuntime = runtime;

		void ctx.ui
			.custom<void>(
				async (tui, theme, keybindings, done) => {
					runtime.finish = () => done();

					const overlay = new BtwOverlay(
						tui,
						theme,
						keybindings,
						(width, t) => getTranscriptLines(width, t),
						() => overlayStatus,
						(value) => {
							void submitFromOverlay(ctx, value);
						},
						() => {
							void closeOverlayFlow(ctx);
						},
					);

					overlay.focused = true;
					overlay.setDraft(overlayDraft);
					runtime.setDraft = (value) => overlay.setDraft(value);
					runtime.refresh = () => {
						overlay.focused = runtime.handle?.isFocused() ?? false;
						tui.requestRender();
					};
					runtime.close = () => {
						overlayDraft = overlay.getDraft();
						closeRuntime();
					};

					if (runtime.closed) {
						done();
					}

					return overlay;
				},
				{
					overlay: true,
					overlayOptions: {
						width: "80%",
						minWidth: 72,
						maxHeight: "78%",
						anchor: "top-center",
						margin: { top: 1, left: 2, right: 2 },
					},
					onHandle: (handle) => {
						runtime.handle = handle;
						handle.focus();
						if (runtime.closed) {
							closeRuntime();
						}
					},
				},
			)
			.catch((error) => {
				if (overlayRuntime === runtime) {
					overlayRuntime = null;
				}
				notify(ctx, error instanceof Error ? error.message : String(error), "error");
			});
	}

	async function summarizeThread(ctx: ExtensionContext, items: BtwDetails[]): Promise<string> {
		const model = ctx.model;
		if (!model) {
			throw new Error("No active model selected.");
		}

		const hasCredentials = ctx.modelRegistry.hasConfiguredAuth(model);
		if (!hasCredentials) {
			throw new Error(`No credentials available for ${model.provider}/${model.id}.`);
		}

		const { session } = await createAgentSession({
			sessionManager: SessionManager.inMemory(),
			model,
			modelRegistry: ctx.modelRegistry as AgentSession["modelRegistry"],
			thinkingLevel: "off",
			tools: [],
			resourceLoader: createBtwResourceLoader(ctx, [BTW_SUMMARY_PROMPT]),
		});

		try {
			await session.prompt(formatThread(items), { source: "extension" });
			const response = getLastAssistantMessage(session);
			if (!response) {
				throw new Error("Summary finished without a response.");
			}
			if (response.stopReason === "aborted") {
				throw new Error("Summary request was aborted.");
			}
			if (response.stopReason === "error") {
				throw new Error(response.errorMessage || "Summary request failed.");
			}

			return extractText(response.content) || "(No summary generated)";
		} finally {
			try {
				await session.abort();
			} catch {
				// Ignore abort errors during temporary session teardown.
			}
			session.dispose();
		}
	}

	async function injectSummaryIntoMain(ctx: ExtensionContext | ExtensionCommandContext): Promise<void> {
		if (thread.length === 0) {
			notify(ctx, "No BTW thread to summarize.", "warning");
			return;
		}

		setOverlayStatus("Summarizing BTW thread for injection...");
		try {
			const summary = await summarizeThread(ctx, thread);
			const message = `Summary of my BTW side conversation:\n\n${summary}`;
			if (ctx.isIdle()) {
				pi.sendUserMessage(message);
			} else {
				pi.sendUserMessage(message, { deliverAs: "followUp" });
			}

			await resetThread(ctx);
			notify(ctx, "Injected BTW summary into main chat.", "info");
		} catch (error) {
			notify(ctx, error instanceof Error ? error.message : String(error), "error");
		}
	}

	async function closeOverlayFlow(ctx: ExtensionContext | ExtensionCommandContext): Promise<void> {
		dismissOverlay();
		if (!ctx.hasUI) {
			return;
		}

		if (thread.length === 0) {
			return;
		}

		const choice = await ctx.ui.select("Close BTW:", ["Keep side thread", "Inject summary into main chat"]);
		if (choice === "Inject summary into main chat") {
			await injectSummaryIntoMain(ctx);
		}
	}

	async function runBtwPrompt(ctx: ExtensionCommandContext, question: string): Promise<void> {
		const model = ctx.model;
		if (!model) {
			setOverlayStatus("No active model selected.");
			notify(ctx, "No active model selected.", "error");
			return;
		}

		const hasCredentials = ctx.modelRegistry.hasConfiguredAuth(model);
		if (!hasCredentials) {
			const message = `No credentials available for ${model.provider}/${model.id}.`;
			setOverlayStatus(message);
			notify(ctx, message, "error");
			return;
		}

		if (sideBusy) {
			notify(ctx, "BTW is still processing the previous message.", "warning");
			return;
		}

		const side = await ensureSideSession(ctx);
		if (!side) {
			notify(ctx, "Unable to create BTW side session.", "error");
			return;
		}

		sideBusy = true;
		pendingQuestion = question;
		pendingAnswer = "";
		pendingError = null;
		pendingToolCalls = [];
		setOverlayStatus("Streaming side response...");
		syncOverlay();

		try {
			await side.session.prompt(question, { source: "extension" });
			const response = getLastAssistantMessage(side.session);
			if (!response) {
				throw new Error("BTW request finished without a response.");
			}
			if (response.stopReason === "aborted") {
				throw new Error("BTW request aborted.");
			}
			if (response.stopReason === "error") {
				throw new Error(response.errorMessage || "BTW request failed.");
			}

			const answer = extractText(response.content) || "(No text response)";
			pendingAnswer = answer;
			const details: BtwDetails = {
				question,
				answer,
				timestamp: Date.now(),
				provider: model.provider,
				model: model.id,
				thinkingLevel: getEffectiveThinkingLevel(ctx),
				usage: response.usage,
			};
			thread.push(details);
			pi.appendEntry(BTW_ENTRY_TYPE, details);

			pendingQuestion = null;
			pendingAnswer = "";
			pendingToolCalls = [];
			setOverlayStatus("Ready for the next side question.");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			pendingError = message;
			setOverlayStatus("BTW request failed.");
			notify(ctx, message, "error");
		} finally {
			sideBusy = false;
			syncOverlay();
		}
	}

	async function submitFromOverlay(ctx: ExtensionContext | ExtensionCommandContext, rawValue: string): Promise<void> {
		const question = rawValue.trim();
		if (!question) {
			setOverlayStatus("Enter a question first.");
			return;
		}

		setOverlayDraft("");
		if (!("waitForIdle" in ctx)) {
			setOverlayStatus("BTW submit requires command context. Re-open with /btw.");
			return;
		}

		await runBtwPrompt(ctx, question);
	}

	const THINKING_LEVEL_OPTIONS: BtwThinkingLevel[] = ["default", "off", "minimal", "low", "medium", "high", "xhigh"];

	function formatConfigStatus(): string {
		const tl = config.thinkingLevel === "default" ? `default (currently ${pi.getThinkingLevel()})` : config.thinkingLevel;
		return [
			`Thinking Level: ${tl}`,
			`Display:`,
			`  Reasoning: ${config.display.showReasoning ? "shown" : "hidden"} (${config.display.showReasoningEmoji})`,
			`  Answer: ${config.display.showAnswerEmoji}`,
			`  Tool Calls: ${config.display.showToolCalls ? "shown" : "hidden"} (${config.display.showToolCallEmoji})`,
			`  Tool Results: ${config.display.showToolResultEmoji}`,
		].join("\n");
	}

	pi.registerCommand("btwconfig", {
		description: "Configure BTW side-chat settings (thinking level, display options).",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				return;
			}

			const choices = [
				"Show current config",
				"Set thinking level",
				"Toggle reasoning display",
				"Set reasoning emoji",
				"Set answer emoji",
				"Toggle tool calls display",
				"Set tool call emoji",
				"Set tool result emoji",
				"Reset to defaults",
			];

			const choice = await ctx.ui.select("BTW Config", choices);
			if (!choice) return;

			switch (choice) {
				case "Show current config":
					await ctx.ui.notify(formatConfigStatus(), "info");
					break;

				case "Set thinking level": {
					const tlChoice = await ctx.ui.select("Thinking Level", THINKING_LEVEL_OPTIONS);
					if (!tlChoice) return;
					config.thinkingLevel = tlChoice as BtwThinkingLevel;
					saveConfig();
					await ctx.ui.notify(`Thinking level set to: ${tlChoice}`, "success");
					break;
				}

				case "Toggle reasoning display": {
					config.display.showReasoning = !config.display.showReasoning;
					saveConfig();
					await ctx.ui.notify(`Reasoning display: ${config.display.showReasoning ? "shown" : "hidden"}`, "success");
					break;
				}

				case "Set reasoning emoji": {
					const emoji = await ctx.ui.input("Reasoning emoji", { default: config.display.showReasoningEmoji });
					if (emoji === undefined) return;
					config.display.showReasoningEmoji = emoji || "🧠";
					saveConfig();
					await ctx.ui.notify(`Reasoning emoji set to: ${config.display.showReasoningEmoji}`, "success");
					break;
				}

				case "Set answer emoji": {
					const emoji = await ctx.ui.input("Answer emoji", { default: config.display.showAnswerEmoji });
					if (emoji === undefined) return;
					config.display.showAnswerEmoji = emoji || "💫";
					saveConfig();
					await ctx.ui.notify(`Answer emoji set to: ${config.display.showAnswerEmoji}`, "success");
					break;
				}

				case "Toggle tool calls display": {
					config.display.showToolCalls = !config.display.showToolCalls;
					saveConfig();
					await ctx.ui.notify(`Tool calls display: ${config.display.showToolCalls ? "shown" : "hidden"}`, "success");
					break;
				}

				case "Set tool call emoji": {
					const emoji = await ctx.ui.input("Tool call emoji", { default: config.display.showToolCallEmoji });
					if (emoji === undefined) return;
					config.display.showToolCallEmoji = emoji || "🔧";
					saveConfig();
					await ctx.ui.notify(`Tool call emoji set to: ${config.display.showToolCallEmoji}`, "success");
					break;
				}

				case "Set tool result emoji": {
					const emoji = await ctx.ui.input("Tool result emoji", { default: config.display.showToolResultEmoji });
					if (emoji === undefined) return;
					config.display.showToolResultEmoji = emoji || "📋";
					saveConfig();
					await ctx.ui.notify(`Tool result emoji set to: ${config.display.showToolResultEmoji}`, "success");
					break;
				}

				case "Reset to defaults":
					config = { ...DEFAULT_CONFIG };
					config.display = { ...DEFAULT_DISPLAY_CONFIG };
					saveConfig();
					await ctx.ui.notify("Config reset to defaults", "success");
					break;
			}
		},
	});

	pi.registerCommand("btw", {
		description: "Open a simple BTW side-chat popover. `/btw <text>` asks immediately, `/btw` opens the side thread.",
		handler: async (args, ctx) => {
			const question = args.trim();

			if (!question) {
				if (thread.length > 0 && ctx.hasUI) {
					const choice = await ctx.ui.select("BTW side chat:", [
						"Continue previous conversation",
						"Start fresh",
					]);
					if (choice === "Continue previous conversation") {
						// Dispose session so it's recreated with fresh main context on next submit
						await disposeSideSession();
						setOverlayStatus("Continuing BTW thread.");
						await ensureOverlay(ctx);
					} else if (choice === "Start fresh") {
						await resetThread(ctx, true);
						setOverlayStatus("Ready");
						await ensureOverlay(ctx);
					}
					// null = user cancelled (Esc), do nothing
				} else {
					await resetThread(ctx, true);
					setOverlayStatus("Ready");
					await ensureOverlay(ctx);
				}
				return;
			}

			await ensureOverlay(ctx);
			await runBtwPrompt(ctx, question);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		await restoreThread(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		await restoreThread(ctx);
	});

	pi.on("session_shutdown", async () => {
		await disposeSideSession();
		dismissOverlay();
	});
}
