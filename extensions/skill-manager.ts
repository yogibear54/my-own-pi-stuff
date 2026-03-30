/**
 * Skill Manager Extension
 *
 * Provides commands to enable/disable skills in the current session.
 *
 * Commands:
 *   /skill:disable <name>  - Disable a skill (removes from system prompt)
 *   /skill:enable <name>   - Re-enable a disabled skill
 *   /skill:list            - List all skills and their status
 *   /skill:reset           - Re-enable all skills
 */

import type { ExtensionAPI, SlashCommandInfo } from "@mariozechner/pi-coding-agent";

const SKILL_PATTERN = /<skill>\s*<name>([^<]+)<\/name>\s*<description>([^<]*)<\/description>\s*<\/skill>/gs;

export default function skillManagerExtension(pi: ExtensionAPI) {
	// Track disabled skills in memory
	const disabledSkills = new Set<string>();

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

	// Command: /skill:disable <name>
	pi.registerCommand("skill:disable", {
		description: "Disable a skill for the current session",
		getArgumentCompletions: (prefix: string) => {
			const skills = getSkillCommands();
			const available = skills
				.map((s) => parseSkillName(s.name))
				.filter((name) => !disabledSkills.has(name) && name.startsWith(prefix));
			return available.length > 0? available.map((name) => ({ value: name, label: name })) : null;
		},
		handler: async (args: string, ctx) => {
			const skillName = args.trim().toLowerCase();

			if (!skillName) {
				ctx.ui.notify("Usage: /skill:disable <skill-name>", "warning");
				return;
			}

			// Check if skill exists
			const skills = getSkillCommands();
			const skillExists = skills.some(
				(s) => parseSkillName(s.name).toLowerCase() === skillName
			);

			if (!skillExists) {
				ctx.ui.notify(`Skill not found: ${skillName}`, "error");
				return;
			}

			if (disabledSkills.has(skillName)) {
				ctx.ui.notify(`Skill already disabled: ${skillName}`, "warning");
				return;
			}

			disabledSkills.add(skillName);
			ctx.ui.notify(`Disabled skill: ${skillName}\nUse /skill:enable ${skillName} to re-enable`, "info");
		},
	});

	// Command: /skill:enable <name>
	pi.registerCommand("skill:enable", {
		description: "Re-enable a disabled skill",
		getArgumentCompletions: (prefix: string) => {
			const disabled = Array.from(disabledSkills).filter((name) =>
				name.startsWith(prefix)
			);
			return disabled.length > 0? disabled.map((name) => ({ value: name, label: name })) : null;
		},
		handler: async (args: string, ctx) => {
			const skillName = args.trim().toLowerCase();

			if (!skillName) {
				ctx.ui.notify("Usage: /skill:enable <skill-name>", "warning");
				return;
			}

			if (!disabledSkills.has(skillName)) {
				ctx.ui.notify(`Skill is not disabled: ${skillName}`, "warning");
				return;
			}

			disabledSkills.delete(skillName);
			ctx.ui.notify(`Enabled skill: ${skillName}`, "info");
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
				const status = disabledSkills.has(name) ? "[DISABLED]" : "[ENABLED]";
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
		description: "Re-enable all disabled skills",
		handler: async (_args: string, ctx) => {
			const count = disabledSkills.size;
			if (count === 0) {
				ctx.ui.notify("No disabled skills to reset", "info");
				return;
			}

			const skillList = Array.from(disabledSkills).join(", ");
			disabledSkills.clear();
			ctx.ui.notify(`Re-enabled ${count} skill(s): ${skillList}`, "info");
		},
	});

	// Hook: Filter disabled skills from system prompt
	pi.on("before_agent_start", async (event, _ctx) => {
		if (disabledSkills.size === 0) {
			return;
		}

		// Filter out disabled skills from the system prompt
		let systemPrompt = event.systemPrompt;

		// Remove individual skill blocks for disabled skills
		systemPrompt = systemPrompt.replace(SKILL_PATTERN, (match, name) => {
			if (disabledSkills.has(name.toLowerCase())) {
				return ""; // Remove this skill
			}
			return match;
		});

		// Note: We don't remove the entire <available_skills> block,
		// just the individual disabled skills within it

		return { systemPrompt };
	});

	// Hook: Intercept /skill:name commands for disabled skills
	pi.on("input", async (event, ctx) => {
		const text = event.text.trim();

		// Check if this is a skill command
		if (!text.startsWith("/skill:") || text.startsWith("/skill:disable") || text.startsWith("/skill:enable") || text.startsWith("/skill:list") || text.startsWith("/skill:reset")) {
			return { action: "continue" };
		}

		// Parse skill name from command
		const skillName = text.slice(7).split(/\s+/)[0]?.toLowerCase();

		if (skillName && disabledSkills.has(skillName)) {
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
		if (event.toolName !== "read") {
			return;
		}

		if (disabledSkills.size === 0) {
			return;
		}

		// Check if the path is a disabled skill's SKILL.md file
		const path = (event.input as { path?: string })?.path || "";
		const pathLower = path.toLowerCase();

		// Check if this path matches any disabled skill
		for (const skillName of disabledSkills) {
			// Match patterns like:
			// - .../skills/skill-name/SKILL.md
			// - .../.agents/skills/skill-name/SKILL.md
			// - .../.pi/skills/skill-name/SKILL.md
			const skillPatterns = [
				`/skills/${skillName}/skill.md`,
				`/${skillName}/skill.md`,
				`/skills/${skillName}/`,
				`/${skillName}/skill.md`,
			];

			for (const pattern of skillPatterns) {
				if (pathLower.includes(pattern)) {
					return {
						block: true,
						reason: `Skill "${skillName}" is disabled. Use /skill:enable ${skillName} to re-enable it.`,
					};
				}
			}
		}
	});
}