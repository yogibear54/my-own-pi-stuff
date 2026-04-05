/**
 * Tutorial Configuration Tool
 *
 * Tool for gathering requirements and creating tutorial configuration.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildTutorialPrompt } from "../config/requirements";
import { CHAPTERS_FILENAME } from "../constants";
import { resolveDirectoryReference } from "../path-utils";
import type { TutorialConfig } from "../types";

/**
 * Register the configure_tutorial tool
 */
export function registerConfigureTutorialTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "configure_tutorial",
		label: "Configure Tutorial",
		description: "Gather requirements for creating a codebase tutorial. Use the 'tutorialDir' parameter to specify where tutorial files will be created. Call this tool when you have gathered all requirements from the user.",
		parameters: Type.Object({
			tutorialDir: Type.String(),
			sourceDir: Type.String(),
			projectName: Type.String(),
			audience: Type.String(),
			goals: Type.Array(Type.String()),
			scope: Type.Union([
				Type.Literal("overview"),
				Type.Literal("detailed"),
				Type.Literal("comprehensive"),
			]),
			includeQuizzes: Type.Boolean(),
			includeDiagrams: Type.Boolean(),
			techStack: Type.Union([
				Type.Literal("react"),
				Type.Literal("vue"),
				Type.Literal("svelte"),
				Type.Literal("html"),
				Type.Literal("markdown"),
			]),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			// Validate required params
			if (!params.tutorialDir) {
				return {
					content: [{
						type: "text",
						text: "Error: tutorialDir is required. Please specify the directory where tutorial files should be created.",
					}],
					details: { cancelled: true, error: "Missing tutorialDir" },
				};
			}

			// Build config
			const config: TutorialConfig = {
				tutorialDir: resolveDirectoryReference(params.tutorialDir, ctx.cwd),
				sourceDir: params.sourceDir
					? resolveDirectoryReference(params.sourceDir, ctx.cwd)
					: ctx.cwd,
				projectName: params.projectName || inferProjectName(resolveDirectoryReference(params.tutorialDir, ctx.cwd)),
				audience: params.audience || "Developers familiar with JavaScript but new to TypeScript",
				goals: params.goals || ["Navigate the codebase", "Understand architecture patterns"],
				scope: params.scope || "detailed",
				includeQuizzes: params.includeQuizzes ?? true,
				includeDiagrams: params.includeDiagrams ?? true,
				techStack: params.techStack || "markdown",
			};

			// Build the prompt for the LLM
			const prompt = buildTutorialPrompt(config);

			// Create todos to track tutorial creation progress
			const todoResult = await createTutorialTodos(pi, config, ctx);

			// Build the response text
			let responseText = `Tutorial configuration complete. Now analyze the codebase and create a SKELETON tutorial (Pass 1).

The skeleton will be expanded with detailed content in Pass 2 via \`/tutorial:deep-dive\`.

Configuration:
- Target: ${config.tutorialDir}
- Source: ${config.sourceDir}
- Project: ${config.projectName}
- Audience: ${config.audience}
- Scope: ${config.scope}
- Quizzes: ${config.includeQuizzes ? "Yes" : "No"}
- Diagrams: ${config.includeDiagrams ? "Yes" : "No"}
- Tech Stack: ${config.techStack}`;

			if (todoResult.created) {
				responseText += `\n\nTodo tracking: ${todoResult.message}`;
			}

			responseText += `\n\nBegin by exploring the source codebase structure. Then create the tutorial following the requirements below.\n\n---\n\n${prompt}`;

			// Return and let LLM continue with the prompt
			return {
				content: [{
					type: "text",
					text: responseText,
				}],
				details: { config, prompt, todos: todoResult },
			};
		},

		renderCall(args, theme) {
			const target = args.tutorialDir as string || "(unset)";
			const source = args.sourceDir as string || "(cwd)";
			const project = args.projectName as string || "(unnamed)";
			return {
				render(_width: number) {
					return [
						theme.fg("toolTitle", theme.bold("configure_tutorial")),
						`  Target: ${target}`,
						`  Source: ${source}`,
						`  Project: ${project}`,
					];
				},
			};
		},

		renderResult(result, _options, theme) {
			const details = result.details as { config?: TutorialConfig } | undefined;
			if (!details?.config) {
				return {
					render(_width: number) {
						return [theme.fg("error", "Failed to configure tutorial")];
					},
				};
			}

			const { config } = details;
			return {
				render(_width: number) {
					return [
						theme.fg("success", "✓ Tutorial configured"),
						`  Target: ${config.tutorialDir}`,
						`  Source: ${config.sourceDir}`,
						`  Scope: ${config.scope}`,
						`  Stack: ${config.techStack}`,
					];
				},
			};
		},
	});
}

