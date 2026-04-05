/**
 * Tutorial Extension
 *
 * Provides namespaced commands for creating and updating interactive
 * codebase tutorials:
 *
 * Commands:
 *   /tutorial:create <tutorial-dir> [source-code-dir]   # Create a new tutorial
 *   /tutorial:create                              # Interactive mode
 *   /tutorial:update <tutorial-dir>                 # Detect drift & update outdated chapters
 *
 * The extension also registers tools:
 *   - configure_tutorial: Structured requirement gathering for creation
 *   - check_tutorial_drift: Detect which chapters are outdated
 *
 * Drift Detection:
 *   A chapters.json is created alongside the tutorial, recording which source files
 *   each chapter references. Drift detection uses git to compare the "Based On Commit"
 *   in README.md against the current HEAD to detect changes.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

// ─── Types ───────────────────────────────────────────────────────────

interface TutorialConfig {
	tutorialDir: string;
	sourceDir: string;
	projectName: string;
	audience: string;
	goals: string[];
	scope: "overview" | "detailed" | "comprehensive";
	includeQuizzes: boolean;
	includeDiagrams: boolean;
	techStack: "react" | "vue" | "svelte" | "html";
}

interface ChaptersIndex {
	version: number;
	updatedAt: string;
	chapters: ChapterEntry[];
}

interface ChapterEntry {
	id: string;
	title: string;
	sourceFiles: string[]; // relative paths from sourceDir
}

interface ReadmeContent {
	basedOnCommit: string;
	sourceDir: string;
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

const CHAPTERS_FILENAME = "chapters.json";
const TODOS_DIR_NAME = ".pi/todos";
const README_FILENAME = "README.md";

// ─── Extension Entry Point ──────────────────────────────────────────

export default function createTutorialExtension(pi: ExtensionAPI) {
	registerTutorialCreateCommand(pi);
	registerTutorialUpdateCommand(pi);
	registerConfigureTutorialTool(pi);
	registerCheckTutorialDriftTool(pi);
}

// ─── Git Utilities ──────────────────────────────────────────────────

function expandTildePath(filePath: string): string {
	if (filePath.startsWith("~/")) {
		return filePath.replace("~", process.env.HOME || require("os").homedir());
	}
	return filePath;
}

function getGitCommit(sourceDir: string): string | null {
	const expandedPath = expandTildePath(sourceDir);
	try {
		return execSync("git rev-parse HEAD", {
			cwd: expandedPath,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch {
		return null;
	}
}

function getGitChanges(sourceDir: string, baseCommit: string): GitChange[] {
	const changes: GitChange[] = [];
	const expandedPath = expandTildePath(sourceDir);

	try {
		// Get modified and deleted files between base commit and HEAD
		const diffOutput = execSync(
			`git diff --name-status ${baseCommit}..HEAD`,
			{ cwd: expandedPath, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
		).trim();

		for (const line of diffOutput.split("\n")) {
			if (!line.trim()) continue;
			const [status, ...pathParts] = line.split("\t");
			const filePath = pathParts.join("\t");
			changes.push({
				path: filePath,
				status: status === "D" ? "deleted" : "modified",
			});
		}

		// Get new (untracked) files
		const statusOutput = execSync(
			"git status --porcelain",
			{ cwd: expandedPath, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
		).trim();

		for (const line of statusOutput.split("\n")) {
			if (!line.trim()) continue;
			const status = line.substring(0, 2).trim();
			const filePath = line.substring(3).trim();
			// ?? = untracked (new file)
			if (status === "??" || status === "A") {
				changes.push({ path: filePath, status: "new" });
			}
		}
	} catch {
		// Git command failed, return empty changes
	}

	return changes;
}

interface GitChange {
	path: string;
	status: "modified" | "deleted" | "new";
}

// ─── README Utilities ────────────────────────────────────────────────

function parseReadme(tutorialDir: string): ReadmeContent | null {
	const readmePath = path.resolve(tutorialDir, README_FILENAME);
	if (!existsSync(readmePath)) return null;

	try {
		const content = readFileSync(readmePath, "utf-8");

		// Extract Based On Commit
		const basedOnMatch = content.match(/\*\*Based On Commit\*\*\s*\|\s*`([^`]+)`/);
		const basedOnCommit = basedOnMatch ? basedOnMatch[1] : null;

		// Extract Source Location
		const sourceMatch = content.match(/\*\*Source Location\*\*\s*\|\s*`([^`]+)`/);
		const sourceDir = sourceMatch ? sourceMatch[1] : null;

		if (!basedOnCommit || !sourceDir) return null;

		return { basedOnCommit, sourceDir };
	} catch {
		return null;
	}
}

function updateReadmeCommit(tutorialDir: string, newCommit: string): void {
	const readmePath = path.resolve(tutorialDir, README_FILENAME);
	if (!existsSync(readmePath)) return;

	try {
		let content = readFileSync(readmePath, "utf-8");
		// Update the Based On Commit line
		content = content.replace(
			/(\*\*Based On Commit\*\*\s*\|\s*)`[^`]+`/,
			`$1\`${newCommit}\``
		);
		writeFileSync(readmePath, content, "utf-8");
	} catch {
		// Ignore errors
	}
}

function addReadmeUpdateEntry(tutorialDir: string, version: string, details: string): void {
	const readmePath = path.resolve(tutorialDir, README_FILENAME);
	if (!existsSync(readmePath)) return;

	try {
		let content = readFileSync(readmePath, "utf-8");
		const today = new Date().toISOString().split("T")[0];
		const newEntry = `| ${today} | ${version} | ${details} |`;

		// Find the Update History table and add the new entry after the last data row
		const lines = content.split("\n");
		let inUpdateHistory = false;
		let foundSeparator = false;
		let lastDataRowIndex = -1;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line.includes("## Update History")) {
				inUpdateHistory = true;
				foundSeparator = false;
				continue;
			}
			if (!inUpdateHistory) continue;

			// Skip the separator line (e.g. |---|---|)
			if (!foundSeparator && line.includes("---")) {
				foundSeparator = true;
				continue;
			}

			if (foundSeparator) {
				// A table data row contains | but isn't the separator
				if (line.includes("|") && !line.includes("---")) {
					lastDataRowIndex = i;
				} else {
					// First non-table line after data rows = end of table
					break;
				}
			}
		}

		const insertIndex = lastDataRowIndex >= 0 ? lastDataRowIndex + 1 : -1;
		if (insertIndex > 0) {
			lines.splice(insertIndex, 0, newEntry);
			writeFileSync(readmePath, lines.join("\n"), "utf-8");
		}
	} catch {
		// Ignore errors
	}
}

// ─── Chapters Index Utilities ────────────────────────────────────────

function loadChaptersIndex(tutorialDir: string): ChaptersIndex | null {
	const chaptersPath = path.resolve(tutorialDir, CHAPTERS_FILENAME);
	if (!existsSync(chaptersPath)) return null;

	try {
		const raw = readFileSync(chaptersPath, "utf-8");
		return JSON.parse(raw) as ChaptersIndex;
	} catch {
		return null;
	}
}

function saveChaptersIndex(tutorialDir: string, index: ChaptersIndex): void {
	const chaptersPath = path.resolve(tutorialDir, CHAPTERS_FILENAME);
	writeFileSync(chaptersPath, JSON.stringify(index, null, 2), "utf-8");
}


// ─── /tutorial:create ───────────────────────────────────────────────

function registerTutorialCreateCommand(pi: ExtensionAPI) {
	pi.registerCommand("tutorial:create", {
		description: "Create an interactive tutorial for a codebase",
		handler: async (args, ctx) => {
			const argParts = (args || "").trim().split(/\s+/).filter(Boolean);

			// Quick mode: arguments provided
			if (argParts.length >= 1) {
				const tutorialDir = argParts[0];
				const sourceDir = argParts[1] || ctx.cwd;

				await gatherRequirementsAndPrompt(pi, ctx, {
					tutorialDir,
					sourceDir,
					projectName: inferProjectName(tutorialDir),
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
				ctx.ui.notify("Error: Interactive mode requires UI. Use /tutorial:create <tutorial-dir> [source-code-dir]", "error");
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

Or use quick mode: /tutorial:create <tutorial-dir> [source-code-dir]`, { deliverAs: "steer" });
		},
	});
}

// ─── /tutorial:update ───────────────────────────────────────────────

function registerTutorialUpdateCommand(pi: ExtensionAPI) {
	pi.registerCommand("tutorial:update", {
		description: "Detect drift in an existing tutorial and update outdated chapters. Usage: /tutorial:update <tutorial-dir> [source-code-dir] [base-commit]",
		handler: async (args, ctx) => {
			const argParts = (args || "").trim().split(/\s+/).filter(Boolean);

			if (argParts.length < 1) {
				ctx.ui.notify("Usage: /tutorial:update <tutorial-dir> [source-code-dir] [base-commit]", "error");
				return;
			}

			const tutorialDir = argParts[0];
			const providedSourceDir = argParts[1] || null;
			const providedBaseCommit = argParts[2] || null;

			// Try to parse README for baseline commit and source directory
			const readme = parseReadme(tutorialDir);

			// Determine source directory (from args, README, or need to ask)
			let sourceDir: string;
			if (providedSourceDir) {
				sourceDir = providedSourceDir;
			} else if (readme?.sourceDir) {
				sourceDir = readme.sourceDir;
			} else {
				// Need to ask user for source directory
				pi.sendUserMessage(
					`I need more information to detect drift in the tutorial at "${tutorialDir}".

**Missing**: Source codebase location.

Please provide the path to the source codebase that this tutorial documents.

You can either:
- Tell me the source directory path
- Or provide it when running the command: /tutorial:update ${tutorialDir} /path/to/source`,
					{ deliverAs: "steer" }
				);
				return;
			}

			// Determine baseline commit (from args, README, or need to ask)
			let baseCommit: string;
			if (providedBaseCommit) {
				baseCommit = providedBaseCommit;
			} else if (readme?.basedOnCommit) {
				baseCommit = readme.basedOnCommit;
			} else {
				// Need to ask user for baseline commit
				const currentCommit = getGitCommit(sourceDir);
				pi.sendUserMessage(
					`I need more information to detect drift in the tutorial at "${tutorialDir}".

**Missing**: "Based On Commit" baseline.

The ${README_FILENAME} doesn't have baseline commit information, or this tutorial wasn't created with /tutorial:create.

Please provide the git commit hash that should be used as the baseline for detecting changes.

${currentCommit ? `Current HEAD commit: \`${currentCommit}\`` : "(Could not determine current HEAD commit)"}

You can either:
- Tell me the baseline commit hash
- Or provide it when running the command: /tutorial:update ${tutorialDir} ${sourceDir} <commit-hash>`,
					{ deliverAs: "steer" }
				);
				return;
			}

			// Load chapters index (optional - we can still detect drift without it)
			const chaptersIndex = loadChaptersIndex(tutorialDir);

			// Get current git commit
			const currentCommit = getGitCommit(sourceDir);
			if (!currentCommit) {
				ctx.ui.notify(
					`Could not get current git commit from ${sourceDir}. Is this a git repository?`,
					"error",
				);
				return;
			}

			// Get git changes since the baseline commit
			const gitChanges = getGitChanges(sourceDir, baseCommit);

			// Build the update prompt
			let prompt: string;

			if (gitChanges.length === 0) {
				pi.sendUserMessage(
					`No changes detected between the baseline and current commits.\n\n` +
					`Based on commit: \`${baseCommit}\`\n` +
					`Current commit: \`${currentCommit}\`\n\n` +
					`No source file changes detected.`,
					{ deliverAs: "assistant" }
				);
				return;
			}

			prompt = `Git changes detected since baseline commit.\n\n`;
			prompt += `**Based On Commit**: \`${baseCommit}\`\n`;
			prompt += `**Current Commit**: \`${currentCommit}\`\n\n`;

			prompt += "### Changed Files\n\n";
			for (const change of gitChanges) {
				const statusIcon = change.status === "modified" ? "M" : change.status === "deleted" ? "D" : "A";
				const statusLabel = change.status === "modified" ? "modified" : change.status === "deleted" ? "deleted" : "new";
				prompt += `  [\`${statusIcon}\`] \`${change.path}\` (${statusLabel})\n`;
			}
			prompt += "\n";

			// If we have chapters index, show which chapters are affected
			if (chaptersIndex) {
				const driftResult = detectDriftViaGit(chaptersIndex, gitChanges);
				const outdatedCount = driftResult.outdatedChapters.length;
				const upToDateCount = driftResult.upToDateChapters.length;

				if (outdatedCount > 0) {
					prompt += `### Outdated Chapters\n\n`;
					for (const ch of driftResult.outdatedChapters) {
						prompt += `**${ch.title}** (\`${ch.id}\`)\n`;
						prompt += `  Changed files:\n`;
						for (const f of ch.changedFiles) {
							prompt += `  - \`${f.path}\` (${f.status})\n`;
						}
						prompt += "\n";
					}
				}

				if (upToDateCount > 0) {
					prompt += `### Up-to-date Chapters (${upToDateCount})\n\n`;
					for (const ch of driftResult.upToDateChapters) {
						prompt += `- **${ch.title}** (\`${ch.id}\`) ✓\n`;
					}
					prompt += "\n";
				}

				prompt += `### Instructions\n\n`;
				prompt += `Please update the outdated chapters in "${tutorialDir}" based on the current source files.\n`;
				prompt += `Only regenerate the chapters listed above. Preserve any manual edits in up-to-date chapters.\n\n`;
				prompt += `For each outdated chapter:\n`;
				prompt += `1. Re-read the current source files listed above\n`;
				prompt += `2. Update the chapter content to reflect current code\n`;
				prompt += `3. Update the \`chapters.json\` if file references change\n`;
				prompt += `4. Update the \`README.md\` "Based On Commit" to \`${currentCommit}\`\n`;
				prompt += `5. Add an entry to the Update History table\n\n`;
			} else {
				// No chapters index - just show the changes
				prompt += `**Note**: No ${CHAPTERS_FILENAME} found. Chapter-level drift detection unavailable.\n\n`;
				prompt += `### Instructions\n\n`;
				prompt += `Please review the changed files above and update the relevant chapters in "${tutorialDir}".\n\n`;
				prompt += `After updating, consider creating a ${CHAPTERS_FILENAME} file to enable chapter-level drift detection:\n`;
				prompt += `- List each chapter's id, title, and source files it references\n`;
				prompt += `- This will help identify which chapters are affected by future changes\n\n`;
			}

			prompt += `Source codebase: ${sourceDir}\n`;
			prompt += `Tutorial target: ${tutorialDir}\n`;

			pi.sendUserMessage(prompt);
		},
	});
}

// ─── Drift Detection (Git-based) ────────────────────────────────────

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

function detectDriftViaGit(chaptersIndex: ChaptersIndex, gitChanges: GitChange[]): DriftResult {
	const outdatedChapters: OutdatedChapter[] = [];
	const upToDateChapters: UpToDateChapter[] = [];

	// Create a set of changed file paths for quick lookup
	const changedFilesSet = new Set(gitChanges.map(c => c.path));

	for (const chapter of chaptersIndex.chapters) {
		const changedFiles: ChangedFile[] = [];

		for (const filePattern of chapter.sourceFiles) {
			// Check if this file matches any changed file
			if (changedFilesSet.has(filePattern)) {
				const change = gitChanges.find(c => c.path === filePattern)!;
				changedFiles.push(change);
			}

			// Handle glob patterns (e.g., "src/services/*.ts")
			if (filePattern.includes("*")) {
				const regex = globToRegex(filePattern);
				for (const change of gitChanges) {
					if (regex.test(change.path) && !changedFiles.some(c => c.path === change.path)) {
						changedFiles.push(change);
					}
				}
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

function globToRegex(pattern: string): RegExp {
	// Convert simple glob pattern to regex
	// * matches any characters except /
	// ** matches any characters including /
	const escaped = pattern
		.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*/g, ".*")
		.replace(/\*/g, "[^/]*");
	return new RegExp(`^${escaped}$`);
}

