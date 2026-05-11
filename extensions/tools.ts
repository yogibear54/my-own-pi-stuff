/**
 * Tools Extension
 *
 * Provides a /tools command to enable/disable tools interactively.
 * Tool selection persists across session reloads and respects branch navigation.
 *
 * Usage:
 * 1. Copy this file to ~/.pi/agent/extensions/ or your project's .pi/extensions/
 * 2. Use /tools to open the tool selector
 */

import type { ExtensionAPI, ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList } from "@earendil-works/pi-tui";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// State persisted to session
interface ToolsState {
	enabledTools: string[];
}

const TOOLS_CONFIG_NAME = "tools-config.json";
const GLOBAL_CONFIG_DIR = join(homedir(), ".pi", "agent");

// Get config path: project-level takes precedence over global
export function getToolsConfigPath(cwd: string = process.cwd()): string {
	const projectPath = join(cwd, ".pi", "agent", TOOLS_CONFIG_NAME);
	if (existsSync(projectPath)) {
		return projectPath;
	}
	return join(GLOBAL_CONFIG_DIR, TOOLS_CONFIG_NAME);
}

export default function toolsExtension(pi: ExtensionAPI) {
	// Track enabled tools
	let enabledTools: Set<string> = new Set();
	let allTools: ToolInfo[] = [];

	// Persist current state to session and file
	function persistState(cwd: string = process.cwd()) {
		const tools = Array.from(enabledTools);
		pi.appendEntry<ToolsState>("tools-config", {
			enabledTools: tools,
		});
		// Persist to file (project-level takes precedence)
		try {
			mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
			const configPath = getToolsConfigPath(cwd);
			writeFileSync(configPath, JSON.stringify({ enabledTools: tools }, null, "\t") + "\n");
		} catch {
			// Silently ignore file write errors
		}
	}

	// Apply current tool selection
	function applyTools() {
		pi.setActiveTools(Array.from(enabledTools));
	}

	// Find the last tools-config entry in the current branch
	function restoreFromBranch(ctx: ExtensionContext, cwd: string = process.cwd()) {
		allTools = pi.getAllTools();

		// Get entries in current branch only
		const branchEntries = ctx.sessionManager.getBranch();
		let savedTools: string[] | undefined;

		for (const entry of branchEntries) {
			if (entry.type === "custom" && entry.customType === "tools-config") {
				const data = entry.data as ToolsState | undefined;
				if (data?.enabledTools) {
					savedTools = data.enabledTools;
				}
			}
		}

		if (savedTools) {
			// Restore saved tool selection (filter to only tools that still exist)
			const allToolNames = allTools.map((t) => t.name);
			enabledTools = new Set(savedTools.filter((t: string) => allToolNames.includes(t)));
			applyTools();
		} else {
			// No session state - try loading from file (project-level takes precedence)
			let fileTools: string[] | undefined;
			const configPath = getToolsConfigPath(cwd);
			try {
				const raw = readFileSync(configPath, "utf-8");
				const data = JSON.parse(raw);
				if (Array.isArray(data?.enabledTools)) fileTools = data.enabledTools;
			} catch {
				// File doesn't exist or is invalid - that's fine
			}

			if (fileTools) {
				const allToolNames = allTools.map((t) => t.name);
				enabledTools = new Set(fileTools.filter((t: string) => allToolNames.includes(t)));
				applyTools();
			} else {
				// No saved state at all - sync with currently active tools
				enabledTools = new Set(pi.getActiveTools());
			}
		}
	}

	// Register /tools command
	pi.registerCommand("tools", {
		description: "Enable/disable tools",
		handler: async (_args, ctx) => {
			// Refresh tool list
			allTools = pi.getAllTools();

			await ctx.ui.custom((tui, theme, _kb, done) => {
				// Build settings items for each tool
				const items: SettingItem[] = allTools.map((tool) => ({
					id: tool.name,
					label: tool.name,
					currentValue: enabledTools.has(tool.name) ? "enabled" : "disabled",
					values: ["enabled", "disabled"],
				}));

				const container = new Container();
				container.addChild(
					new (class {
						render(_width: number) {
							return [theme.fg("accent", theme.bold("Tool Configuration")), ""];
						}
						invalidate() {}
					})(),
				);

				const settingsList = new SettingsList(
					items,
					Math.min(items.length + 2, 15),
					getSettingsListTheme(),
					(id, newValue) => {
						// Update enabled state and apply immediately
						if (newValue === "enabled") {
							enabledTools.add(id);
						} else {
							enabledTools.delete(id);
						}
						applyTools();
						persistState(ctx.cwd);
					},
					() => {
						// Close dialog
						done(undefined);
					},
				);

				container.addChild(settingsList);

				const component = {
					render(width: number) {
						return container.render(width);
					},
					invalidate() {
						container.invalidate();
					},
					handleInput(data: string) {
						settingsList.handleInput?.(data);
						tui.requestRender();
					},
				};

				return component;
			});
		},
	});

	// Restore state on session start
	pi.on("session_start", async (_event, ctx) => {
		restoreFromBranch(ctx, ctx.cwd);
	});

	// Restore state when navigating the session tree
	pi.on("session_tree", async (_event, ctx) => {
		restoreFromBranch(ctx, ctx.cwd);
	});
}
