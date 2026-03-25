/**
 * Review Command Extension
 *
 * Registers a /review command that performs code reviews in the current pi session.
 * Analyzes code for bugs, security issues, and error handling gaps.
 *
 * Usage:
 *   /review <file-or-directory>          # Review a specific file or directory
 *   /review --model claude-sonnet-4 file   # Use specific model (skips prompt)
 *   /review --provider anthropic file      # Use specific provider (skips prompt)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";
import {
	Container,
	Input,
	Key,
	matchesKey,
	SelectList,
	Spacer,
	Text,
} from "@mariozechner/pi-tui";

const REVIEW_PROMPT = `You are a code reviewer. Your task is to analyze the provided code for:

1. **Bugs and Logic Errors**: Look for off-by-one errors, race conditions, infinite loops, null dereferences, incorrect operator usage, unreachable code, etc.

2. **Security Issues**: Identify injection vulnerabilities (SQL, command, XSS), authentication/authorization flaws, insecure data handling, hardcoded secrets, improper input validation, etc.

3. **Error Handling Gaps**: Look for missing try-catch blocks, unhandled promise rejections, missing null checks, silent failures, improper resource cleanup, etc.

Instructions:
- Read the file(s) specified by the user using the read tool.
- Thoroughly analyze the code structure, logic, and patterns.
- Report each issue found with:
  - The file path and line number
  - A description of the issue
  - The severity (critical / high / medium / low)
  - A suggested fix if applicable

If no issues are found, clearly state it. Be thorough but concise.`;

export default function reviewExtension(pi: ExtensionAPI) {
	pi.registerCommand("review", {
		description: "Review code for bugs, security issues, and error handling gaps",
		handler: async (args, ctx) => {
			const argParts = args.trim().split(/\s+/);

			// Parse optional flags
			let modelId: string | undefined;
			let provider: string | undefined;
			const paths: string[] = [];

			for (let i = 0; i < argParts.length; i++) {
				const part = argParts[i];
				if (part === "--model" && i + 1 < argParts.length) {
					modelId = argParts[++i];
				} else if (part === "--provider" && i + 1 < argParts.length) {
					provider = argParts[++i];
				} else if (!part.startsWith("--")) {
					paths.push(part);
				}
			}

			const target = paths.join(" ") || ".";

			ctx.ui.notify(`🔍 Starting code review for: ${target}`, "info");

			const originalModel = ctx.model;

			if (modelId || provider) {
				let targetModel = modelId
					? ctx.modelRegistry.find(provider || originalModel?.provider || "anthropic", modelId)
					: undefined;

				if (!targetModel && provider && !modelId) {
					const available = await ctx.modelRegistry.getAvailable();
					targetModel = available.find(m => m.provider === provider);
				}

				if (targetModel) {
					const success = await pi.setModel(targetModel);
					if (success) {
						ctx.ui.notify(`Switched to model: ${targetModel.provider}/${targetModel.id}`, "info");
					} else {
						ctx.ui.notify(`⚠️ No API key available for ${targetModel.provider}/${targetModel.id}, using current model`, "warning");
					}
				} else {
					ctx.ui.notify(`⚠️ Model not found: ${provider || ""}${modelId ? "/" + modelId : ""}, using current model`, "warning");
				}
			} else {
				const currentModelName = originalModel
					? `${originalModel.provider}/${originalModel.id}`
					: "default model";

				const switchChoice = await ctx.ui.select(
					`Review using current model (${currentModelName}) or switch?`,
					[
						`Keep current model (${currentModelName})`,
						"Switch to a different model",
					]
				);

				if (switchChoice === "Switch to a different model") {
					const available = await ctx.modelRegistry.getAvailable();

					if (available.length === 0) {
						ctx.ui.notify("No other models available with configured API keys", "warning");
					} else {
						const selectedModel = await showModelPicker(ctx, available);
						if (selectedModel) {
							const success = await pi.setModel(selectedModel);
							if (success) {
								ctx.ui.notify(`Switched to model: ${selectedModel.provider}/${selectedModel.id}`, "info");
							} else {
								ctx.ui.notify(`Failed to switch to ${selectedModel.provider}/${selectedModel.id}`, "error");
							}
						}
					}
				}
			}

			const fullPrompt = `${REVIEW_PROMPT}\n\nPlease review: ${target}`;
			pi.sendUserMessage(fullPrompt);
		},
	});
}

/**
 * Shows a searchable model picker similar to pi's built-in model selector
 */
async function showModelPicker(
	ctx: { ui: any; theme: any },
	available: Model[]
): Promise<Model | null> {
	return ctx.ui.custom<Model | null>((tui, theme, _keybindings, done) => {
		// Create container
		const container = new Container();

		// Build select items from models
		const items = available.map(model => ({
			value: `${model.provider}/${model.id}`,
			label: `${model.provider}/${model.id}`,
			description: model.name || undefined,
		}));

		// Theme for select list
		const selectListTheme = {
			selectedPrefix: (t: string) => theme.fg("accent", t),
			selectedText: (t: string) => theme.fg("accent", t),
			description: (t: string) => theme.fg("muted", t),
			scrollInfo: (t: string) => theme.fg("dim", t),
			noMatch: (t: string) => theme.fg("warning", t),
		};

		// Create select list
		const selectList = new SelectList(items, 12, selectListTheme);

		// Create search input
		const searchInput = new Input(
			"",
			(s: string) => theme.fg("accent", s),
			(s: string) => theme.bg("selectedBg", s)
		);

		// Header text
		const headerText = new Text(
			theme.fg("accent", "Select a model for code review"),
			0,
			0
		);

		// Instructions text
		const instructionsText = new Text(
			theme.fg("dim", "Type to search • ↑↓ navigate • Enter select • Esc cancel"),
			0,
			0
		);

		// Search label
		const searchLabel = new Text(theme.fg("text", "Search: "), 0, 0);

		// Create a container for search row
		const searchContainer = new Container();
		searchContainer.addChild(searchLabel);
		searchContainer.addChild(searchInput);

		// Add spacer
		const spacer = new Spacer(1);

		// Assemble main container
		container.addChild(headerText);
		container.addChild(spacer);
		container.addChild(searchContainer);
		container.addChild(spacer);
		container.addChild(selectList);
		container.addChild(spacer);
		container.addChild(instructionsText);

		// Handle input
		function handleInput(data: string) {
			// Handle escape
			if (matchesKey(data, Key.escape)) {
				done(null);
				return;
			}

			// Handle enter to select
			if (matchesKey(data, Key.enter)) {
				const selected = selectList.getSelectedItem();
				if (selected) {
					const selectedModel = available.find(
						m => `${m.provider}/${m.id}` === selected.value
					);
					done(selectedModel || null);
				}
				return;
			}

			// Handle up/down for select list navigation
			if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
				selectList.handleInput(data);
				tui.requestRender();
				return;
			}

			// Route all other input to the search input
			searchInput.handleInput(data);
			selectList.setFilter(searchInput.getValue());
			tui.requestRender();
		}

		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput,
		};
	});
}
