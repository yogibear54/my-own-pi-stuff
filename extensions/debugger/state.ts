/**
 * Debug session state — the canonical, persisted state machine + snippet map.
 *
 * Owned here; index.ts wires persistence (`appendEntry`) and widget sync
 * (`syncSnapshot`) via {@link init}. tools.ts mutates through the accessors.
 * Every mutator updates `current` then calls the persisted + change callbacks,
 * so state changes are durable and the widget stays in sync.
 *
 * Reference: docs/05-debugging-loop.md
 */
import type { DebugStateName } from "./widget.ts";

/** Max fix attempts per hypothesis before falling back to AWAITING CONTEXT. */
export const DEFAULT_MAX_ATTEMPTS = 3;

/** A tracked telemetry snippet. */
export interface SnippetInfo {
	file: string;
	name: string;
	line: number;
}

/** Persisted debug session state. */
export interface DebugState {
	active: boolean;
	mode: "local" | "remote";
	state: DebugStateName;
	bug: string | null;
	hypothesis: string | null;
	hypothesisCount: number;
	attempts: number;
	snippetMap: Record<number, SnippetInfo>;
	telemetryTarget: string;
}

let current: DebugState | null = null;
let persistFn: () => void = () => {};
let onChangeFn: () => void = () => {};

/** Wire persistence + widget-sync callbacks (called once from index.ts). */
export function init(opts: { persist: () => void; onChange: () => void }): void {
	persistFn = opts.persist;
	onChangeFn = opts.onChange;
}

export function getState(): DebugState | null {
	return current;
}

/** Replace current state outright (used on start/resume), then persist + notify. */
export function setState(next: DebugState): void {
	current = next;
	commit();
}

/** Clear state entirely (session stopped); persist + notify so resume sees no session. */
export function clearState(): void {
	current = null;
	commit();
}

export function initialDebugState(mode: "local" | "remote", telemetryTarget: string): DebugState {
	return {
		active: true,
		mode,
		state: "AWAITING CONTEXT",
		bug: null,
		hypothesis: null,
		hypothesisCount: 0,
		attempts: 0,
		snippetMap: {},
		telemetryTarget,
	};
}

/** Reset for a new bug within the same session (debug_summary "Continue"). */
export function resetForNewBug(): void {
	update((s) => {
		s.state = "AWAITING CONTEXT";
		s.bug = null;
		s.hypothesis = null;
		s.hypothesisCount = 0;
		s.attempts = 0;
	});
}

// --- mutator core ---------------------------------------------------------

/** Mutate current via an updater, then persist + notify. No-op if no state. */
function update(fn: (s: DebugState) => void): void {
	if (!current) return;
	fn(current);
	commit();
}

function commit(): void {
	persistFn();
	onChangeFn();
}

function computeNextId(map: Record<number, SnippetInfo>): number {
	let n = 1;
	while (map[n]) n++;
	return n;
}

// --- snippet map accessors ------------------------------------------------

/**
 * Hybrid id: use `requested` if valid + free, else auto-assign the next free id.
 * The id is RESERVED immediately (placeholder entry) so concurrent assigns — e.g.
 * two parallel injects into different files — never collide. `trackSnippet` fills in
 * the real info; `untrackSnippet` releases the reservation if the inject fails.
 */
export function assignSnippetId(requested: number | undefined): number {
	if (!current) throw new Error("No active debug session.");
	let id: number;
	if (requested != null && !current.snippetMap[requested]) id = requested;
	else id = computeNextId(current.snippetMap);
	current.snippetMap[id] = { file: "", name: "", line: 0 }; // reserve
	commit();
	return id;
}

export function trackSnippet(id: number, info: SnippetInfo): void {
	update((s) => {
		s.snippetMap[id] = info;
	});
}

export function untrackSnippet(id: number): void {
	update((s) => {
		delete s.snippetMap[id];
	});
}

export function getSnippetMap(): Record<number, SnippetInfo> {
	return current?.snippetMap ?? {};
}

export function clearSnippets(): void {
	update((s) => {
		s.snippetMap = {};
	});
}

// --- bug / hypothesis / transitions --------------------------------------

/** Set/clear the bug summary (null/blank → clears). */
export function setBug(summary: string | null): void {
	update((s) => {
		const str = summary == null ? "" : String(summary);
		s.bug = str.trim() === "" ? null : str;
	});
}

/** Record a hypothesis: bump count, reset attempts, enter HYPOTHESIS & BUG VALIDATION. */
export function reportHypothesis(hypothesis: string): void {
	update((s) => {
		s.hypothesis = hypothesis;
		s.hypothesisCount += 1;
		s.attempts = 0;
		s.state = "HYPOTHESIS & BUG VALIDATION";
	});
}

/** Move to an arbitrary state. */
export function transition(next: DebugStateName): void {
	update((s) => {
		s.state = next;
	});
}

/**
 * Record a fix-test result and advance the machine. Returns the resulting state.
 * - "fixed"   → BUG FIXED (caller removes telemetry; the fix is kept).
 * - "continue"→ attempts++; at/above MAX → AWAITING CONTEXT (hypothesis cleared),
 *               else → HYPOTHESIS & BUG VALIDATION (caller reverts fix + re-instruments).
 */
export function recordTestResult(result: "fixed" | "continue"): DebugStateName | null {
	if (!current) return null;
	update((s) => {
		if (result === "fixed") {
			s.state = "BUG FIXED";
			return;
		}
		s.attempts += 1;
		if (s.attempts >= DEFAULT_MAX_ATTEMPTS) {
			s.state = "AWAITING CONTEXT";
			s.hypothesis = null;
		} else {
			s.state = "HYPOTHESIS & BUG VALIDATION";
		}
	});
	return current.state;
}

// --- persistence ----------------------------------------------------------

export function serialize(): unknown {
	if (!current) return null;
	return { ...current, snippetMap: { ...current.snippetMap } };
}

/** Rebuild a DebugState from persisted data; null if invalid/inactive. */
export function deserialize(data: unknown): DebugState | null {
	if (!data || typeof data !== "object") return null;
	const d = data as Partial<DebugState>;
	if (typeof d.state !== "string") return null;
	return {
		active: d.active === true,
		mode: d.mode === "remote" ? "remote" : "local",
		state: d.state as DebugStateName,
		bug: typeof d.bug === "string" ? d.bug : null,
		hypothesis: typeof d.hypothesis === "string" ? d.hypothesis : null,
		hypothesisCount: typeof d.hypothesisCount === "number" ? d.hypothesisCount : 0,
		attempts: typeof d.attempts === "number" ? d.attempts : 0,
		snippetMap: normalizeSnippetMap(d.snippetMap),
		telemetryTarget: typeof d.telemetryTarget === "string" ? d.telemetryTarget : "",
	};
}

/** Coerce a persisted snippet map (JSON keys are strings) back to numeric keys. */
function normalizeSnippetMap(m: unknown): Record<number, SnippetInfo> {
	const out: Record<number, SnippetInfo> = {};
	if (!m || typeof m !== "object") return out;
	for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
		if (!v || typeof v !== "object") continue;
		const info = v as Partial<SnippetInfo>;
		if (typeof info.file !== "string" || typeof info.name !== "string" || typeof info.line !== "number") continue;
		out[Number(k)] = { file: info.file, name: info.name, line: info.line };
	}
	return out;
}
