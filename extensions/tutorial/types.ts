/**
 * Tutorial Extension Types
 *
 * All TypeScript interfaces and types used by the tutorial extension.
 */

export interface TutorialConfig {
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

export interface ChaptersIndex {
	version: number;
	updatedAt: string;
	config?: TutorialConfig;
	chapters: ChapterEntry[];
}

export interface ChapterEntry {
	id: string;
	title: string;
	sourceFiles: string[]; // relative paths from sourceDir
	chapterFile?: string;  // relative path to chapter component in tutorialDir
}

export interface ReadmeContent {
	basedOnCommit: string;
	sourceDir: string;
}

export interface TodoResult {
	created: boolean;
	message: string;
	todos?: Array<{ id: string; title: string }>;
	todoPath?: string;
}

export interface TodoFile {
	id: string;
	title: string;
	tags: string[];
	status: string;
	created_at: string;
	body: string;
}

export interface TodoItem {
	title: string;
	tags: string[];
	body: string;
}

// Git-related types
export interface GitChange {
	path: string;
	status: "modified" | "deleted" | "new";
}

export interface ChangedFile {
	path: string;
	status: "modified" | "deleted" | "new";
}

export interface OutdatedChapter {
	id: string;
	title: string;
	changedFiles: ChangedFile[];
}

export interface UpToDateChapter {
	id: string;
	title: string;
}

export interface DriftResult {
	outdatedChapters: OutdatedChapter[];
	upToDateChapters: UpToDateChapter[];
}