// ─── configure_tutorial Tool ─────────────────────────────────────────

function registerConfigureTutorialTool(pi: ExtensionAPI) {
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
			]),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			// Validate required params
			if (!params.tutorialDir) {
				return {
					content: [{ type: "text", text: "Error: tutorialDir is required. Please specify the directory where tutorial files should be created." }],
					details: { cancelled: true, error: "Missing tutorialDir" },
				};
			}

			// Build config
			const config: TutorialConfig = {
				tutorialDir: params.tutorialDir,
				sourceDir: params.sourceDir || ctx.cwd,
				projectName: params.projectName || inferProjectName(params.tutorialDir),
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

// ─── check_tutorial_drift Tool ───────────────────────────────────────

function registerCheckTutorialDriftTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "check_tutorial_drift",
		label: "Check Tutorial Drift",
		description: "Check if an existing tutorial's chapters are outdated by comparing the README.md 'Based On Commit' against the current git HEAD. Returns a list of outdated chapters with details on which files changed.",
		parameters: Type.Object({
			tutorialDir: Type.String({ description: "The tutorial directory containing README.md and chapters.json" }),
			sourceDir: Type.Optional(Type.String({ description: "The source codebase directory (overrides README.md if provided)" })),
			baseCommit: Type.Optional(Type.String({ description: "The baseline git commit to compare against (overrides README.md if provided)" })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const tutorialDir = params.tutorialDir;

			// Try to parse README for baseline commit and source directory
			const readme = parseReadme(tutorialDir);

			// Determine source directory (from args or README)
			const sourceDir = params.sourceDir || readme?.sourceDir;
			if (!sourceDir) {
				return {
					content: [{
						type: "text",
						text: `No source directory found. Please provide either a ${README_FILENAME} with "Source Location" or pass sourceDir parameter.`,
					}],
					details: { error: "Source directory not specified" },
				};
			}

			// Determine baseline commit (from args or README)
			const baseCommit = params.baseCommit || readme?.basedOnCommit;
			if (!baseCommit) {
				const currentCommit = getGitCommit(sourceDir);
				return {
					content: [{
						type: "text",
						text: `No baseline commit found. Please provide either a ${README_FILENAME} with "Based On Commit" or pass baseCommit parameter.${currentCommit ? `\n\nCurrent HEAD: \`${currentCommit}\`` : ""}`,
					}],
					details: { error: "Baseline commit not specified" },
				};
			}

			// Get current git commit
			const currentCommit = getGitCommit(sourceDir);
			if (!currentCommit) {
				return {
					content: [{
						type: "text",
						text: `Could not get current git commit from ${sourceDir}. Is this a git repository?`,
					}],
					details: { error: "Git error" },
				};
			}

			// Get git changes since the baseline commit
			const gitChanges = getGitChanges(sourceDir, baseCommit);

			// Load chapters index (optional)
			const chaptersIndex = loadChaptersIndex(tutorialDir);

			// Build result
			if (gitChanges.length === 0) {
				const upToDateCount = chaptersIndex?.chapters.length ?? 0;
				return {
					content: [{
						type: "text",
						text: `No changes detected.\n\nBased on commit: \`${baseCommit}\`\nCurrent commit: \`${currentCommit}\`\n\nAll source files are unchanged.`,
					}],
					details: { outdatedCount: 0, upToDateCount, basedOnCommit: baseCommit, currentCommit },
				};
			}

			let text = `**${gitChanges.length} file(s)** changed since baseline.\n\n`;
			text += `Based on commit: \`${baseCommit}\`\n`;
			text += `Current commit: \`${currentCommit}\`\n\n`;

			text += `Changed files:\n`;
			for (const change of gitChanges) {
				const statusLabel = change.status === "modified" ? "modified" : change.status === "deleted" ? "⚠️ deleted" : "new";
				text += `  - \`${change.path}\` (${statusLabel})\n`;
			}
			text += "\n";

			if (chaptersIndex) {
				const driftResult = detectDriftViaGit(chaptersIndex, gitChanges);
				const { outdatedChapters, upToDateChapters } = driftResult;

				if (outdatedChapters.length > 0) {
					text += `### Outdated Chapters (${outdatedChapters.length})\n\n`;
					for (const ch of outdatedChapters) {
						text += `**${ch.title}** (\`${ch.id}\`)\n`;
						for (const f of ch.changedFiles) {
							text += `  - \`${f.path}\` (${f.status})\n`;
						}
						text += "\n";
					}
				}

				if (upToDateChapters.length > 0) {
					text += `Up-to-date chapters: ${upToDateChapters.map(ch => ch.title).join(", ")}\n`;
				}

				text += `\nUse /tutorial:update ${tutorialDir} to regenerate outdated chapters.`;

				return {
					content: [{ type: "text", text }],
					details: {
						outdatedCount: driftResult.outdatedChapters.length,
						upToDateCount: driftResult.upToDateChapters.length,
						basedOnCommit: baseCommit,
						currentCommit,
						outdatedChapters: driftResult.outdatedChapters,
						upToDateChapters: driftResult.upToDateChapters,
					},
				};
			} else {
				text += `**Note**: No ${CHAPTERS_FILENAME} found. Chapter-level drift detection unavailable.\n\n`;
				text += `Consider creating a ${CHAPTERS_FILENAME} to enable chapter-level detection.`;

				return {
					content: [{ type: "text", text }],
					details: {
						outdatedCount: -1,
						upToDateCount: -1,
						basedOnCommit: baseCommit,
						currentCommit,
						changedFiles: gitChanges,
					},
				};
			}
		},

		renderCall(args, theme) {
			const target = args.tutorialDir as string || "(unset)";
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

**Target Directory**: ${config.tutorialDir}
**Source Codebase**: ${config.sourceDir}
**Project Name**: ${config.projectName}

Please follow these steps:

1. Explore the source codebase structure at "${config.sourceDir}"
2. Identify the architecture pattern (clean architecture, MVC, modular, etc.)
3. Create the tutorial project in "${config.tutorialDir}" with:
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
7. Create a \`${CHAPTERS_FILENAME}\` file in the tutorial root:
   - For each chapter, record the chapter id, title, and list of source files it references
   - Use relative paths from "${config.sourceDir}"
   - This enables drift detection via \`/tutorial:update\` later
8. Create a \`README.md\` file with:
   - Project Details section (Source Project, Source Location, Based On Commit)
   - Table of Contents placeholder
   - Update History table (initial entry: version 1.0.0, "Initial tutorial creation")
9. Test that the tutorial builds and runs correctly`);
	} else {
		pi.sendUserMessage(prompt);
	}
}

