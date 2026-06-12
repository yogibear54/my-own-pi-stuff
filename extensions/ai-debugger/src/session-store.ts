/**
 * Session store — manages debug session lifecycle and persistence.
 *
 * Design:
 * - The extension enforces **one active session at a time** (per Section 13, decision #6).
 *   Attempting to create a second session while one is active throws an error.
 * - The active session is held in memory (`this.active`) for fast access by tools
 *   and commands. Every mutation writes to disk immediately (synchronous) so the
 *   session survives a pi crash or unexpected exit.
 * - Past sessions (completed/aborted) are not kept in memory. They are loaded
 *   lazily from disk when `get()`, `list()`, or `findActiveOnDisk()` is called.
 *
 * Storage layout:
 * ```
 * .pi/debug/
 *   <session-id>/
 *     session.json    ← full session state (DebugSession serialized as JSON)
 *     logs.jsonl      ← appended by LogCollector (separate concern)
 * ```
 *
 * Thread safety: This is single-threaded (Node.js). All methods are synchronous.
 * No locking is needed because pi's extension runtime is single-process.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type {
	DebugSession,
	Hypothesis,
	InstrumentedFile,
	AppliedFix,
} from "./types.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function generateId(): string {
	return crypto.randomBytes(4).toString("hex");
}

function now(): number {
	return Date.now();
}

// ── SessionStore ──────────────────────────────────────────────────────────

export class SessionStore {
	private readonly debugDir: string;
	private active: DebugSession | null = null;

	constructor(projectRoot: string) {
		this.debugDir = path.join(projectRoot, ".pi", "debug");
	}

	// ── Create ────────────────────────────────────────────────────────────

	/**
	 * Create a new debug session.
	 *
	 * Called by `/debug start` command. Generates a unique 8-char hex ID,
	 * initializes the session in the `understand` phase (the LLM is reading
	 * the codebase), and persists to disk.
	 *
	 * @param description - Human-readable bug description (e.g., "Checkout crashes with 3 items")
	 * @param maxIterations - Max fix attempts before giving up (default 5, per config)
	 * @returns The newly created session
	 * @throws If a session is already active — the caller must `/debug cleanup` or `/debug abort` first
	 */
	create(description: string, maxIterations = 5): DebugSession {
		if (this.active) {
			throw new Error(
				`A debug session is already active (${this.active.id}). Run cleanup or abort first.`,
			);
		}

		const session: DebugSession = {
			id: generateId(),
			description,
			status: "active",
			phase: "understand",
			iteration: 1,
			maxIterations,
			createdAt: now(),
			updatedAt: now(),
			hypotheses: [],
			instrumentedFiles: [],
			fixes: [],
			logCount: 0,
		};

		this.active = session;
		this.persist(session);
		return session;
	}

	// ── Read ──────────────────────────────────────────────────────────────

	/**
	 * Get a session by ID.
	 *
	 * Checks the in-memory cache first (O(1) for the active session), then
	 * falls back to loading from disk. Used by tools that receive a sessionId
	 * parameter and by commands that need to inspect past sessions.
	 *
	 * @param id - The session ID (8-char hex)
	 * @returns The session, or undefined if not found
	 */
	get(id: string): DebugSession | undefined {
		if (this.active?.id === id) return this.active;
		return this.loadFromDisk(id);
	}

	/**
	 * Get the currently active session.
	 *
	 * This is the hot path — every tool and command calls this to check whether
	 * a debug session is in progress. Returns undefined if no session is active
	 * (e.g., before `/debug start` or after `/debug cleanup`).
	 *
	 * @returns The active session, or undefined
	 */
	getActive(): DebugSession | undefined {
		return this.active ?? undefined;
	}

	/**
	 * Scan the `.pi/debug/` directory for the most recently updated active session.
	 *
	 * Called on pi startup (in the `session_start` event handler) to recover from
	 * a crash or unexpected exit. If the user had an active debug session when pi
	 * died, this finds it so the extension can restore it and warn about uncleaned
	 * instrumentation.
	 *
	 * Skips sessions with status `completed` or `aborted` — those don't need recovery.
	 *
	 * @returns The most recently updated active session, or undefined if none found
	 */
	findActiveOnDisk(): DebugSession | undefined {
		if (!fs.existsSync(this.debugDir)) return undefined;

		const dirs = fs
			.readdirSync(this.debugDir, { withFileTypes: true })
			.filter((d) => d.isDirectory());

		// Find most recently updated active session
		let latest: DebugSession | undefined;
		for (const dir of dirs) {
			const session = this.loadFromDisk(dir.name);
			if (session?.status === "active") {
				if (!latest || session.updatedAt > latest.updatedAt) {
					latest = session;
				}
			}
		}

		return latest;
	}

	/**
	 * Set a session as the active in-memory session.
	 *
	 * Used on startup after `findActiveOnDisk()` locates a session to recover.
	 * Also used internally by `create()` after clearing the previous active session.
	 *
	 * @param session - The session to set as active (must have status "active")
	 */
	restore(session: DebugSession): void {
		this.active = session;
	}

	/**
	 * List all sessions, sorted by creation date (newest first).
	 *
	 * Called by `/debug history` command. Combines the in-memory active session
	 * with all sessions found on disk. Useful for showing the user a log of past
	 * debugging efforts.
	 *
	 * @returns Array of all sessions, newest first
	 */
	list(): DebugSession[] {
		const sessions: DebugSession[] = [];

		if (this.active) {
			sessions.push(this.active);
		}

		if (fs.existsSync(this.debugDir)) {
			const dirs = fs
				.readdirSync(this.debugDir, { withFileTypes: true })
				.filter((d) => d.isDirectory());

			for (const dir of dirs) {
				if (this.active?.id === dir.name) continue;
				const session = this.loadFromDisk(dir.name);
				if (session) sessions.push(session);
			}
		}

		sessions.sort((a, b) => b.createdAt - a.createdAt);
		return sessions;
	}

	// ── Update ────────────────────────────────────────────────────────────

	/**
	 * Apply a partial update to a session.
	 *
	 * Generic mutator used for phase transitions (e.g., `observe` → `fix`),
	 * status changes (`active` → `completed`), and setting confirmedHypothesis.
	 * Always bumps `updatedAt` and persists to disk.
	 *
	 * @param id - Session ID
	 * @param partial - Fields to merge onto the session (updatedAt is auto-set)
	 * @throws If the session is not found
	 */
	update(id: string, partial: Partial<DebugSession>): void {
		const session = this.get(id);
		if (!session) throw new Error(`Session not found: ${id}`);

		Object.assign(session, partial, { updatedAt: now() });
		this.persist(session);
	}

	/**
	 * Add a hypothesis to a session.
	 *
	 * Called by the `debug_hypothesize` tool after the LLM generates hypotheses.
	 * Each hypothesis gets a 1-indexed ID assigned by the tool before being stored.
	 * Multiple hypotheses can be added per session (typically 2-5, per FR-2.2).
	 *
	 * @param sessionId - Session to add the hypothesis to
	 * @param hypothesis - The hypothesis object (id, description, confidence, files, plan, status)
	 * @throws If the session is not found
	 */
	addHypothesis(sessionId: string, hypothesis: Hypothesis): void {
		const session = this.get(sessionId);
		if (!session) throw new Error(`Session not found: ${sessionId}`);

		session.hypotheses.push(hypothesis);
		session.updatedAt = now();
		this.persist(session);
	}

	/**
	 * Record an instrumented file in the session.
	 *
	 * Called by the `debug_instrument` tool for each file it modifies. Stores the
	 * original content (for abort/revert) and the line ranges of injected markers.
	 *
	 * **Merge behavior:** If the same file path is already tracked (e.g., the LLM
	 * instruments the same file for hypothesis 2 after hypothesis 1), the new
	 * changes are appended to the existing entry rather than creating a duplicate.
	 * This keeps `cleanup` and `abort` simple — one entry per file.
	 *
	 * @param sessionId - Session to add the file to
	 * @param file - The instrumented file (path, originalContent, changes[])
	 * @throws If the session is not found
	 */
	addInstrumentedFile(sessionId: string, file: InstrumentedFile): void {
		const session = this.get(sessionId);
		if (!session) throw new Error(`Session not found: ${sessionId}`);

		// If the same file is already tracked, append changes; otherwise add new entry
		const existing = session.instrumentedFiles.find((f) => f.path === file.path);
		if (existing) {
			existing.changes.push(...file.changes);
		} else {
			session.instrumentedFiles.push(file);
		}

		session.updatedAt = now();
		this.persist(session);
	}

	/**
	 * Record an applied fix in the session.
	 *
	 * Called by the `debug_fix` tool after the LLM applies a code fix. The fix is
	 * tracked separately from instrumentation so that `debug_cleanup` knows what
	 * to keep (the fix) vs. what to remove (the instrumentation markers).
	 *
	 * Each fix records the iteration number, which hypothesis it targets, and the
	 * files changed. After the user verifies, `userFeedback` is set to
	 * `"fixed"`, `"not_fixed"`, or `"partial"`.
	 *
	 * @param sessionId - Session to add the fix to
	 * @param fix - The applied fix (iteration, hypothesisId, files, verified)
	 * @throws If the session is not found
	 */
	addFix(sessionId: string, fix: AppliedFix): void {
		const session = this.get(sessionId);
		if (!session) throw new Error(`Session not found: ${sessionId}`);

		session.fixes.push(fix);
		session.updatedAt = now();
		this.persist(session);
	}

	/**
	 * Increment the log count for a session.
	 *
	 * Called by the LogCollector each time a new log entry is received via
	 * `POST /log`. Used by the status widget and `/debug status` to show how
	 * many logs have been collected.
	 *
	 * Silently does nothing if the session is not found — the collector may
	 * receive stale logs after a session ends.
	 *
	 * @param sessionId - Session to increment
	 */
	incrementLogCount(sessionId: string): void {
		const session = this.get(sessionId);
		if (!session) return;

		session.logCount++;
		session.updatedAt = now();
		this.persist(session);
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────

	/**
	 * Clear the in-memory active session reference.
	 *
	 * Called by `/debug cleanup` and `/debug abort` after the session has been
	 * finalized (status set to `completed` or `aborted`). Does NOT delete the
	 * session from disk — it remains accessible via `get()` and `list()` for
	 * history. Simply allows a new session to be created.
	 *
	 * The session on disk keeps its original status. If the process crashes
	 * before this is called, `findActiveOnDisk()` will still find the session
	 * on next startup.
	 */
	clearActive(): void {
		this.active = null;
	}

	// ── Persistence (private) ─────────────────────────────────────────────

	/** File path for a session's directory on disk. */
	private sessionDir(id: string): string {
		return path.join(this.debugDir, id);
	}

	/** File path for a session's JSON file on disk. */
	private sessionFile(id: string): string {
		return path.join(this.sessionDir(id), "session.json");
	}

	/**
	 * Write a session to disk as formatted JSON.
	 *
	 * Called after every mutation (create, update, addHypothesis, etc.) to ensure
	 * the session survives a crash. Creates the directory if it doesn't exist.
	 *
	 * Also callable externally (used by the `session_shutdown` handler to persist
	 * state before the process exits).
	 *
	 * @param session - The session to persist
	 */
	persist(session: DebugSession): void {
		const dir = this.sessionDir(session.id);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(this.sessionFile(session.id), JSON.stringify(session, null, 2), "utf-8");
	}

	/**
	 * Load a session from disk by ID.
	 *
	 * Reads and parses the `session.json` file. Returns undefined if the file
	 * doesn't exist or is corrupted (malformed JSON). This is the fallback path
	 * for `get()` when the session isn't in the in-memory cache.
	 *
	 * @param id - Session ID to load
	 * @returns The deserialized session, or undefined
	 */
	private loadFromDisk(id: string): DebugSession | undefined {
		const file = this.sessionFile(id);
		if (!fs.existsSync(file)) return undefined;

		try {
			const raw = fs.readFileSync(file, "utf-8");
			return JSON.parse(raw) as DebugSession;
		} catch {
			return undefined;
		}
	}
}
