/**
 * Lightweight file watcher using Node.js built-in fs.watch.
 *
 * Maintains a "dirty set" of relative file paths that changed since the last
 * time the set was consumed. Does NO background re-indexing — tools read the
 * dirty set lazily before executing queries.
 */
import fs from "node:fs";
import path from "node:path";
import { getSupportedExtensions } from "./languages/registry.js";

export interface WatcherHandle {
	/** Return (and clear) the current dirty set atomically. */
	drainDirty: () => Set<string>;
	/** Number of files currently in the dirty set (peek without clearing). */
	dirtyCount: () => number;
	/** Total files re-indexed via dirty set since last reset. */
	refreshCount: () => number;
	/** Add to the refresh counter (called by tools after re-indexing). */
	addRefresh: (n: number) => void;
	/** Reset the refresh counter. */
	resetRefreshCount: () => void;
	/** Stop watching. */
	stop: () => void;
}

interface WatcherOptions {
	/** Relative directory names to ignore (e.g. "node_modules", ".git"). */
	excludedDirs: Set<string>;
	/** File extensions to watch (with leading dot, e.g. ".ts"). */
	extensions: Set<string>;
	/** Debounce window in ms for duplicate events on the same file. Default: 100. */
	debounceMs?: number;
}

/**
 * Start a recursive fs.watch on `projectRoot`.
 *
 * Returns a handle with `drainDirty()` and `stop()`.
 */
export function startWatcher(
	projectRoot: string,
	options: WatcherOptions,
): WatcherHandle {
	const debounceMs = options.debounceMs ?? 100;
	const dirty = new Set<string>();
	const timestamps = new Map<string, number>(); // path → last event time
	let _refreshCount = 0;
	let closed = false;

	// fs.watch with recursive:true watches the entire subtree
	const watcher = fs.watch(
		projectRoot,
		{ recursive: true },
		(eventType: string, filename: string | null) => {
			if (closed || !filename) return;

			const relPath = filename.replace(/\\/g, "/"); // normalize to forward slashes

			// Check if any path component is in excluded dirs
			const parts = relPath.split("/");
			if (parts.some((p) => options.excludedDirs.has(p))) return;

			// Only track supported file extensions
			const ext = path.extname(relPath).toLowerCase();
			if (!ext || !options.extensions.has(ext)) return;

			// Debounce: skip if we saw this file very recently
			const now = Date.now();
			const last = timestamps.get(relPath) ?? 0;
			if (now - last < debounceMs) return;
			timestamps.set(relPath, now);

			dirty.add(relPath);
		},
	);

	watcher.on("error", (err) => {
		// Silently ignore — watcher may fire errors for deleted dirs etc.
		console.error(`[code-nav] watcher error: ${(err as Error).message}`);
	});

	return {
		drainDirty() {
			const snapshot = new Set(dirty);
			dirty.clear();
			return snapshot;
		},
		dirtyCount() {
			return dirty.size;
		},
		refreshCount: () => _refreshCount,
		addRefresh: (n: number) => { _refreshCount += n; },
		resetRefreshCount: () => { _refreshCount = 0; },
		stop() {
			closed = true;
			watcher.close();
		},
	};
}
