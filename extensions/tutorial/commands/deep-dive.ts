/**
 * /tutorial:deep-dive Command
 *
 * Deep-dive expansion of skeleton tutorial chapters (Pass 2).
 * Supports:
 *   - Single chapter: inline mode (prompt sent directly)
 *   - Multi-chapter with tmux: parallel mode (analysis -> fork workers)
 *   - Multi-chapter without tmux: inline fallback
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import * as os from "node:os";

import { DEFAULT_CONCURRENCY, CHAPTERS_FILENAME, setActiveDeepDiveSession } from "../constants.js";
import { loadChaptersIndex } from "../utils/chapters.js";
import { parseReadme } from "../utils/readme.js";
import { checkTmuxAvailable, sanitizeTmuxName } from "../utils/tmux.js";
import { buildDeepDivePrompt } from "../prompts/deep-dive.js";
import { buildAnalysisPrompt } from "../prompts/analysis.js";
import { buildWorkerTaskPrompt } from "../prompts/worker.js";
import type { TutorialConfig, ChapterEntry, DeepDiveChapterStatus } from "../types.js";

// ─── Command Registration ────────────────────────────────────────────

export function registerTutorialDeepDiveCommand(pi: ExtensionAPI) {
	const DEEP_DIVE_DESCRIPTION =
		"Deep-dive into skeleton tutorial chapters with detailed analysis. " +
		"Expands all chapters or a specific chapter. " +
		"Usage: /tutorial:deep-dive <tutorial-dir> [source-code-dir] [chapter-id] [--concurrency N]";

	const handler = async (args: string, ctx: ExtensionContext) => {
		const argParts = (args || "").trim().split(/\s+/).filter(Boolean);

		if (argParts.length < 1) {
			ctx.ui.notify("Usage: /tutorial:deep-dive <tutorial-dir> [source-code-dir] [chapter-id] [--concurrency N]", "error");
			return;
		}

		const parsed = parseDeepDiveArgs(argParts);
		if (!parsed.tutorialDir) {
			ctx.ui.notify("Usage: /tutorial:deep-dive <tutorial-dir> [source-code-dir] [chapter-id] [--concurrency N]", "error");
			return;
		}

		// Load chapters index
		const chaptersIndex = loadChaptersIndex(parsed.tutorialDir);
		if (!chaptersIndex || chaptersIndex.chapters.length === 0) {
			emitNoChaptersError(pi, ctx, parsed.tutorialDir);
			return;
		}

		// Determine source directory
		const sourceDir = resolveSourceDir(parsed.tutorialDir, parsed.sourceDirOverride, chaptersIndex.config, pi);
		if (!sourceDir) return; // pi.sendUserMessage already called

		// Filter chapters if a specific chapter ID is provided
		const config = chaptersIndex.config;
		let targetChapters: ChapterEntry[];
		if (parsed.chapterId) {
			const normalizedId = parsed.chapterId.toLowerCase().replace(/\s+/g, "-");
			const target = chaptersIndex.chapters.find(
				ch => ch.id === parsed.chapterId || ch.id === normalizedId,
			);
			if (!target) {
				const available = chaptersIndex.chapters
					.map(ch => "  - `" + ch.id + "` -> " + ch.title)
					.join("\n");
				ctx.ui.notify("Chapter \"" + parsed.chapterId + "\" not found.", "error");
				pi.sendUserMessage(
					"Chapter `" + parsed.chapterId + "` not found in \"" + parsed.tutorialDir + "\".\n\n" +
					"Available chapters:\n" + available + "\n\n" +
					"Usage: /tutorial:deep-dive " + parsed.tutorialDir + " <chapter-id>",
					{ deliverAs: "steer" },
				);
				return;
			}
			targetChapters = [target];
		} else {
			targetChapters = chaptersIndex.chapters;
		}

		const chapterCount = targetChapters.length;
		const isSingle = chapterCount === 1;

		// Single chapter or no tmux -> inline mode
		if (isSingle || !checkTmuxAvailable()) {
			ctx.ui.notify(
				"Deep diving " + (isSingle ? "chapter: " + targetChapters[0].title : chapterCount + " chapters (inline)") + "...",
				"info",
			);
			const prompt = buildDeepDivePrompt(parsed.tutorialDir, sourceDir, targetChapters, config);
			pi.sendUserMessage(prompt);
			return;
		}

		// Multi-chapter with tmux -> parallel mode
		ctx.ui.notify(
			"Deep diving " + chapterCount + " chapters via tmux (concurrency: " + parsed.concurrency + ")...",
			"info",
		);

		runParallelDeepDive(pi, ctx, parsed.tutorialDir, sourceDir, targetChapters, config, parsed.concurrency).catch(err => {
			ctx.ui.notify("Deep dive error: " + err.message, "error");
			ctx.ui.setWidget("tutorial-deep-dive", []);
		});
	};

	pi.registerCommand("tutorial:deep-dive", {
		description: DEEP_DIVE_DESCRIPTION,
		handler,
	});
}

// ─── Argument Parsing ────────────────────────────────────────────────

interface ParsedDeepDiveArgs {
	tutorialDir: string | null;
	sourceDirOverride: string | null;
	chapterId: string | null;
	concurrency: number;
}

function parseDeepDiveArgs(argParts: string[]): ParsedDeepDiveArgs {
	let tutorialDir: string | null = null;
	let sourceDirOverride: string | null = null;
	let chapterId: string | null = null;
	let concurrency = DEFAULT_CONCURRENCY;
	const positionalArgs: string[] = [];

	const looksLikePathArg = (value: string): boolean => {
		return (
			value.startsWith("/") ||
			value.startsWith("./") ||
			value.startsWith("../") ||
			value.startsWith("~/") ||
			value.startsWith("@") ||
			value.includes("/")
		);
	};

	for (let i = 0; i < argParts.length; i++) {
		const part = argParts[i];
		if (part === "--concurrency" && i + 1 < argParts.length) {
			const val = parseInt(argParts[i + 1], 10);
			if (val > 0) concurrency = val;
			i++;
		} else if (part.startsWith("--concurrency=")) {
			const val = parseInt(part.split("=")[1], 10);
			if (val > 0) concurrency = val;
		} else if (part === "--source" && i + 1 < argParts.length) {
			sourceDirOverride = argParts[i + 1].startsWith("@") ? argParts[i + 1].slice(1) : argParts[i + 1];
			i++;
		} else if (part.startsWith("--source=")) {
			const value = part.split("=").slice(1).join("=");
			sourceDirOverride = value.startsWith("@") ? value.slice(1) : value;
		} else if (!part.startsWith("--")) {
			positionalArgs.push(part);
		}
	}

	tutorialDir = positionalArgs[0] || null;
	if (tutorialDir?.startsWith("@")) {
		tutorialDir = tutorialDir.slice(1);
	}
	if (positionalArgs.length > 1) {
		const second = positionalArgs[1];
		const third = positionalArgs[2];
		if (!sourceDirOverride && looksLikePathArg(second)) {
			sourceDirOverride = second.startsWith("@") ? second.slice(1) : second;
			chapterId = third || null;
		} else {
			chapterId = second;
			if (!sourceDirOverride && third && looksLikePathArg(third)) {
				sourceDirOverride = third.startsWith("@") ? third.slice(1) : third;
			}
		}
	}

	return { tutorialDir, sourceDirOverride, chapterId, concurrency };
}

// ─── Error Helpers ───────────────────────────────────────────────────

function emitNoChaptersError(pi: ExtensionAPI, ctx: ExtensionContext, tutorialDir: string): void {
	const readme = parseReadme(tutorialDir);
	const sourceInfo = readme?.sourceDir
		? "\nFound README.md with source at `" + readme.sourceDir + "`."
		: "\nNo README.md found either.";

	ctx.ui.notify("No " + CHAPTERS_FILENAME + " found in \"" + tutorialDir + "\".", "error");
	pi.sendUserMessage(
		"No " + CHAPTERS_FILENAME + " found in \"" + tutorialDir + "\".\n\n" +
		"Deep-dive requires a skeleton tutorial created with `/tutorial:create`.\n\n" +
		"Please run `/tutorial:create " + tutorialDir + "` first to create the skeleton tutorial." +
		sourceInfo,
		{ deliverAs: "steer" },
	);
}

// ─── Source Dir Resolution ───────────────────────────────────────────

function resolveSourceDir(
	tutorialDir: string,
	sourceDirOverride: string | null,
	config: TutorialConfig | undefined,
	pi: ExtensionAPI,
): string | null {
	if (sourceDirOverride) return sourceDirOverride;
	if (config?.sourceDir) return config.sourceDir;

	const readme = parseReadme(tutorialDir);
	if (readme?.sourceDir) return readme.sourceDir;

	pi.sendUserMessage(
		"Cannot determine source codebase location for tutorial at \"" + tutorialDir + "\".\n\n" +
		"The " + CHAPTERS_FILENAME + " doesn't have a config section with sourceDir, and no README.md was found.\n\n" +
		"Please either:\n" +
		"- Re-create the tutorial with `/tutorial:create` (which saves config to chapters.json)\n" +
		"- Or add a \"config\" section to " + CHAPTERS_FILENAME + " with the \"sourceDir\" field",
		{ deliverAs: "steer" },
	);
	return null;
}

// ─── Parallel Deep-Dive Orchestrator ─────────────────────────────────

async function runParallelDeepDive(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	tutorialDir: string,
	sourceDir: string,
	chapters: ChapterEntry[],
	config: TutorialConfig | undefined,
	concurrency: number,
): Promise<void> {
	const projectSlug = sanitizeTmuxName(path.basename(tutorialDir));
	const sessionName = "tdd-" + projectSlug;
	const tmpDir = await mkdtemp(path.join(os.tmpdir(), "tdd-"));
	const sessionDir = path.join(tmpDir, "sessions");

	setActiveDeepDiveSession({ sessionName, tmpDir });

	let analysisStatus: "running" | "done" | "failed" = "running";
	const analysisStartTime = Date.now();
	let analysisEndTime: number | undefined;

	const statuses: DeepDiveChapterStatus[] = chapters.map(ch => ({
		chapter: ch,
		status: "queued",
	}));

	// ─── Widget ───────────────────────────────────────────

	const updateWidget = () => {
		ctx.ui.setWidget("tutorial-deep-dive", (_tui, theme) => {
			const lines: string[] = [
				theme.fg("accent", "--- Deep Dive Progress ---"),
			];

			const analysisIcon =
				analysisStatus === "done" ? theme.fg("success", "OK") :
				analysisStatus === "failed" ? theme.fg("error", "X") :
				theme.fg("accent", "...");
			const analysisDur = analysisEndTime
				? theme.fg("muted", " (" + ((analysisEndTime - analysisStartTime) / 1000).toFixed(0) + "s)")
				: "";
			lines.push("  " + analysisIcon + " " + theme.fg("dim", "analysis") + " Codebase analysis" + analysisDur);

			for (const s of statuses) {
				const icon =
					s.status === "done" ? theme.fg("success", "OK") :
					s.status === "failed" ? theme.fg("error", "X") :
					s.status === "running" ? theme.fg("accent", "...") : ".";
				const dur = s.endTime && s.startTime
					? theme.fg("muted", " (" + ((s.endTime - s.startTime) / 1000).toFixed(0) + "s)")
					: "";
				lines.push("  " + icon + " " + theme.fg("dim", s.chapter.id) + " " + s.chapter.title + dur);
			}

			const done = statuses.filter(s => s.status === "done").length;
			const failed = statuses.filter(s => s.status === "failed").length;
			const running = statuses.filter(s => s.status === "running").length;
			const queued = statuses.filter(s => s.status === "queued").length;
			const phaseLabel = analysisStatus === "running" ? "Phase 1: Analyzing" : "Phase 2: Expanding";
			lines.push(theme.fg("border", "---"));
			lines.push(theme.fg("muted", "  " + phaseLabel + "  " + done + "/" + chapters.length + " done  " + running + " running  " + queued + " queued  " + failed + " failed"));
			lines.push(theme.fg("dim", "  tmux attach -t " + sessionName));

			return {
				render(_width: number): string[] {
					return lines;
				},
				invalidate(): void {},
			};
		});
	};

	// Create tmux session
	try {
		execSync(
			"tmux kill-session -t " + sessionName + " 2>/dev/null; " +
			"tmux new-session -d -s " + sessionName + " -x 200 -y 50",
			{ stdio: ["pipe", "pipe", "pipe"] },
		);
	} catch {
		ctx.ui.notify("Failed to create tmux session. Falling back to inline mode.", "warning");
		const prompt = buildDeepDivePrompt(tutorialDir, sourceDir, chapters, config);
		pi.sendUserMessage(prompt);
		return;
	}

	try {
		execSync("tmux rename-window -t " + sessionName + ":0 \"analysis\"", {
			stdio: ["pipe", "pipe", "pipe"],
		});
	} catch {
		// Non-critical
	}

	updateWidget();
	ctx.ui.notify("Phase 1: Analyzing codebase in tmux session \"" + sessionName + "\"...", "info");

	// ─── Phase 1: Codebase Analysis ──────────────────────

	const analysisPrompt = buildAnalysisPrompt(tutorialDir, sourceDir, chapters, config);
	const analysisPromptPath = path.join(tmpDir, "analysis-prompt.md");
	await writeFile(analysisPromptPath, analysisPrompt, "utf-8");

	const analysisStatusFile = path.join(tmpDir, "analysis-status");
	const analysisSessionPathFile = path.join(tmpDir, "analysis-session-path");
	const escapedCwd = ctx.cwd.replace(/'/g, "'\\''");
	const escapedSessionDir = sessionDir.replace(/'/g, "'\\''");
	const escapedPromptPath = analysisPromptPath.replace(/'/g, "'\\''");
	const escapedStatusFile = analysisStatusFile.replace(/'/g, "'\\''");
	const escapedSessionPathFile = analysisSessionPathFile.replace(/'/g, "'\\''");

	const analysisScript = [
		"#!/bin/bash",
		"cd '" + escapedCwd + "'",
		"echo '=== Phase 1: Codebase Analysis ==='",
		"echo 'Analyzing source files across " + chapters.length + " chapters...'",
		"echo ''",
		"pi --session-dir '" + escapedSessionDir + "' -p --stream=on @'" + escapedPromptPath + "'",
		"EXIT_CODE=$?",
		"SESSION_FILE=$(find '" + escapedSessionDir + "' -name '*.jsonl' -type f 2>/dev/null | sort -r | head -1)",
		"echo \"$SESSION_FILE\" > '" + escapedSessionPathFile + "'",
		"echo ''",
		"if [ $EXIT_CODE -eq 0 ]; then",
		"    echo 'Analysis complete'",
		"else",
		"    echo 'Analysis failed (exit code: $EXIT_CODE)'",
		"fi",
		"echo \"$EXIT_CODE\" > '" + escapedStatusFile + "'",
	].join("\n");

	const analysisScriptPath = path.join(tmpDir, "analyze.sh");
	await writeFile(analysisScriptPath, analysisScript, "utf-8");
	execSync("chmod +x '" + analysisScriptPath.replace(/'/g, "'\\''") + "'");

	try {
		execSync(
			"tmux send-keys -t " + sessionName + ":analysis \"bash '" + analysisScriptPath.replace(/'/g, "'\\''") + "'\" Enter",
			{ stdio: ["pipe", "pipe", "pipe"] },
		);
	} catch {
		ctx.ui.notify("Failed to start analysis. Falling back to inline mode.", "warning");
		const prompt = buildDeepDivePrompt(tutorialDir, sourceDir, chapters, config);
		pi.sendUserMessage(prompt);
		return;
	}

	// Wait for analysis to complete
	const analysisExitCodeStr = await waitForFile(analysisStatusFile);
	const analysisExitCode = parseInt(analysisExitCodeStr, 10);
	analysisEndTime = Date.now();

	if (analysisExitCode !== 0) {
		analysisStatus = "failed";
		updateWidget();
		ctx.ui.notify("Analysis failed (exit code: " + analysisExitCode + "). Falling back to inline mode.", "warning");
		const prompt = buildDeepDivePrompt(tutorialDir, sourceDir, chapters, config);
		pi.sendUserMessage(prompt);
		return;
	}

	// Get the analysis session path for forking
	let analysisSessionPath = "";
	try {
		analysisSessionPath = readFileSync(analysisSessionPathFile, "utf-8").trim();
	} catch {
		// Fall through to fallback search
	}

	if (!analysisSessionPath || !existsSync(analysisSessionPath)) {
		try {
			analysisSessionPath = execSync(
				"find '" + escapedSessionDir + "' -name '*.jsonl' -type f 2>/dev/null | sort -r | head -1",
				{ encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
			).trim();
		} catch {
			// Can't find session
		}
	}

	if (!analysisSessionPath || !existsSync(analysisSessionPath)) {
		analysisStatus = "failed";
		updateWidget();
		ctx.ui.notify("Analysis session file not found. Falling back to inline mode.", "warning");
		const prompt = buildDeepDivePrompt(tutorialDir, sourceDir, chapters, config);
		pi.sendUserMessage(prompt);
		return;
	}

	analysisStatus = "done";
	updateWidget();
	ctx.ui.notify(
		"Phase 2: Forking analysis to " + chapters.length + " chapter workers (concurrency: " + concurrency + ")...",
		"info",
	);

	// ─── Phase 2: Fork Chapter Workers ───────────────────

	for (const chapter of chapters) {
		const task = buildWorkerTaskPrompt(tutorialDir, sourceDir, chapter, config);
		const taskPath = path.join(tmpDir, "task-" + chapter.id + ".md");
		await writeFile(taskPath, task, "utf-8");
	}

	const waitForCompletion = (chapterIndex: number): Promise<void> => {
		return new Promise((resolve) => {
			const chapter = chapters[chapterIndex];
			const statusFile = path.join(tmpDir, "status-" + chapter.id);
			const check = () => {
				if (existsSync(statusFile)) {
					try {
						const exitCode = parseInt(readFileSync(statusFile, "utf-8").trim(), 10);
						statuses[chapterIndex].status = exitCode === 0 ? "done" : "failed";
						statuses[chapterIndex].exitCode = exitCode;
					} catch {
						statuses[chapterIndex].status = "failed";
					}
					statuses[chapterIndex].endTime = Date.now();
					updateWidget();
					resolve();
				} else {
					setTimeout(check, 2000);
				}
			};
			check();
		});
	};

	let nextIndex = 0;
	const poolSize = Math.min(concurrency, chapters.length);
	const escapedAnalysisSession = analysisSessionPath.replace(/'/g, "'\\''");

	const workers = Array.from({ length: poolSize }, async () => {
		while (nextIndex < chapters.length) {
			const currentIndex = nextIndex++;
			const chapter = chapters[currentIndex];
			const windowName = sanitizeTmuxName(
				"ch" + String(currentIndex + 1).padStart(2, "0") + "-" + chapter.id,
			);
			const taskPath = path.join(tmpDir, "task-" + chapter.id + ".md");
			const escapedTaskPath = taskPath.replace(/'/g, "'\\''");
			const workerStatusFile = path.join(tmpDir, "status-" + chapter.id);
			const escapedWorkerStatusFile = workerStatusFile.replace(/'/g, "'\\''");

			statuses[currentIndex].status = "running";
			statuses[currentIndex].startTime = Date.now();
			updateWidget();

			const workerScript = [
				"#!/bin/bash",
				"cd '" + escapedCwd + "'",
				"echo '=== Deep Dive: " + chapter.title + " (" + chapter.id + ") ==='",
				"echo 'Forking from analysis session...'",
				"echo ''",
				"pi --fork '" + escapedAnalysisSession + "' -p --stream=on @'" + escapedTaskPath + "'",
				"EXIT_CODE=$?",
				"echo ''",
				"if [ $EXIT_CODE -eq 0 ]; then",
				"    echo 'Chapter complete: " + chapter.title + "'",
				"else",
				"    echo 'Chapter failed (exit code: $EXIT_CODE): " + chapter.title + "'",
				"fi",
				"echo \"$EXIT_CODE\" > '" + escapedWorkerStatusFile + "'",
			].join("\n");

			const workerScriptPath = path.join(tmpDir, "run-" + chapter.id + ".sh");
			await writeFile(workerScriptPath, workerScript, "utf-8");
			execSync("chmod +x '" + workerScriptPath.replace(/'/g, "'\\''") + "'");

			try {
				execSync(
					"tmux new-window -t " + sessionName + " -n \"" + windowName + "\" \"bash '" + workerScriptPath.replace(/'/g, "'\\''") + "'\"",
					{ stdio: ["pipe", "pipe", "pipe"] },
				);
			} catch {
				statuses[currentIndex].status = "failed";
				statuses[currentIndex].endTime = Date.now();
				updateWidget();
				continue;
			}

			await waitForCompletion(currentIndex);
		}
	});

	await Promise.all(workers);

	// ─── Final Summary ───────────────────────────────────

	const done = statuses.filter(s => s.status === "done").length;
	const failed = statuses.filter(s => s.status === "failed").length;
	const failedChapters = statuses.filter(s => s.status === "failed").map(s => s.chapter.id);
	const totalDuration = statuses.reduce(
		(sum, s) => sum + ((s.endTime && s.startTime) ? (s.endTime - s.startTime) : 0),
		0,
	);
	const analysisDuration = analysisEndTime
		? ((analysisEndTime - analysisStartTime) / 1000).toFixed(0)
		: "?";

	updateWidget();

	let summary: string;
	if (failed === 0) {
		summary =
			"Deep dive complete: **" + done + "/" + chapters.length + "** chapters expanded.\n\n" +
			"Phase 1 (analysis): " + analysisDuration + "s\n" +
			"Phase 2 (chapters): " + (totalDuration / 1000).toFixed(0) + "s across all chapters\n" +
			"tmux session `" + sessionName + "` is still available for review.\n\n" +
			"All chapters expanded successfully. Next steps:\n" +
			"- Verify the tutorial builds and runs correctly\n" +
			"- Update the README.md status to Complete\n" +
			"- Run `/tutorial:update` later to keep chapters in sync with source changes";
	} else {
		const retryLines = failedChapters
			.map(id => "  `/tutorial:deep-dive " + tutorialDir + " " + id + "`")
			.join("\n");
		summary =
			"Deep dive complete: **" + done + "/" + chapters.length + "** chapters expanded, **" + failed + "** failed.\n\n" +
			"Phase 1 (analysis): " + analysisDuration + "s\n" +
			"Phase 2 (chapters): " + (totalDuration / 1000).toFixed(0) + "s across all chapters\n" +
			"tmux session `" + sessionName + "` is still available for review.\n\n" +
			"Failed chapters can be re-run individually:\n" + retryLines;
	}

	pi.sendUserMessage(summary);

	setTimeout(() => {
		ctx.ui.setWidget("tutorial-deep-dive", []);
		setActiveDeepDiveSession(null);
	}, 30000);
}

// ─── File Polling Helper ─────────────────────────────────────────────

function waitForFile(filePath: string): Promise<string> {
	return new Promise((resolve) => {
		const check = () => {
			if (existsSync(filePath)) {
				try {
					resolve(readFileSync(filePath, "utf-8").trim());
				} catch {
					resolve("");
				}
			} else {
				setTimeout(check, 2000);
			}
		};
		check();
	});
}