function buildTutorialPrompt(config: TutorialConfig): string {
	return `Create an interactive tutorial for the codebase at "${config.sourceDir}".

The tutorial should be created in "${config.tutorialDir}".

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

### 6. Chapters Index

After creating all chapters, generate a \`${CHAPTERS_FILENAME}\` file in the tutorial root directory with the following structure:

\`\`\`json
{
  "version": 1,
  "updatedAt": "<ISO timestamp>",
  "chapters": [
    {
      "id": "<kebab-case-chapter-id>",
      "title": "<chapter title>",
      "sourceFiles": ["relative/path/file1.ts", "relative/path/file2.ts", "src/utils/*.ts"]
    },
    ...
  ]
}
\`\`\`

For each chapter, list every source file that is referenced or shown in code snippets.
Use relative paths from "${config.sourceDir}".
Support glob patterns for matching multiple files (e.g., "src/services/*.ts").
This index enables \`/tutorial:update\` to detect drift between the tutorial content and the current source code using git.

### 7. Project README

Create a \`README.md\` file in the tutorial root directory with the following structure:

\`\`\`markdown
# ${config.projectName} - Tutorial

## Project Details

| Property | Value |
|----------|-------|
| **Source Project** | ${inferProjectName(config.sourceDir)} |
| **Source Location** | \`${config.sourceDir}\` |
| **Based On Commit** | \`<current git commit hash from sourceDir>\` (Tutorial covers features and code up to this commit) |

---

## Table of Contents

<!-- AUTO-GENERATED: Chapters will be listed here -->

---

## Update History

| Date | Version | Update Details |
|------|---------|----------------|
| YYYY-MM-DD | 1.0.0 | Initial tutorial creation |

---

*This README is automatically generated. For interactive tutorial experience, run the tutorial app.*
\`\`\`

- Get the current git commit hash from the source directory using: \`git -C "${config.sourceDir}" rev-parse HEAD\`
- Leave "<!-- AUTO-GENERATED: Chapters will be listed here -->" as a placeholder; the user can update this manually

## Process

1. **Explore**: Analyze the source codebase at "${config.sourceDir}"
2. **Identify**: Determine the architecture pattern (clean architecture, MVC, modular, etc.)
3. **Scaffold**: Create the tutorial project structure in "${config.tutorialDir}"
4. **Write**: Create chapter content based on the codebase analysis
5. **Add Interactive Elements**: ${config.includeDiagrams ? "Diagrams, " : ""}${config.includeQuizzes ? "Quizzes, " : ""}Navigation
6. **Generate Chapters Index**: Create \`${CHAPTERS_FILENAME}\` with chapter-to-files mapping
7. **Create README**: Generate \`README.md\` with Project Details, Table of Contents, and Update History sections
8. **Test**: Ensure the tutorial builds and runs correctly

Please start by exploring the source codebase at "${config.sourceDir}" and then create the tutorial in "${config.tutorialDir}".`;
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
			body: `Set up the ${config.techStack} project in ${config.tutorialDir} with Vite, TypeScript, prism-react-renderer (vsLight theme for syntax highlighting), and the required dependencies for navigation.`,
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

	// Add chapters index generation todo
	items.push({
		title: "Generate chapters index",
		tags: ["tutorial", "setup"],
		body: `Create a ${CHAPTERS_FILENAME} file that maps each chapter to its source files. This enables /tutorial:update to detect drift using git.`,
	});

	// Add README generation todo
	items.push({
		title: "Create project README",
		tags: ["tutorial", "setup"],
		body: `Create a README.md file with Project Details (Source Project, Source Location, Based On Commit), Table of Contents placeholder, and Update History table.`,
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
