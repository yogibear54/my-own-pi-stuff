import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { existsSync, promises as fs } from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

const GHOSTTY_SPLIT_SCRIPT = `on run argv
	set targetCwd to item 1 of argv
	set startupInput to item 2 of argv
	tell application "Ghostty"
		set cfg to new surface configuration
		set initial working directory of cfg to targetCwd
		set initial input of cfg to startupInput
		if (count of windows) > 0 then
			try
				set frontWindow to front window
				set targetTerminal to focused terminal of selected tab of frontWindow
				split targetTerminal direction right with configuration cfg
			on error
				new window with configuration cfg
			end try
		else
			new window with configuration cfg
		end if
		activate
	end tell
end run`;

function shellQuote(value: string): string {
	if (value.length === 0) return "''";
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function getPiInvocationParts(): string[] {
	const currentScript = process.argv[1];
	if (currentScript && existsSync(currentScript)) {
		return [process.execPath, currentScript];
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return [process.execPath];
	}

	return ["pi"];
}

function buildPiCommand(sessionFile: string | undefined, prompt: string, model: { provider: string; id: string } | undefined): string[] {
	const commandParts = [...getPiInvocationParts()];

	if (sessionFile) {
		commandParts.push("--session", sessionFile);
	}

	if (model) {
		commandParts.push("--model", `${model.provider}/${model.id}`);
	}

	if (prompt.length > 0) {
		commandParts.push("--", prompt);
	}

	return commandParts;
}

function buildPiStartupInput(sessionFile: string | undefined, prompt: string, model: { provider: string; id: string } | undefined): string {
	const commandParts = buildPiCommand(sessionFile, prompt, model);
	return `${commandParts.map(shellQuote).join(" ")}\n`;
}

async function createForkedSession(ctx: ExtensionCommandContext): Promise<string | undefined> {
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile) {
		return undefined;
	}

	const sessionDir = path.dirname(sessionFile);
	const branchEntries = ctx.sessionManager.getBranch();
	const currentHeader = ctx.sessionManager.getHeader();

	const timestamp = new Date().toISOString();
	const fileTimestamp = timestamp.replace(/[:.]/g, "-");
	const newSessionId = randomUUID();
	const newSessionFile = path.join(sessionDir, `${fileTimestamp}_${newSessionId}.jsonl`);

	const newHeader = {
		type: "session",
		version: currentHeader?.version ?? 3,
		id: newSessionId,
		timestamp,
		cwd: currentHeader?.cwd ?? ctx.cwd,
		parentSession: sessionFile,
	};

	const lines = [JSON.stringify(newHeader), ...branchEntries.map((entry) => JSON.stringify(entry))].join("\n") + "\n";

	await fs.mkdir(sessionDir, { recursive: true });
	await fs.writeFile(newSessionFile, lines, "utf8");

	return newSessionFile;
}

async function launchGhosttySplit(pi: ExtensionAPI, ctx: ExtensionCommandContext, forkedSessionFile: string | undefined, prompt: string, model: { provider: string; id: string } | undefined): Promise<{ success: boolean; error?: string }> {
	const startupInput = buildPiStartupInput(forkedSessionFile, prompt, model);
	const result = await pi.exec("osascript", ["-e", GHOSTTY_SPLIT_SCRIPT, "--", ctx.cwd, startupInput]);
	
	if (result.code !== 0) {
		return { success: false, error: result.stderr?.trim() || result.stdout?.trim() || "unknown osascript error" };
	}
	return { success: true };
}

async function launchGnomeTerminal(pi: ExtensionAPI, ctx: ExtensionCommandContext, forkedSessionFile: string | undefined, prompt: string, model: { provider: string; id: string } | undefined): Promise<{ success: boolean; error?: string }> {
	const commandParts = buildPiCommand(forkedSessionFile, prompt, model);
	const fullCommand = commandParts.map(shellQuote).join(" ");
	
	// gnome-terminal accepts --working-directory and runs the command after --
	const args = ["--working-directory", ctx.cwd, "--", "bash", "-c", fullCommand];
	
	const result = await pi.exec("gnome-terminal", args);
	
	if (result.code !== 0) {
		return { success: false, error: result.stderr?.trim() || result.stdout?.trim() || "unknown gnome-terminal error" };
	}
	return { success: true };
}

async function launchTerminalSplit(pi: ExtensionAPI, ctx: ExtensionCommandContext, forkedSessionFile: string | undefined, prompt: string, model: { provider: string; id: string } | undefined): Promise<{ success: boolean; error?: string; terminal?: string }> {
	switch (process.platform) {
		case "darwin":
			return { ...(await launchGhosttySplit(pi, ctx, forkedSessionFile, prompt, model)), terminal: "Ghostty" };
		case "linux":
			return { ...(await launchGnomeTerminal(pi, ctx, forkedSessionFile, prompt, model)), terminal: "GNOME Terminal" };
		default:
			return { success: false, error: `Unsupported platform: ${process.platform}` };
	}
}

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("split-fork", {
		description: "Fork this session into a new pi process in a new terminal. Usage: /split-fork [optional prompt]",
		handler: async (args, ctx) => {
			const wasBusy = !ctx.isIdle();
			const prompt = args.trim();
			const forkedSessionFile = await createForkedSession(ctx);

			// Get current model to preserve it in the forked instance
			const currentModel = ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined;

			const result = await launchTerminalSplit(pi, ctx, forkedSessionFile, prompt, currentModel);
			
			if (!result.success) {
				ctx.ui.notify(`Failed to launch terminal: ${result.error}`, "error");
				if (forkedSessionFile) {
					ctx.ui.notify(`Forked session was created: ${forkedSessionFile}`, "info");
				}
				return;
			}

			if (forkedSessionFile) {
				const fileName = path.basename(forkedSessionFile);
				const suffix = prompt ? " and sent prompt" : "";
				ctx.ui.notify(`Forked to ${fileName} in a new ${result.terminal}${suffix}.`, "info");
				if (wasBusy) {
					ctx.ui.notify("Forked from current committed state (in-flight turn continues in original session).", "info");
				}
			} else {
				ctx.ui.notify(`Opened a new ${result.terminal} (no persisted session to fork).`, "warning");
			}
		},
	});
}