/**
 * Infer project name from directory path
 */
function inferProjectName(dir: string): string {
	const parts = dir.replace(/\/$/, "").split("/");
	const name = parts[parts.length - 1] || "project";
	return name
		.replace(/-tutorial$|-walkthrough$|-docs$/, "")
		.replace(/_tutorial$|_walkthrough$|_docs$/, "") || "project";
}

/**
 * Create todo tracking for tutorial creation
 */
async function createTutorialTodos(
	_pi: ExtensionAPI,
	config: TutorialConfig,
	ctx: ExtensionContext
): Promise<{
	created: boolean;
	message: string;
	todos?: Array<{ id: string; title: string }>;
	todoPath?: string;
}> {
	const todoItems = generateTodoItems(config);

	// Try to use the .pi/todos directory (compatible with todos extension)
	try {
		const todosDir = path.resolve(ctx.cwd, ".pi/todos");

		// Ensure the todos directory exists
		await mkdir(todosDir, { recursive: true });

		const createdTodos: Array<{ id: string; title: string }> = [];

		for (const item of todoItems) {
			const id = await generateTodoId(todosDir);
			const todo: TodoFile = {
				id,
				title: item.title,
				tags: item.tags,
				status: "open",
				created_at: new Date().toISOString(),
				body: item.body,
			};

			await createTodoFile(todosDir, id, todo);
			createdTodos.push({ id: `TODO-${id.toUpperCase()}`, title: item.title });
		}

		return {
			created: true,
			message: `Created ${createdTodos.length} todos in .pi/todos to track progress`,
			todos: createdTodos,
		};
	} catch (error) {
		// If .pi/todos fails, fall back to TODO.md
	}

	// Fall back to TODO.md file in the target directory
	try {
		const todoPath = path.resolve(ctx.cwd, config.tutorialDir, "TODO.md");
		const todoDir = path.dirname(todoPath);

		// Ensure the target directory exists
		if (!existsSync(todoDir)) {
			await mkdir(todoDir, { recursive: true });
		}

		const content = buildTodoMdContent(todoItems, config);
		await writeFile(todoPath, content, "utf-8");

		return {
			created: true,
			message: `Created TODO.md at ${todoPath} to track progress`,
			todoPath,
		};
	} catch (error) {
		return {
			created: false,
			message: `Note: Could not create todo tracking: ${error instanceof Error ? error.message : "unknown error"}`,
		};
	}
}

/**
 * Generate todo items based on tutorial configuration
 */
