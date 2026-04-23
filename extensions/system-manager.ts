/**
 * System Manager Extension
 *
 * Provides a /system command to enable/disable skills, extensions, utils,
 * and root config files via symbolic links between agent-git/ and agent/.
 *
 * Source: ~/.pi/agent-git/{category}/item
 * Target: ~/.pi/agent/{category}/item  (symlink)
 *
 * Items marked with ✓ are symlinked (active), items with ✗ are not (inactive).
 * Selecting an item toggles its symlink state.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getSettingsListTheme } from "@mariozechner/pi-coding-agent";
import {
	Container,
	type SettingItem,
	SettingsList,
	Spacer,
	Text,
} from "@mariozechner/pi-tui";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	symlinkSync,
	unlinkSync,
} from "node:fs";
import { join } from "node:path";

const HOME = process.env.HOME || "/root";
const AGENT_GIT = join(HOME, ".pi", "agent-git");
const AGENT = join(HOME, ".pi", "agent");

// Root files that should NOT be linkable
const ROOT_EXCLUDE = new Set([
	".gitignore",
	"package.json",
	"package-lock.json",
	".gitmodules",
]);

interface Category {
	name: string;
	sourceDir: string;
	targetDir: string;
	type: "file" | "dir" | "mixed";
}

const CATEGORIES: Category[] = [
	{
		name: "Root Config Files",
		sourceDir: AGENT_GIT,
		targetDir: AGENT,
		type: "file",
	},
	{
		name: "Extensions",
		sourceDir: join(AGENT_GIT, "extensions"),
		targetDir: join(AGENT, "extensions"),
		type: "mixed", // both .ts files and directories
	},
	{
		name: "Skills",
		sourceDir: join(AGENT_GIT, "skills"),
		targetDir: join(AGENT, "skills"),
		type: "dir",
	},
	{
		name: "Utils",
		sourceDir: join(AGENT_GIT, "utils"),
		targetDir: join(AGENT, "utils"),
		type: "file",
	},
];

function getItems(category: Category): string[] {
	if (!existsSync(category.sourceDir)) return [];

	const entries = readdirSync(category.sourceDir, { withFileTypes: true });

	if (category.type === "dir") {
		return entries
			.filter((d) => d.isDirectory() && !d.name.startsWith("."))
			.map((d) => d.name)
			.sort();
	}

	if (category.type === "mixed") {
		return entries
			.filter(
				(d) =>
					!d.name.startsWith(".") &&
					(d.isDirectory() || d.name.endsWith(".ts")),
			)
			.map((d) => d.name)
			.sort();
	}

	// "file" type
	return entries
		.filter(
			(d) =>
				d.isFile() &&
				!d.name.startsWith(".") &&
				!ROOT_EXCLUDE.has(d.name),
		)
		.map((d) => d.name)
		.sort();
}

function isActive(category: Category, item: string): boolean {
	const target = join(category.targetDir, item);
	try {
		const stat = lstatSync(target);
		return stat.isSymbolicLink();
	} catch {
		return false;
	}
}

function toggleLink(category: Category, item: string): boolean {
	const target = join(category.targetDir, item);
	const source = join(category.sourceDir, item);

	// Ensure target directory exists
	if (!existsSync(category.targetDir)) {
		mkdirSync(category.targetDir, { recursive: true });
	}

	if (isActive(category, item)) {
		// Deactivate: remove symlink
		try {
			unlinkSync(target);
			return false;
		} catch {
			return true;
		}
	} else {
		// Don't overwrite real files
		if (existsSync(target)) {
			const stat = lstatSync(target);
			if (!stat.isSymbolicLink()) return false;
		}
		// Activate: create symlink
		try {
			symlinkSync(source, target);
			return true;
		} catch {
			return false;
		}
	}
}

export default function systemManager(pi: ExtensionAPI) {
	pi.registerCommand("system", {
		description: "Manage skills, extensions, utils, and root config symlinks",
		handler: async (_args, ctx) => {
			// Build the items for all categories
			interface ItemInfo {
				category: Category;
				name: string;
				active: boolean;
			}

			const allItems: ItemInfo[] = [];

			for (const cat of CATEGORIES) {
				const items = getItems(cat);
				for (const item of items) {
					allItems.push({
						category: cat,
						name: item,
						active: isActive(cat, item),
					});
				}
			}

			if (allItems.length === 0) {
				ctx.ui.notify("No items found in agent-git/", "warning");
				return;
			}

			await ctx.ui.custom<void>((tui, theme, _kb, done) => {
				function buildSettingItems(): SettingItem[] {
					const result: SettingItem[] = [];

					// ── ENABLED ──
					result.push({
						id: "__header__enabled",
						label: theme.fg("success", theme.bold("[ENABLED]")),
						currentValue: "",
						values: [],
					});

					for (const cat of CATEGORIES) {
						const enabled = allItems.filter(
							(i) => i.category.name === cat.name && i.active,
						);

						result.push({
							id: `__sub__${cat.name}__enabled`,
							label: theme.fg("muted", `  ${cat.name}:`),
							currentValue: "",
							values: [],
						});

						if (enabled.length === 0) {
							result.push({
								id: `__empty__${cat.name}__enabled`,
								label: theme.fg("dim", "      (none)"),
								currentValue: "",
								values: [],
							});
						} else {
							for (const item of enabled) {
								result.push({
									id: `${item.category.name}::${item.name}`,
									label: `      ${item.name}`,
									currentValue: "active",
									values: ["active", "inactive"],
								});
							}
						}
					}

					// ── DISABLED ──
					result.push({
						id: "__header__disabled",
						label: theme.fg("error", theme.bold("[DISABLED]")),
						currentValue: "",
						values: [],
					});

					for (const cat of CATEGORIES) {
						const disabled = allItems.filter(
							(i) => i.category.name === cat.name && !i.active,
						);

						result.push({
							id: `__sub__${cat.name}__disabled`,
							label: theme.fg("muted", `  ${cat.name}:`),
							currentValue: "",
							values: [],
						});

						if (disabled.length === 0) {
							result.push({
								id: `__empty__${cat.name}__disabled`,
								label: theme.fg("dim", "      (none)"),
								currentValue: "",
								values: [],
							});
						} else {
							for (const item of disabled) {
								result.push({
									id: `${item.category.name}::${item.name}`,
									label: `      ${item.name}`,
									currentValue: "inactive",
									values: ["active", "inactive"],
								});
							}
						}
					}

					return result;
				}

				const container = new Container();

				// Title
				container.addChild(
					new Text(
						theme.fg("accent", theme.bold("  System Manager")),
						1,
						0,
					),
				);
				container.addChild(
					new Text(
						theme.fg("muted", "  Toggle symlinks: agent-git/ → agent/"),
						1,
						0,
					),
				);
				container.addChild(new Spacer(1));

				// We need to rebuild the entire list on toggle since items move between sections
				const settingsList = new SettingsList(
					buildSettingItems(),
					Math.min(allItems.length + 12, 30),
					getSettingsListTheme(),
					(id, _newValue) => {
						// Skip headers, sub-headers, and empty placeholders
						if (id.startsWith("__")) return;

						const sepIdx = id.indexOf("::");
						if (sepIdx === -1) return;
						const catName = id.substring(0, sepIdx);
						const itemName = id.substring(sepIdx + 2);
						const category = CATEGORIES.find(
							(c) => c.name === catName,
						);
						if (!category) return;

						const found = allItems.find(
							(i) =>
								i.category.name === catName &&
								i.name === itemName,
						);
						if (!found) return;

						const nowActive = toggleLink(category, itemName);
						found.active = nowActive;

						// Update in place — no rebuild, no jumping
						settingsList.updateValue(
							id,
							nowActive ? "active" : "inactive",
						);

						const notifyMsg = nowActive
							? `✓ Linked ${itemName}`
							: `✗ Unlinked ${itemName}`;
						ctx.ui.notify(notifyMsg, "info");
					},
					() => {
						done(undefined);
					},
				);

				container.addChild(settingsList);

				// Help text
				container.addChild(new Spacer(1));
				container.addChild(
					new Text(
						theme.fg(
							"dim",
							"  ↑↓ navigate • enter toggle • esc close",
						),
						1,
						0,
					),
				);

				return {
					render(w: number) {
						return container.render(w);
					},
					invalidate() {
						container.invalidate();
					},
					handleInput(data: string) {
						settingsList.handleInput?.(data);
						tui.requestRender();
					},
				};
			});
		},
	});
}
