/**
 * Tutorial Extension — Constants & Shared State
 */

export const CHAPTERS_FILENAME = "chapters.json";
export const TODOS_DIR_NAME = ".pi/todos";
export const README_FILENAME = "README.md";
export const DEFAULT_CONCURRENCY = 4;

/**
 * Module-level state for active tmux deep-dive sessions.
 * Used for cleanup on shutdown.
 */
export let activeDeepDiveSession: { sessionName: string; tmpDir: string } | null = null;

export function setActiveDeepDiveSession(session: { sessionName: string; tmpDir: string } | null): void {
	activeDeepDiveSession = session;
}

export function getActiveDeepDiveSession(): { sessionName: string; tmpDir: string } | null {
	return activeDeepDiveSession;
}