function generateTodoItems(config: TutorialConfig): TodoItem[] {
	const items: TodoItem[] = [
		{
			title: "Explore source codebase structure",
			tags: ["tutorial", "setup"],
			body: "Analyze the directory structure, identify main modules, and understand the architecture pattern (clean architecture, MVC, modular, etc.) of the source codebase.",
		},
		{
			title: "Create tutorial project scaffold",
			tags: ["tutorial", "setup"],
			body: config.techStack === "markdown"
				? `Set up a markdown-based tutorial in ${config.tutorialDir}. Create an INDEX.md with an auto-generated table of contents that links to all chapter markdown files. Each chapter will be a separate .md file. `
				: `Set up the ${config.techStack} project in ${config.tutorialDir} with Vite, TypeScript, prism-react-renderer (vsLight theme), navigation, and progress tracking.`,
		},
		{
			title: "Create skeleton chapters with file references",
			tags: ["tutorial", "content"],
			body: config.techStack === "markdown"
				? "Create thin markdown chapters (Chapter1.md, Chapter2.md, etc.) with title, 1-2 paragraph overview, and file references. Use relative links in each chapter to link back to the INDEX.md."
				: "Create thin chapter content: title, 1-2 paragraph overview, and file references. Each chapter should have a deep-dive placeholder. DO NOT write detailed walkthroughs yet.",
		},
		{
			title: "Generate chapters index with config",
			tags: ["tutorial", "setup"],
			body: `Create a ${CHAPTERS_FILENAME} file that maps each chapter to its source files AND includes the tutorial config (sourceDir, audience, goals, scope, etc.). This enables /tutorial:deep-dive for expansion and /tutorial:update for drift detection.`,
		},
	];

	// Add scope-specific todos
	if (config.scope === "comprehensive") {
		items.push({
			title: "Create skeleton for all modules",
			tags: ["tutorial", "content"],
			body: "Create skeleton entries for every major module, ensuring complete file coverage.",
		});
	} else {
		items.push({
			title: "Create skeleton for key modules",
			tags: ["tutorial", "content"],
			body: "Create skeleton entries for the most important modules and their file references.",
		});
	}

	// Add data flow chapter
	items.push({
		title: "Create data flow skeleton",
		tags: ["tutorial", "content"],
		body: "Create a skeleton for the data flow chapter with surface-level description and relevant file references.",
	});

	// Add TypeScript patterns
	items.push({
		title: "Create TypeScript patterns skeleton",
		tags: ["tutorial", "content"],
		body: "Create a skeleton for the TypeScript patterns chapter noting key types and interfaces.",
	});

	// Add README generation todo
	items.push({
		title: "Create project README",
		tags: ["tutorial", "setup"],
		body: `Create a README.md file with Project Details (Source Project, Source Location, Based On Commit, Status: Skeleton), Table of Contents, and Update History (version 0.1.0).`,
	});

	// Add deep-dive reminder
	items.push({
		title: "Run /tutorial:deep-dive for Pass 2",
		tags: ["tutorial", "setup"],
		body: `After the skeleton is complete, run /tutorial:deep-dive ${config.tutorialDir || "<tutorial-dir>"} to expand chapters with detailed analysis, code walkthroughs, quizzes, and diagrams.`,
	});

	// Add progress tracking
	items.push({
		title: "Implement progress tracking",
		tags: ["tutorial", "ui"],
		body: "Add localStorage-based progress tracking, completion indicators, and 'continue where you left off' functionality.",
	});

	// Add testing todo
	items.push({
		title: "Test tutorial build and run",
		tags: ["tutorial", "qa"],
		body: "Verify the tutorial project builds correctly and runs without errors. Test all navigation and interactive features.",
	});

	return items;
}

/**
 * Generate a unique todo ID
 */
async function generateTodoId(todosDir: string): Promise<string> {
	for (let attempt = 0; attempt < 10; attempt += 1) {
		const id = randomBytes(4).toString("hex");
		const todoPath = path.join(todosDir, `${id}.md`);
		if (!existsSync(todoPath)) return id;
	}
	throw new Error("Failed to generate unique todo id");
}

/**
 * Serialize a todo to markdown format
 */
function serializeTodo(todo: TodoFile): string {
	const frontMatter = JSON.stringify(
		{
			id: todo.id,
			title: todo.title,
			tags: todo.tags,
			status: todo.status,
			created_at: todo.created_at,
		},
		null,
		2,
	);
	const body = todo.body.trim();
	if (!body) return `${frontMatter}\n`;
	return `${frontMatter}\n\n${body}\n`;
}

