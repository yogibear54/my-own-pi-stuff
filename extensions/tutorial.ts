/**
 * Tutorial Extension
 *
 * Provides namespaced commands for creating and updating interactive
 * codebase tutorials:
 *
 * Commands:
 *   /tutorial:create <tutorial-dir> [source-code-dir]   # Create a skeleton tutorial (Pass 1)
 *   /tutorial:create                              # Interactive mode
 *   /tutorial:deep-dive <tutorial-dir> [chapter-id]  # Deep-dive expand chapters (Pass 2)
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
	config?: TutorialConfig;
	chapters: ChapterEntry[];
}

interface ChapterEntry {
	id: string;
	title: string;
	sourceFiles: string[]; // relative paths from sourceDir
	chapterFile?: string;  // relative path to chapter component in tutorialDir
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
	registerTutorialDeepDiveCommand(pi);
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
		description: "Create a skeleton tutorial (Pass 1). Use /tutorial:deep-dive for Pass 2 expansion. Usage: /tutorial:create <tutorial-dir> [source-code-dir]",
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

// ─── /tutorial:deep-dive ────────────────────────────────────────────

function registerTutorialDeepDiveCommand(pi: ExtensionAPI) {
	const DEEP_DIVE_DESCRIPTION =
		"Deep-dive into skeleton tutorial chapters with detailed analysis. " +
		"Expands all chapters or a specific chapter. " +
		"Usage: /tutorial:deep-dive <tutorial-dir> [chapter-id]";

	const DEEP_DIVE_TOOL_DESCRIPTION =
		"Expand skeleton tutorial chapters with deep code analysis. " +
		"Reads the skeleton created by /tutorial:create, deeply analyzes source files, " +
	 "and expands chapter content with detailed walkthroughs, quizzes, and diagrams. " +
		"Call when the user wants to deepen tutorial content.";

	// Register the command
	const handler = async (args: string, ctx: ExtensionContext) => {
		const argParts = (args || "").trim().split(/\s+/).filter(Boolean);

		if (argParts.length < 1) {
			ctx.ui.notify("Usage: /tutorial:deep-dive <tutorial-dir> [chapter-id]", "error");
			return;
		}

		const tutorialDir = argParts[0];
		const chapterId = argParts[1] || null;

		// Load chapters index
		const chaptersIndex = loadChaptersIndex(tutorialDir);
		if (!chaptersIndex || chaptersIndex.chapters.length === 0) {
			const readme = parseReadme(tutorialDir);
			const hasReadme = !!readme;
			const sourceInfo = readme?.sourceDir ? `\nFound README.md with source at \`${readme.sourceDir}\`.` : "\nNo README.md found either.";

			ctx.ui.notify(
				`No ${CHAPTERS_FILENAME} found in "${tutorialDir}".`,
				"error",
			);
			pi.sendUserMessage(
				`No ${CHAPTERS_FILENAME} found in "${tutorialDir}".\n\n` +
				`Deep-dive requires a skeleton tutorial created with \`/tutorial:create\`.\n\n` +
				`Please run \`/tutorial:create ${tutorialDir}\` first to create the skeleton tutorial.` +
				sourceInfo,
				{ deliverAs: "steer" },
			);
			return;
		}

		// Get config from chapters index or infer from README
		const config = chaptersIndex.config;

		let sourceDir: string;
		if (config?.sourceDir) {
			sourceDir = config.sourceDir;
		} else {
			const readme = parseReadme(tutorialDir);
			if (readme?.sourceDir) {
				sourceDir = readme.sourceDir;
			} else {
				pi.sendUserMessage(
					`Cannot determine source codebase location for tutorial at "${tutorialDir}".\n\n` +
					`The ${CHAPTERS_FILENAME} doesn't have a config section with sourceDir, and no README.md was found.\n\n` +
					`Please either:\n` +
					`- Re-create the tutorial with \`/tutorial:create\` (which saves config to chapters.json)\n` +
					`- Or add a \"config\" section to ${CHAPTERS_FILENAME} with the \"sourceDir\" field`,
					{ deliverAs: "steer" },
				);
				return;
			}
		}

		// Filter chapters if a specific chapter ID is provided
		let targetChapters: ChapterEntry[];
		if (chapterId) {
			const normalizedId = chapterId.toLowerCase().replace(/\s+/g, "-");
			const target = chaptersIndex.chapters.find(
				ch => ch.id === chapterId || ch.id === normalizedId,
			);
			if (!target) {
				const available = chaptersIndex.chapters
					.map(ch => `  - \`${ch.id}\` → ${ch.title}`)
					.join("\n");
				ctx.ui.notify(`Chapter "${chapterId}" not found.`, "error");
				pi.sendUserMessage(
					`Chapter \`${chapterId}\` not found in "${tutorialDir}".\n\n` +
					`Available chapters:\n${available}\n\n` +
					`Usage: /tutorial:deep-dive ${tutorialDir} <chapter-id>`,
					{ deliverAs: "steer" },
				);
				return;
			}
			targetChapters = [target];
		} else {
			targetChapters = chaptersIndex.chapters;
		}

		// Notify the user
		const chapterCount = targetChapters.length;
		const isSingle = chapterCount === 1;
		ctx.ui.notify(
			`🔍 Deep diving ${isSingle ? `chapter: ${targetChapters[0].title}` : `${chapterCount} chapters`}...`,
			"info",
		);

		// Build and send the deep-dive prompt
		const prompt = buildDeepDivePrompt(tutorialDir, sourceDir, targetChapters, config);
		pi.sendUserMessage(prompt);
	};

	pi.registerCommand("tutorial:deep-dive", {
		description: DEEP_DIVE_DESCRIPTION,
		handler,
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
		const seenPaths = new Set<string>();

		for (const filePattern of chapter.sourceFiles) {
			// Check if this file matches any changed file
			if (changedFilesSet.has(filePattern) && !seenPaths.has(filePattern)) {
				const change = gitChanges.find(c => c.path === filePattern)!;
				changedFiles.push(change);
				seenPaths.add(filePattern);
			}

			// Handle glob patterns (e.g., "src/services/*.ts")
			if (filePattern.includes("*")) {
				const regex = globToRegex(filePattern);
				for (const change of gitChanges) {
					if (regex.test(change.path) && !seenPaths.has(change.path)) {
						changedFiles.push(change);
						seenPaths.add(change.path);
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
	_pi: ExtensionAPI,
	_ctx: ExtensionContext,
	config: TutorialConfig,
	quickMode: boolean
): Promise<void> {
	const prompt = buildTutorialPrompt(config);

	if (quickMode) {
		// Prepend a concise summary header, then reuse buildTutorialPrompt (single source of truth)
		const header = `Create a SKELETON tutorial for the codebase (Pass 1 of 2).

**Target Directory**: ${config.tutorialDir}
**Source Codebase**: ${config.sourceDir}
**Project Name**: ${config.projectName}
`;
		_pi.sendUserMessage(`${header}\n---\n\n${prompt}`);
	} else {
		_pi.sendUserMessage(prompt);
	}
}

function buildTutorialPrompt(config: TutorialConfig): string {
	return `Create a SKELETON tutorial (Pass 1 of 2) for the codebase at "${config.sourceDir}".

The tutorial should be created in "${config.tutorialDir}".

This is a SURFACE ANALYSIS pass. Produce a working tutorial app with minimal chapter content.
The chapters will be expanded with detailed analysis in Pass 2 via \`/tutorial:deep-dive\`.

## Configuration

- **Project Name**: ${config.projectName}
- **Target Audience**: ${config.audience}
- **Learning Goals**: ${config.goals.join(", ")}
- **Scope**: ${config.scope}
- **Include Quizzes**: ${config.includeQuizzes ? "Yes (in Pass 2)" : "No"}
- **Include Diagrams**: ${config.includeDiagrams ? "Yes (in Pass 2)" : "No"}
- **Tech Stack**: ${config.techStack}

## Requirements

### 1. Project Structure

Create a ${config.techStack === "react" ? "Vite + React + TypeScript" : config.techStack === "vue" ? "Vite + Vue + TypeScript" : config.techStack === "svelte" ? "Vite + Svelte" : "static HTML"} tutorial app with:
- Clean navigation (sidebar with chapter list)
- Progress tracking (use localStorage)
- Responsive design (mobile-friendly sidebar toggle)
- Syntax-highlighted code blocks (using prism-react-renderer with vsLight theme)
- Google Fonts: Noto Sans for body text, Source Code Pro for code blocks

### 2. Surface Analysis

Explore the source codebase and create SKELETON chapters covering:
- **Architecture Overview**: High-level structure, directory tree, main modules
- **Key Modules**: Brief description of what each module does
- **Data Flow**: Surface-level description of how data moves
- **TypeScript Patterns**: Note key types and interfaces (no deep analysis yet)
- **Configuration & Entry Points**: List entry points and config files
${config.scope === "comprehensive" ? "- **All Files**: Brief mention of every production file" : ""}

### 3. Skeleton Chapter Structure

Each chapter should include:
- Clear title and 1-2 paragraph overview
- "Files Covered" section listing the relevant source files with paths
- A placeholder note: "🔍 This chapter will be expanded with detailed analysis via deep-dive."
- Navigation to next/previous chapter
- DO NOT include: detailed code walkthroughs, quizzes, or diagrams (those are Pass 2)

### 4. Interactive Elements (Pass 1)

- Progress tracking with completion indicators
- "Continue where you left off" functionality
- Clean sidebar navigation
${config.includeQuizzes ? "- Quiz placeholder sections (to be filled in Pass 2)" : ""}
${config.includeDiagrams ? "- Diagram placeholder sections (to be filled in Pass 2)" : ""}

### 5. Styling

- Light theme with clear visual hierarchy
- Use Google Fonts: Noto Sans for body text, Source Code Pro for code blocks
- Use prism-react-renderer for syntax highlighting with the vsLight theme
- Proper spacing and accessibility (44px touch targets)
- Hover/focus states for all interactive elements

### 6. Chapters Index

After creating all chapters, generate a \`${CHAPTERS_FILENAME}\` file with:

\`\`\`json
{
  "version": 1,
  "updatedAt": "<ISO timestamp>",
  "config": {
    "tutorialDir": "${config.tutorialDir}",
    "sourceDir": "${config.sourceDir}",
    "projectName": "${config.projectName}",
    "audience": "${config.audience}",
    "goals": ${JSON.stringify(config.goals)},
    "scope": "${config.scope}",
    "includeQuizzes": ${config.includeQuizzes},
    "includeDiagrams": ${config.includeDiagrams},
    "techStack": "${config.techStack}"
  },
  "chapters": [
    {
      "id": "<kebab-case-chapter-id>",
      "title": "<chapter title>",
      "sourceFiles": ["relative/path/file1.ts", "relative/path/file2.ts"],
      "chapterFile": "src/chapters/ChapterName.tsx"
    }
  ]
}
\`\`\`

For each chapter:
- \`sourceFiles\`: every source file referenced, relative to "${config.sourceDir}". Support glob patterns.
- \`chapterFile\`: path to the chapter component file, relative to "${config.tutorialDir}"
- This index enables \`/tutorial:deep-dive\` for chapter expansion and \`/tutorial:update\` for drift detection

### 7. Project README

Create a \`README.md\`:

\`\`\`markdown
# ${config.projectName} - Tutorial

## Project Details

| Property | Value |
|----------|-------|
| **Source Project** | ${inferProjectName(config.sourceDir)} |
| **Source Location** | \`${config.sourceDir}\` |
| **Based On Commit** | \`<git commit hash>\` |
| **Status** | 🏗️ Skeleton (Pass 1) — use \`/tutorial:deep-dive\` to expand |

---

## Table of Contents

<!-- AUTO-GENERATED: Chapters will be listed here -->

---

## Update History

| Date | Version | Update Details |
|------|---------|----------------|
| YYYY-MM-DD | 0.1.0 | Skeleton tutorial created (Pass 1) |

---

*This README is automatically generated. For interactive tutorial experience, run the tutorial app.*
\`\`\`

## Process

1. **Explore**: Analyze the source codebase at "${config.sourceDir}" — directory structure, key files, architecture pattern
2. **Scaffold**: Create the tutorial project in "${config.tutorialDir}" with full navigation and styling
3. **Write Skeletons**: Create thin chapter content with file references
4. **Generate Index**: Create \`${CHAPTERS_FILENAME}\` with config and chapter-to-files mapping
5. **Create README**: Generate \`README.md\` with project details
6. **Test**: Ensure the tutorial builds and runs

Start by exploring the source codebase at "${config.sourceDir}" and then create the skeleton tutorial in "${config.tutorialDir}".`;
}

// ─── Deep-Dive Prompt Builder ─────────────────────────────────────────

function buildDeepDivePrompt(
	tutorialDir: string,
	sourceDir: string,
	chapters: ChapterEntry[],
	config: TutorialConfig | undefined,
): string {
	const audience = config?.audience || "Developers familiar with the language but new to this codebase";
	const goals = config?.goals || ["Navigate the codebase", "Understand architecture patterns"];
	const scope = config?.scope || "detailed";
	const includeQuizzes = config?.includeQuizzes ?? true;
	const includeDiagrams = config?.includeDiagrams ?? true;
	const techStack = config?.techStack || "react";

	const chapterCount = chapters.length;
	const isSingle = chapterCount === 1;

	let prompt = `Perform a DEEP DIVE (Pass 2) to expand ${isSingle ? "a" : chapterCount} skeleton tutorial chapter${isSingle ? "" : "s"} with detailed analysis.

**Tutorial Directory**: ${tutorialDir}
**Source Codebase**: ${sourceDir}
**Chapters to expand**: ${chapterCount}

## Overview

A skeleton tutorial was created in Pass 1 with surface-level analysis. Your job is to expand ${isSingle ? "this chapter" : "each chapter"} with rich, detailed content by thoroughly analyzing the source code.

## Target Chapter${isSingle ? "" : "s"}

`;

	for (let i = 0; i < chapters.length; i++) {
		const ch = chapters[i];
		prompt += `### ${i + 1}. ${ch.title} (\`${ch.id}\`)\n`;
		prompt += `**Source files**: ${ch.sourceFiles.map(f => `\`${f}\``).join(", ")}\n`;
		if (ch.chapterFile) {
			prompt += `**Chapter component**: \`${ch.chapterFile}\`\n`;
		}
		prompt += "\n";
	}

	prompt += `## Instructions

For ${isSingle ? "this chapter" : "EACH chapter"} listed above, follow this process:

### Step 1: Read Source Files
Read every source file listed in the chapter's \`sourceFiles\` from "${sourceDir}". As you read, identify:
- Design patterns and their rationale
- Key abstractions and interfaces
- Data flow in and out of the module
- Error handling strategies
- Edge cases and corner cases
- Dependencies on other modules

### Step 2: Generate Analysis Questions
Based on the surface analysis in the skeleton, formulate 3-5 deeper questions:
- What patterns are used and WHY were they chosen over alternatives?
- How does this module interact with others in the broader system?
- What are the common pitfalls or edge cases a developer should know?
- What key abstractions exist and what problems do they solve?
- How would a developer extend or modify this code?

### Step 3: Expand Chapter Content
Read the current skeleton chapter component${chapters.some(ch => ch.chapterFile) ? " (paths listed above)" : " in the tutorial project"}, then replace the skeleton content with rich, detailed content:

- **Detailed code walkthroughs**: Show key code snippets with line-by-line explanations using prism-react-renderer (vsLight theme)
- **Pattern explanations**: Explain not just WHAT but WHY — design decisions, trade-offs, alternatives considered
- **Data flow analysis**: How data moves through the module with concrete examples
- **Cross-references**: Link to related chapters where relevant
${includeQuizzes ? "- **Quizzes**: Multiple-choice knowledge-check questions testing deep understanding, with explanations for each answer" : "- **Key takeaways**: Summary of the most important concepts"}
${includeDiagrams ? "- **Diagrams**: SVG diagrams showing architecture, data flow, or component relationships" : "- **Text-based descriptions**: Clear structured descriptions of architecture and flow"}
- **Progressive complexity**: Start with simple concepts, build to advanced topics
- Remove the \"🔍 This chapter will be expanded...\" placeholder note

### Step 4: Update Supporting Files
- Update \`${CHAPTERS_FILENAME}\` if you discover new source files that should be referenced in any chapter
- Ensure each chapter component renders all new content correctly
- Test that the tutorial still builds and runs

## Configuration
- **Audience**: ${audience}
- **Learning Goals**: ${goals.join(", ")}
- **Scope**: ${scope}
- **Tech Stack**: ${techStack}
${includeQuizzes ? "- **Include Quizzes**: Yes" : "- **Include Quizzes**: No"}
${includeDiagrams ? "- **Include Diagrams**: Yes" : "- **Include Diagrams**: No"}

## Quality Guidelines
- Every code snippet should have context and explanation — never show raw code without commentary
- Explain the \"why\" behind design decisions, not just the \"what\"
- Use analogies where helpful for the target audience (${audience})
- Progressive complexity: start simple, add depth gradually
- Each chapter should read like a well-written technical blog post
- Code snippets: prism-react-renderer with vsLight theme
- Body text: Noto Sans font, Code: Source Code Pro font
${techStack === "react" ? "- Use prism-react-renderer's <Highlight> component or a shared <CodeBlock> wrapper for code snippets" : ""}

## Process
1. Read the current skeleton chapter component for the first chapter
2. Read all source files referenced by that chapter
3. Analyze deeply and expand the chapter content
4. Repeat for each remaining chapter
5. Update \`${CHAPTERS_FILENAME}\` if file references changed
6. Update the README.md status from \"🏗️ Skeleton\" to \"✅ Complete\" and version to 1.0.0
7. Verify the tutorial builds and runs correctly

Start by reading the chapter components and source files for the first chapter: **${chapters[0].title}** (\`${chapters[0].id}\`).`;

	return prompt;
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
			body: `Set up the ${config.techStack} project in ${config.tutorialDir} with Vite, TypeScript, prism-react-renderer (vsLight theme), navigation, and progress tracking.`,
		},
		{
			title: "Create skeleton chapters with file references",
			tags: ["tutorial", "content"],
			body: "Create thin chapter content: title, 1-2 paragraph overview, and file references. Each chapter should have a deep-dive placeholder. DO NOT write detailed walkthroughs yet.",
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
