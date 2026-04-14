/**
 * Skill Manager Extension
 *
 * Provides commands to manage skills interactively.
 * Persists enabled skills to skills-config.json (project-level or global).
 * Uses "enabled" list: only skills in this list are active.
 * If "enabled" key doesn't exist, all skills are enabled (default behavior).
 *
 * Commands:
 *   /skills             - Open interactive skill selector
 *   /skill:list         - List all skills and their status
 *   /skill:reset        - Re-enable all skills (remove config)
 */

import type { ExtensionAPI, ExtensionContext, SlashCommandInfo } from "@mariozechner/pi-coding-agent";
import { getSettingsListTheme } from "@mariozechner/pi-coding-agent";
import { Container, type SettingItem, SettingsList } from "@mariozechner/pi-tui";
import { loadConfig, saveConfig, GLOBAL_CONFIG_DIR } from "../utils/config-utils";

const SKILL_CONFIG_NAME = "skills-config.json";
const SKILL_PATTERN = /<skill>\s*<name>([^<]+)<\/name>\s*<description>([^<]*)<\/description>\s*<\/skill>/gs;

export default function skillManagerExtension(pi: ExtensionAPI) {
	// Track enabled skills (from config)
	let enabledSkills: Set<string> = new Set();
	// Track whether we're in "whitelist mode" (config exists with enabled list)
	let isWhitelistMode = false;

	// Load enabled skills from config
	function loadEnabledSkills(cwd: string = process.cwd()): void {
		const config = loadConfig(SKILL_CONFIG_NAME, cwd);
		if (config && Array.isArray(config.enabled)) {
			isWhitelistMode = true;
			enabledSkills = new Set(config.enabled.map((s) => s.toLowerCase()));
		} else {
			// No config or no enabled list - all skills enabled by default
			isWhitelistMode = false;
			enabledSkills = new Set();
		}
	}

	// Persist enabled skills to config
	function persistEnabledSkills(cwd: string = process.cwd()): void {
		if (isWhitelistMode) {
			saveConfig(SKILL_CONFIG_NAME, { enabled: Array.from(enabledSkills) }, cwd);
		}
	}

	// Check if a skill is enabled
	function isSkillEnabled(skillName: string): boolean {
		const name = skillName.toLowerCase();
		if (isWhitelistMode) {
			return enabledSkills.has(name);
		}
		// Default: all enabled except those explicitly disabled
		return !enabledSkills.has(name);
	}

	// Get all skill commands available
	function getSkillCommands(): SlashCommandInfo[] {
		const commands = pi.getCommands();
		return commands.filter((cmd) => cmd.source === "skill");
	}

	// Parse skill name from a skill command name (e.g., "skill:frontend-design" -> "frontend-design")
	function parseSkillName(commandName: string): string {
		if (commandName.startsWith("skill:")) {
			return commandName.slice(6);
		}
		return commandName;
	}

	// Command: /skills - interactive skill selector
	pi.registerCommand("skills", {
		description: "Enable/disable skills interactively",
		handler: async (_args, ctx) => {
			// Refresh skill list
			const skillCommands = getSkillCommands();

			await ctx.ui.custom((tui, theme, _kb, done) => {
				// Build settings items for each skill
				const items: SettingItem[] = skillCommands.map((cmd) => {
					const name = parseSkillName(cmd.name);
					return {
						id: name,
						label: name,
						description: cmd.description,
						currentValue: isSkillEnabled(name) ? "enabled" : "disabled",
						values: ["enabled", "disabled"],
					};
				});

				const container = new Container();
				container.addChild(
					new (class {
						render(_width: number) {
							return [theme.fg("accent", theme.bold("Skill Configuration")), ""];
						}
						invalidate() {}
					})(),
				);

				const settingsList = new SettingsList(
					items,
					Math.min(items.length + 2, 15),
					getSettingsListTheme(),
					(id, newValue) => {
						const skillName = id.toLowerCase();
						const wasEnabled = isSkillEnabled(skillName);

						if (newValue === "enabled" && !wasEnabled) {
							// Enabling: switch to whitelist mode if not already
							if (!isWhitelistMode) {
								isWhitelistMode = true;
								// Build enabled list from all skills minus the one being disabled
								const allSkillNames = skillCommands.map((s) => parseSkillName(s.name).toLowerCase());
								enabledSkills = new Set(allSkillNames);
							}
							enabledSkills.add(skillName);
						} else if (newValue === "disabled" && wasEnabled) {
							// Disabling: switch to whitelist mode if not already
							if (!isWhitelistMode) {
								isWhitelistMode = true;
								const allSkillNames = skillCommands.map((s) => parseSkillName(s.name).toLowerCase());
								enabledSkills = new Set(allSkillNames.filter((n) => n !== skillName));
							} else {
								enabledSkills.delete(skillName);
							}
						}

						persistEnabledSkills(ctx.cwd);
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

	// Command: /skill:list
	pi.registerCommand("skill:list", {
		description: "List all skills and their status",
		handler: async (_args: string, ctx) => {
			const skills = getSkillCommands();

			if (skills.length === 0) {
				ctx.ui.notify("No skills available", "info");
				return;
			}

			const skillNames = skills.map((s) => parseSkillName(s.name)).sort();
			const items: string[] = [];

			for (const name of skillNames) {
				const status = isSkillEnabled(name) ? "[ENABLED]" : "[DISABLED]";
				const skill = skills.find((s) => parseSkillName(s.name) === name);
				const desc = skill?.description ? ` - ${skill.description}` : "";
				items.push(`${status} ${name}${desc}`);
			}

			// Group by status for clarity
			const enabled = items.filter((i) => !i.startsWith("[DISABLED]"));
			const disabled = items.filter((i) => i.startsWith("[DISABLED]"));

			const displayItems: string[] = [];
			if (enabled.length > 0) {
				displayItems.push("--- Enabled ---");
				displayItems.push(...enabled);
			}
			if (disabled.length > 0) {
				displayItems.push("--- Disabled ---");
				displayItems.push(...disabled);
			}

			await ctx.ui.select("Skills Status", displayItems);
		},
	});

	// Command: /skill:reset
	pi.registerCommand("skill:reset", {
		description: "Re-enable all skills (removes config file)",
		handler: async (_args: string, ctx) => {
			// Reset to default: all skills enabled
			isWhitelistMode = false;
			enabledSkills.clear();
			persistEnabledSkills(ctx.cwd);
			ctx.ui.notify("All skills enabled (config removed)", "info");
		},
	});

	// Hook: Filter disabled skills from system prompt
	pi.on("before_agent_start", async (event, _ctx) => {
		if (!isWhitelistMode) {
			// Default mode: all enabled, nothing to filter
			return;
		}

		// Whitelist mode: only include enabled skills
		let systemPrompt = event.systemPrompt;

		systemPrompt = systemPrompt.replace(SKILL_PATTERN, (match, name) => {
			if (!enabledSkills.has(name.toLowerCase())) {
				return ""; // Remove this skill
			}
			return match;
		});

		return { systemPrompt };
	});

	// Hook: Intercept /skill:name commands for disabled skills
	pi.on("input", async (event, ctx) => {
		const text = event.text.trim();

		// Check if this is a skill command
		if (!text.startsWith("/skill:") && !text.startsWith("/skills")) {
			return { action: "continue" };
		}

		// Skip our built-in commands
		if (text.startsWith("/skills") || text.startsWith("/skill:list") || text.startsWith("/skill:reset")) {
			return { action: "continue" };
		}

		// Parse skill name from command
		const skillName = text.slice(7).split(/\s+/)[0]?.toLowerCase();

		if (skillName && isWhitelistMode && !enabledSkills.has(skillName)) {
			ctx.ui.notify(
				`Skill "${skillName}" is disabled. Use /skill:enable ${skillName} to re-enable.`,
				"warning"
			);
			return { action: "handled" };
		}

		return { action: "continue" };
	});

	// Hook: Block reading disabled skill files via the read tool
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "read" || !isWhitelistMode) {
			return;
		}

		// Check if the path is a disabled skill's SKILL.md file
		const path = (event.input as { path?: string })?.path || "";
		const pathLower = path.toLowerCase();

		// Check if this path matches any enabled skill (block if not in enabled list)
		for (const skillName of enabledSkills) {
			const skillPatterns = [
				`/skills/${skillName}/skill.md`,
				`/${skillName}/skill.md`,
				`/skills/${skillName}/`,
			];

			for (const pattern of skillPatterns) {
				if (pathLower.includes(pattern)) {
					return; // This skill is enabled, allow
				}
			}
		}

		// Path doesn't match any enabled skill - check if it's a skill file at all
		const skillCommands = getSkillCommands();
		for (const cmd of skillCommands) {
			const skillName = parseSkillName(cmd.name).toLowerCase();
			if (pathLower.includes(`/${skillName}/`) || pathLower.includes(`/skills/${skillName}/`)) {
				return {
					block: true,
					reason: `Skill "${skillName}" is disabled. Use /skills to enable it.`,
				};
			}
		}
	});

	// Restore state on session start
	pi.on("session_start", async (_event, ctx) => {
		loadEnabledSkills(ctx.cwd);
	});

	// Restore state when navigating the session tree
	pi.on("session_tree", async (_event, ctx) => {
		loadEnabledSkills(ctx.cwd);
	});
}