/**
 * Create a todo file
 */
async function createTodoFile(todosDir: string, id: string, todo: TodoFile): Promise<void> {
	const filePath = path.join(todosDir, `${id}.md`);
	await writeFile(filePath, serializeTodo(todo), "utf8");
}

/**
 * Build TODO.md content
 */
function buildTodoMdContent(items: TodoItem[], config: TutorialConfig): string {
	const lines: string[] = [
		`# Tutorial Creation Progress: ${config.projectName}`,
		"",
		"> This TODO.md tracks the progress of tutorial creation. Mark items as complete as you work through them.",
		"> Use `[x]` to mark items complete and `[ ]` for pending items.",
		"",
		"## Overview",
		"",
		`- **Target Directory**: ${config.tutorialDir}`,
		`- **Source Codebase**: ${config.sourceDir}`,
		`- **Target Audience**: ${config.audience}`,
		`- **Scope**: ${config.scope}`,
		`- **Tech Stack**: ${config.techStack}`,
		`- **Include Quizzes**: ${config.includeQuizzes ? "Yes" : "No"}`,
		`- **Include Diagrams**: ${config.includeDiagrams ? "Yes" : "No"}`,
		"",
		"## Tasks",
		"",
	];

	// Group by tag
	const groups: Record<string, TodoItem[]> = {};
	for (const item of items) {
		for (const tag of item.tags) {
			if (!groups[tag]) groups[tag] = [];
			groups[tag].push(item);
		}
	}

	// Track which items we've already added
	const addedItems = new Set<string>();

	// Add setup tasks first
	if (groups["setup"]) {
		lines.push("### Setup");
		lines.push("");
		for (const item of groups["setup"]) {
			if (addedItems.has(item.title)) continue;
			addedItems.add(item.title);
			lines.push(`- [ ] **${item.title}**`);
			lines.push(`  ${item.body}`);
			lines.push("");
		}
	}

	// Add content tasks
	if (groups["content"]) {
		lines.push("### Content");
		lines.push("");
		for (const item of groups["content"]) {
			if (addedItems.has(item.title)) continue;
			addedItems.add(item.title);
			lines.push(`- [ ] **${item.title}**`);
			lines.push(`  ${item.body}`);
			lines.push("");
		}
	}

	// Add UI tasks
	if (groups["ui"]) {
		lines.push("### UI & Interactive");
		lines.push("");
		for (const item of groups["ui"]) {
			if (addedItems.has(item.title)) continue;
			addedItems.add(item.title);
			lines.push(`- [ ] **${item.title}**`);
			lines.push(`  ${item.body}`);
			lines.push("");
		}
	}

	// Add interactive tasks
	if (groups["interactive"]) {
		lines.push("### Interactive Features");
		lines.push("");
		for (const item of groups["interactive"]) {
			if (addedItems.has(item.title)) continue;
			addedItems.add(item.title);
			lines.push(`- [ ] **${item.title}**`);
			lines.push(`  ${item.body}`);
			lines.push("");
		}
	}

	// Add QA tasks
	if (groups["qa"]) {
		lines.push("### Quality Assurance");
		lines.push("");
		for (const item of groups["qa"]) {
			if (addedItems.has(item.title)) continue;
			addedItems.add(item.title);
			lines.push(`- [ ] **${item.title}**`);
			lines.push(`  ${item.body}`);
			lines.push("");
		}
	}

	lines.push("---");
	lines.push("");
	lines.push("Generated by `/tutorial:create` command.");

	return lines.join("\n");
}

/**
 * Todo file type (imported from types)
 */
interface TodoFile {
	id: string;
	title: string;
	tags: string[];
	status: string;
	created_at: string;
	body: string;
}

/**
 * Todo item type (imported from types)
 */
interface TodoItem {
	title: string;
	tags: string[];
	body: string;
}
