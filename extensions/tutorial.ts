/**
 * Tutorial Extension
 *
 * Provides namespaced commands for creating and updating interactive
 * codebase tutorials:
 *
 * Commands:
 *   /tutorial:create <target-dir> [source-dir]   # Create a new tutorial
 *   /tutorial:create                              # Interactive mode
 *   /tutorial:update <target-dir>                 # Detect drift & update outdated chapters
 *
 * The extension also registers tools:
 *   - configure_tutorial: Structured requirement gathering for creation
 *   - check_tutorial_drift: Detect which chapters are outdated
 *
 * Drift Detection (Option B):
 *   A tutorial-manifest.json is created alongside the tutorial, recording
 *   which source files each chapter references along with their SHA-256
 *   hashes. On /tutorial:update, the manifest is compared against the
 *   current state of the source files to detect outdated chapters.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

// ─── Types ───────────────────────────────────────────────────────────

interface TutorialConfig {
	targetDir: string;
	sourceDir: string;
	projectName: string;
	audience: string;
	goals: string[];
	scope: "overview" | "detailed" | "comprehensive";
	includeQuizzes: boolean;
	includeDiagrams: boolean;
	techStack: "react" | "vue" | "svelte" | "html";
}

interface TutorialManifest {
	version: number;
	createdAt: string;
	updatedAt: string;
	sourceDir: string;
	config: TutorialConfig;
	chapters: ChapterManifest[];
}

interface ChapterManifest {
	id: string;
	title: string;
	sourceFiles: SourceFileEntry[];
}

interface SourceFileEntry {
	path: string; // relative to sourceDir
	hash: string; // SHA-256 hex digest
}

interface TodoResult {
	created: boolean;
	message: string;
	todos?: Array<{ id: string; title: string }>;
	todoPath?: string;
}

interface TodoFile {
	id: string;
	title: string;
	tags: string[];
	status: string;
	created_at: string;
	body: string;
}

interface TodoItem {
	title: string;
	tags: string[];
	body: string;
}

// ─── Constants ───────────────────────────────────────────────────────

const MANIFEST_FILENAME = "tutorial-manifest.json";
const TODOS_DIR_NAME = ".pi/todos";

// ─── Extension Entry Point ──────────────────────────────────────────

export default function createTutorialExtension(pi: ExtensionAPI) {
	registerTutorialCreateCommand(pi);
	registerTutorialUpdateCommand(pi);
	registerConfigureTutorialTool(pi);
	registerCheckTutorialDriftTool(pi);
}

// ─── /tutorial:create ───────────────────────────────────────────────

function registerTutorialCreateCommand(pi: ExtensionAPI) {
	pi.registerCommand("tutorial:create", {
		description: "Create an interactive tutorial for a codebase",
		handler: async (args, ctx) => {
			const argParts = (args || "").trim().split(/\s+/).filter(Boolean);

			// Quick mode: arguments provided
			if (argParts.length >= 1) {
				const targetDir = argParts[0];
				const sourceDir = argParts[1] || ctx.cwd;

				await gatherRequirementsAndPrompt(pi, ctx, {
					targetDir,
					sourceDir,
					projectName: inferProjectName(targetDir),
					audience: "Developers familiar with JavaScript but new to TypeScript",
					goals: ["Navigate the codebase", "Understand architecture patterns", "Make small changes", "Debug common issues"],
					scope: "detailed",
					includeQuizzes: true,
					includeDiagrams: true,
					techStack: "react",
				}, true);
				return;
			}

			// Interactive mode: need to gather requirements
			if (!ctx.hasUI) {
				ctx.ui.notify("Error: Interactive mode requires UI. Use /tutorial:create <target-dir> [source-dir]", "error");
				return;
			}

			// Prompt the LLM to gather requirements
			pi.sendUserMessage(`I need to gather requirements for the tutorial. Please ask the user:

1. Where should the tutorial files be created? (required - provide a directory path)
2. Which codebase should be documented? (optional - defaults to current directory)
3. Who is the target audience? (e.g., 'JavaScript developers new to TypeScript')
4. What are the learning goals? (e.g., 'Navigate the codebase', 'Understand architecture')
5. What scope should the tutorial cover? ('overview', 'detailed', or 'comprehensive')
6. Should it include quizzes? (yes/no)
7. Should it include diagrams? (yes/no)
8. Which tech stack for the tutorial UI? ('react', 'vue', 'svelte', or 'html')

Or use quick mode: /tutorial:create <target-dir> [source-dir]`, { deliverAs: "steer" });
		},
	});
}

// ─── /tutorial:update ───────────────────────────────────────────────

function registerTutorialUpdateCommand(pi: ExtensionAPI) {
	pi.registerCommand("tutorial:update", {
		description: "Detect drift in an existing tutorial and update outdated chapters",
		handler: async (args, ctx) => {
			const argParts = (args || "").trim().split(/\s+/).filter(Boolean);

			if (argParts.length < 1) {
				ctx.ui.notify("Usage: /tutorial:update <target-dir>", "error");
				return;
			}

			const targetDir = argParts[0];
			const manifestPath = path.resolve(ctx.cwd, targetDir, MANIFEST_FILENAME);

			// Check manifest exists
			if (!existsSync(manifestPath)) {
				ctx.ui.notify(
					`No ${MANIFEST_FILENAME} found in ${targetDir}. Was the tutorial created with /tutorial:create?`,
					"error",
				);
				return;
			}

			// Load and validate manifest
			let manifest: TutorialManifest;
			try {
				const raw = await readFile(manifestPath, "utf-8");
				manifest = JSON.parse(raw) as TutorialManifest;
			} catch (err) {
				ctx.ui.notify(`Failed to read manifest: ${err instanceof Error ? err.message : "unknown error"}`, "error");
				return;
			}

			if (!manifest.chapters || !Array.isArray(manifest.chapters)) {
				ctx.ui.notify("Manifest is invalid: missing or malformed chapters array.", "error");
				return;
			}

			// Perform drift detection
			const driftResult = detectDrift(manifest);

			// Build the update prompt
			const outdatedCount = driftResult.outdatedChapters.length;
			const upToDateCount = driftResult.upToDateChapters.length;

			if (outdatedCount === 0) {
				pi.sendUserMessage(`Tutorial is up to date! All ${upToDateCount} chapters match their source files. No updates needed.`, { deliverAs: "assistant" });
				return;
			}

			let prompt = `Tutorial drift detected! **${outdatedCount} of ${outdatedCount + upToDateCount} chapters** are outdated and need updating.\n\n`;

			prompt += "### Outdated Chapters\n\n";
			for (const ch of driftResult.outdatedChapters) {
				prompt += `**${ch.title}** (\`${ch.id}\`)\n`;
				prompt += `  Changed files:\n`;
				for (const f of ch.changedFiles) {
					prompt += `  - \`${f.path}\` ${f.status === "modified" ? "(modified)" : f.status === "deleted" ? "(deleted)" : "(new)"}\n`;
				}
				prompt += "\n";
			}

			if (upToDateCount > 0) {
				prompt += `### Up-to-date Chapters (${upToDateCount})\n\n`;
				for (const ch of driftResult.upToDateChapters) {
					prompt += `- **${ch.title}** (\`${ch.id}\`) ✓\n`;
				}
				prompt += "\n";
			}

			prompt += `### Instructions\n\n`;
			prompt += `Please update the outdated chapters in "${targetDir}" based on the current source files.\n`;
			prompt += `Only regenerate the chapters listed above. Preserve any manual edits in up-to-date chapters.\n\n`;
			prompt += `For each outdated chapter:\n`;
			prompt += `1. Re-read the current source files listed above\n`;
			prompt += `2. Update the chapter content to reflect current code\n`;
			prompt += `3. Update the file hashes in ${MANIFEST_FILENAME}\n\n`;
			prompt += `Source codebase: ${manifest.sourceDir}\n`;
			prompt += `Tutorial target: ${targetDir}\n`;

			pi.sendUserMessage(prompt);
		},
	});
}

// ─── configure_tutorial Tool ─────────────────────────────────────────

function registerConfigureTutorialTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "configure_tutorial",
		label: "Configure Tutorial",
		description: "Gather requirements for creating a codebase tutorial. Use the 'targetDir' parameter to specify where tutorial files will be created. Call this tool when you have gathered all requirements from the user.",
		parameters: Type.Object({
			targetDir: Type.String(),
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
			]),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			// Validate required params
			if (!params.targetDir) {
				return {
					content: [{ type: "text", text: "Error: targetDir is required. Please specify the directory where tutorial files should be created." }],
					details: { cancelled: true, error: "Missing targetDir" },
				};
			}

			// Build config
			const config: TutorialConfig = {
				targetDir: params.targetDir,
				sourceDir: params.sourceDir || ctx.cwd,
				projectName: params.projectName || inferProjectName(params.targetDir),
				audience: params.audience || "Developers familiar with JavaScript but new to TypeScript",
				goals: params.goals || ["Navigate the codebase", "Understand architecture patterns"],
				scope: params.scope || "detailed",
				includeQuizzes: params.includeQuizzes ?? true,
				includeDiagrams: params.includeDiagrams ?? true,
				techStack: params.techStack || "react",
			};

			// Build the prompt for the LLM
			const prompt = buildTutorialPrompt(config);

			// Create todos to track tutorial creation progress
			const todoResult = await createTutorialTodos(pi, config, ctx);

			// Build the response text
			let responseText = `Tutorial configuration complete. Now analyze the codebase and create the tutorial.

Configuration:
- Target: ${config.targetDir}
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
			const target = args.targetDir as string || "(unset)";
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
						`  Target: ${config.targetDir}`,
						`  Source: ${config.sourceDir}`,
						`  Scope: ${config.scope}`,
						`  Stack: ${config.techStack}`,
					];
				},
			};
		},
	});
}

// ─── check_tutorial_drift Tool ───────────────────────────────────────

function registerCheckTutorialDriftTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "check_tutorial_drift",
		label: "Check Tutorial Drift",
		description: "Check if an existing tutorial's chapters are outdated by comparing source file hashes in the manifest against the current files. Returns a list of outdated chapters with details on which files changed.",
		parameters: Type.Object({
			targetDir: Type.String({ description: "The tutorial directory containing tutorial-manifest.json" }),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const targetDir = params.targetDir;
			const manifestPath = path.resolve(ctx.cwd, targetDir, MANIFEST_FILENAME);

			if (!existsSync(manifestPath)) {
				return {
					content: [{
						type: "text",
						text: `No ${MANIFEST_FILENAME} found in ${targetDir}. Cannot check drift. Was the tutorial created with /tutorial:create?`,
					}],
					details: { error: "Manifest not found" },
				};
			}

			let manifest: TutorialManifest;
			try {
				const raw = await readFile(manifestPath, "utf-8");
				manifest = JSON.parse(raw) as TutorialManifest;
			} catch (err) {
				return {
					content: [{
						type: "text",
						text: `Failed to read manifest: ${err instanceof Error ? err.message : "unknown error"}`,
					}],
					details: { error: "Failed to read manifest" },
				};
			}

			const driftResult = detectDrift(manifest);
			const { outdatedChapters, upToDateChapters } = driftResult;

			if (outdatedChapters.length === 0) {
				return {
					content: [{
						type: "text",
						text: `Tutorial is up to date. All ${upToDateChapters.length} chapter(s) match their source files.`,
					}],
					details: { outdatedCount: 0, upToDateCount: upToDateChapters.length },
				};
			}

			let text = `Drift detected: **${outdatedChapters.length} of ${outdatedChapters.length + upToDateChapters.length} chapters are outdated.**\n\n`;

			for (const ch of outdatedChapters) {
				text += `**${ch.title}** (\`${ch.id}\`)\n`;
				for (const f of ch.changedFiles) {
					const statusLabel = f.status === "modified" ? "modified" : f.status === "deleted" ? "⚠️ deleted" : "new";
					text += `  - \`${f.path}\` (${statusLabel})\n`;
				}
				text += "\n";
			}

			if (upToDateChapters.length > 0) {
				text += `Up-to-date chapters: ${upToDateChapters.map(ch => ch.title).join(", ")}\n`;
			}

			text += `\nUse /tutorial:update ${targetDir} to regenerate outdated chapters, or update them manually and refresh the manifest hashes.`;

			return {
				content: [{ type: "text", text }],
				details: {
					outdatedCount: outdatedChapters.length,
					upToDateCount: upToDateChapters.length,
					outdatedChapters,
					upToDateChapters,
				},
			};
		},

		renderCall(args, theme) {
			const target = args.targetDir as string || "(unset)";
			return {
				render(_width: number) {
					return [
						theme.fg("toolTitle", theme.bold("check_tutorial_drift")),
						`  Target: ${target}`,
					];
				},
			};
		},

		renderResult(result, _options, theme) {
			const details = result.details as { outdatedCount?: number; upToDateCount?: number; error?: string } | undefined;

			if (details?.error) {
				return {
					render(_width: number) {
						return [theme.fg("error", `✗ ${details.error}`)];
					},
				};
			}

			const outdated = details?.outdatedCount ?? 0;
			const upToDate = details?.upToDateCount ?? 0;

			return {
				render(_width: number) {
					if (outdated === 0) {
						return [theme.fg("success", `✓ Tutorial up to date (${upToDate} chapters)`)];
					}
					return [
						theme.fg("warning", `⚠ Drift detected: ${outdated} outdated, ${upToDate} up to date`),
					];
				},
			};
		},
	});
}

// ─── Drift Detection Logic ──────────────────────────────────────────

interface ChangedFile {
	path: string;
	status: "modified" | "deleted" | "new";
}

interface OutdatedChapter {
	id: string;
	title: string;
	changedFiles: ChangedFile[];
}

interface UpToDateChapter {
	id: string;
	title: string;
}

interface DriftResult {
	outdatedChapters: OutdatedChapter[];
	upToDateChapters: UpToDateChapter[];
}

function detectDrift(manifest: TutorialManifest): DriftResult {
	const outdatedChapters: OutdatedChapter[] = [];
	const upToDateChapters: UpToDateChapter[] = [];

	for (const chapter of manifest.chapters) {
		const changedFiles: ChangedFile[] = [];

		for (const entry of chapter.sourceFiles) {
			const fullPath = path.resolve(manifest.sourceDir, entry.path);

			if (!existsSync(fullPath)) {
				changedFiles.push({ path: entry.path, status: "deleted" });
				continue;
			}

			try {
				const contents = readFileSync(fullPath, "utf-8");
				const currentHash = hashContent(contents);
				if (currentHash !== entry.hash) {
					changedFiles.push({ path: entry.path, status: "modified" });
				}
			} catch {
				changedFiles.push({ path: entry.path, status: "modified" });
			}
		}

		if (changedFiles.length > 0) {
			outdatedChapters.push({
				id: chapter.id,
				title: chapter.title,
				changedFiles,
			});
		} else {
			upToDateChapters.push({
				id: chapter.id,
				title: chapter.title,
			});
		}
	}

	return { outdatedChapters, upToDateChapters };
}

// ─── Manifest Utilities ─────────────────────────────────────────────

function hashContent(content: string): string {
	return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

// ─── Prompt Builder ─────────────────────────────────────────────────

async function gatherRequirementsAndPrompt(
	pi: ExtensionAPI,
	_ctx: ExtensionContext,
	config: TutorialConfig,
	quickMode: boolean
): Promise<void> {
	const prompt = buildTutorialPrompt(config);

	if (quickMode) {
		// In quick mode, provide a shorter prompt
		pi.sendUserMessage(`Create an interactive tutorial for the codebase.

**Target Directory**: ${config.targetDir}
**Source Codebase**: ${config.sourceDir}
**Project Name**: ${config.projectName}

Please follow these steps:

1. Explore the source codebase structure at "${config.sourceDir}"
2. Identify the architecture pattern (clean architecture, MVC, modular, etc.)
3. Create the tutorial project in "${config.targetDir}" with:
   - ${config.techStack === "react" ? "Vite + React + TypeScript" : config.techStack}
   - Clean navigation with sidebar
   - Progress tracking
   - Syntax highlighting (prism-react-renderer with vsLight theme)
4. Write chapters covering:
   - Architecture overview
   - Key modules and their purposes
   - Data flow
   - TypeScript patterns
   - Entry points and configuration
   - Body text should use Noto Sans font, code blocks should use Source Code Pro font
   - Use prism-react-renderer with the vsLight theme for syntax highlighting in code blocks
${config.includeQuizzes ? "5. Add knowledge-check quizzes to each chapter" : ""}
${config.includeDiagrams ? "6. Include SVG diagrams for architecture and code flow" : ""}
7. Create a \`${MANIFEST_FILENAME}\` file in the tutorial root:
   - For each chapter, record the chapter id, title, and every source file it references
   - For each source file, store its relative path (relative to "${config.sourceDir}") and its SHA-256 hash
   - This enables drift detection via \`/tutorial:update\` later
8. Test that the tutorial builds and runs correctly`);
	} else {
		pi.sendUserMessage(prompt);
	}
}

function buildTutorialPrompt(config: TutorialConfig): string {
	return `Create an interactive tutorial for the codebase at "${config.sourceDir}".

The tutorial should be created in "${config.targetDir}".

## Configuration

- **Project Name**: ${config.projectName}
- **Target Audience**: ${config.audience}
- **Learning Goals**: ${config.goals.join(", ")}
- **Scope**: ${config.scope}
- **Include Quizzes**: ${config.includeQuizzes ? "Yes" : "No"}
- **Include Diagrams**: ${config.includeDiagrams ? "Yes" : "No"}
- **Tech Stack**: ${config.techStack}

## Requirements

### 1. Project Structure

Create a ${config.techStack === "react" ? "Vite + React + TypeScript" : config.techStack === "vue" ? "Vite + Vue + TypeScript" : config.techStack === "svelte" ? "Vite + Svelte" : "static HTML"} tutorial app with:
- Clean navigation (sidebar with chapter list)
- Progress tracking (use localStorage)
- Responsive design (mobile-friendly sidebar toggle)
- Syntax-highlighted code blocks (using prism-react-renderer with vsLight theme)

### 2. Content Creation

Analyze the source codebase and create chapters covering:
- **Architecture Overview**: High-level structure with ${config.includeDiagrams ? "SVG diagrams" : "text descriptions"}
- **Key Modules**: What each module does and its responsibilities
- **Data Flow**: How data moves through the system
- **TypeScript Patterns**: Types, interfaces, generics (if applicable)
- **Configuration & Entry Points**: How the app boots and is configured
${config.scope === "comprehensive" ? "- **All Files**: Complete coverage of every production file" : ""}

### 3. Chapter Structure

Each chapter should include:
- Clear title and description
- "Files Covered" section listing the relevant source files
- Code snippets with syntax highlighting and explanations
- ${config.includeQuizzes ? "Knowledge-check quiz with multiple-choice questions" : "Summary and key takeaways"}
- Navigation to next/previous chapter

### 4. Interactive Elements

${config.includeDiagrams ? `- Architecture diagram (SVG) showing layers/modules
- Code flow visualization (step-by-step animation through the codebase)
` : ""}${config.includeQuizzes ? `- Multiple-choice quizzes with explanations for correct answers
` : ""}- Progress tracking with completion indicators
- "Continue where you left off" functionality

### 5. Styling

- Light theme with clear visual hierarchy
- Use Google Fonts: Noto Sans for body text, Source Code Pro for code blocks
- Use prism-react-renderer for syntax highlighting with the vsLight theme
- Proper spacing and accessibility (44px touch targets)
- Hover/focus states for all interactive elements

### 6. Drift Detection Manifest

After creating all chapters, generate a \`${MANIFEST_FILENAME}\` file in the tutorial root directory with the following structure:

\`\`\`json
{
  "version": 1,
  "createdAt": "<ISO timestamp>",
  "updatedAt": "<ISO timestamp>",
  "sourceDir": "${config.sourceDir}",
  "config": { <the full tutorial config> },
  "chapters": [
    {
      "id": "<kebab-case-chapter-id>",
      "title": "<chapter title>",
      "sourceFiles": [
        { "path": "<relative path from sourceDir>", "hash": "<sha-256 hex>" },
        ...
      ]
    },
    ...
  ]
}
\`\`\`

For each chapter, list every source file that is referenced or shown in code snippets.
Compute the SHA-256 hash of each file's contents at creation time.
This manifest enables \`/tutorial:update\` to detect drift between the tutorial content and the current source code.

## Process

1. **Explore**: Analyze the source codebase at "${config.sourceDir}"
2. **Identify**: Determine the architecture pattern (clean architecture, MVC, modular, etc.)
3. **Scaffold**: Create the tutorial project structure in "${config.targetDir}"
4. **Write**: Create chapter content based on the codebase analysis
5. **Add Interactive Elements**: ${config.includeDiagrams ? "Diagrams, " : ""}${config.includeQuizzes ? "Quizzes, " : ""}Navigation
6. **Generate Manifest**: Create \`${MANIFEST_FILENAME}\` with file hashes for drift detection
7. **Test**: Ensure the tutorial builds and runs correctly

Please start by exploring the source codebase at "${config.sourceDir}" and then create the tutorial in "${config.targetDir}".`;
}

// ─── Utility Functions ──────────────────────────────────────────────

function inferProjectName(dir: string): string {
	const parts = dir.replace(/\/$/, "").split("/");
	const name = parts[parts.length - 1] || "project";
	// Clean up common suffixes
	return name.replace(/-tutorial$|-walkthrough$|-docs$/, "").replace(/_tutorial$|_walkthrough$|_docs$/, "") || "project";
}

// ─── Todo Management ────────────────────────────────────────────────

function getTodosDir(cwd: string): string {
	return path.resolve(cwd, TODOS_DIR_NAME);
}

async function generateTodoId(todosDir: string): Promise<string> {
	for (let attempt = 0; attempt < 10; attempt += 1) {
		const id = crypto.randomBytes(4).toString("hex");
		const todoPath = path.join(todosDir, `${id}.md`);
		if (!existsSync(todoPath)) return id;
	}
	throw new Error("Failed to generate unique todo id");
}

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

async function createTodoFile(todosDir: string, id: string, todo: TodoFile): Promise<void> {
	const filePath = path.join(todosDir, `${id}.md`);
	await writeFile(filePath, serializeTodo(todo), "utf8");
}

async function createTutorialTodos(pi: ExtensionAPI, config: TutorialConfig, ctx: ExtensionContext): Promise<TodoResult> {
	const todoItems = generateTodoItems(config);

	// Try to use the .pi/todos directory (compatible with todos extension)
	try {
		const todosDir = getTodosDir(ctx.cwd);

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
		const todoPath = path.resolve(ctx.cwd, config.targetDir, "TODO.md");
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
			body: `Set up the ${config.techStack} project in ${config.targetDir} with Vite, TypeScript, prism-react-renderer (vsLight theme for syntax highlighting), and the required dependencies for navigation.`,
		},
		{
			title: "Implement navigation and layout",
			tags: ["tutorial", "ui"],
			body: "Create the sidebar navigation, chapter list, and responsive layout with mobile-friendly controls.",
		},
		{
			title: "Create architecture overview chapter",
			tags: ["tutorial", "content"],
			body: "Write the first chapter covering the high-level architecture, main components, and how they interact." + (config.includeDiagrams ? " Include SVG diagrams." : ""),
		},
	];

	// Add scope-specific todos
	if (config.scope === "comprehensive") {
		items.push({
			title: "Create module documentation chapters",
			tags: ["tutorial", "content"],
			body: "Create detailed chapters for each major module, covering all production files.",
		});
	} else {
		items.push({
			title: "Create key modules chapter",
			tags: ["tutorial", "content"],
			body: "Document the key modules and their purposes, focusing on the most important files.",
		});
	}

	// Add data flow chapter
	items.push({
		title: "Create data flow chapter",
		tags: ["tutorial", "content"],
		body: "Document how data moves through the system, including state management and API interactions." + (config.includeDiagrams ? " Include flow diagrams." : ""),
	});

	// Add TypeScript patterns if applicable
	items.push({
		title: "Create TypeScript patterns chapter",
		tags: ["tutorial", "content"],
		body: "Document the TypeScript patterns, interfaces, and types used in the codebase.",
	});

	// Add manifest generation todo
	items.push({
		title: "Generate drift detection manifest",
		tags: ["tutorial", "setup"],
		body: `Create a ${MANIFEST_FILENAME} file in the tutorial root that records each chapter's referenced source files and their SHA-256 hashes. This enables /tutorial:update to detect drift.`,
	});

	// Add quizzes if enabled
	if (config.includeQuizzes) {
		items.push({
			title: "Add knowledge-check quizzes",
			tags: ["tutorial", "interactive"],
			body: "Add multiple-choice quiz questions to each chapter with explanations for correct answers.",
		});
	}

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

function buildTodoMdContent(items: TodoItem[], config: TutorialConfig): string {
	const lines: string[] = [
		`# Tutorial Creation Progress: ${config.projectName}`,
		"",
		"> This TODO.md tracks the progress of tutorial creation. Mark items as complete as you work through them.",
		"> Use `[x]` to mark items complete and `[ ]` for pending items.",
		"",
		"## Overview",
		"",
		`- **Target Directory**: ${config.targetDir}`,
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
