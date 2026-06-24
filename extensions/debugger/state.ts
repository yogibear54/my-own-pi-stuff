/**
 * Debug session state machine (Part 5 core).
 *
 * Framework-agnostic (no pi imports) so it is independently unit-testable.
 * index.ts wires it to pi.appendEntry persistence and ctx.ui.setWidget rendering.
 *
 * Design reference: docs/05-debugging-loop.md
 */

export type DebugMode = "local" | "remote";

/** The 7 instrumentation states (labels match the requirements/requirements doc verbatim). */
export const DebugState = {
  AwaitingContext: "AWAITING CONTEXT",
  AwaitingContextAmbiguous: "AWAITING CONTEXT: AMBIGUOUS",
  ParsingAsset: "PARSING ASSET",
  HypothesisValidation: "HYPOTHESIS & BUG VALIDATION",
  FixingBug: "FIXING BUG",
  BugFixed: "BUG FIXED",
  DebugSummary: "DEBUG SUMMARY",
} as const;
export type DebugStateValue = (typeof DebugState)[keyof typeof DebugState];

export interface SnippetRef {
  id: number;
  file: string;
  name: string;
  line: number;
}

export interface Hypothesis {
  statement: string;
  files: string[];
  functions: string[];
}

/** Plain serializable shape, persisted via pi.appendEntry("debugger", ...). */
export interface DebugSessionState {
  active: boolean;
  mode: DebugMode;
  state: DebugStateValue;
  hypothesis: Hypothesis | null;
  hypothesisCount: number;
  attempts: number;
  maxAttempts: number;
  snippetIds: SnippetRef[];
  telemetryTarget: string;
  logFile: string | null;
  port: number | null;
}

const DEFAULT_MAX_ATTEMPTS = 3;

function initialState(): DebugSessionState {
  return {
    active: false,
    mode: "local",
    state: DebugState.AwaitingContext,
    hypothesis: null,
    hypothesisCount: 0,
    attempts: 0,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    snippetIds: [],
    telemetryTarget: "",
    logFile: null,
    port: null,
  };
}

export interface StartOptions {
  mode: DebugMode;
  telemetryTarget: string;
  logFile: string;
  port: number;
  maxAttempts?: number;
}

/**
 * Encapsulates the debug session state machine and notifies subscribers on change.
 * The widget subscribes to re-render; index.ts persists on change.
 */
export class DebugSession {
  private state: DebugSessionState = initialState();
  private listeners = new Set<() => void>();

  /** Deserialize from a persisted entry (tolerant of partial/legacy data). */
  static fromSerialized(data: unknown): DebugSession {
    const s = new DebugSession();
    if (data && typeof data === "object") {
      const d = data as Partial<DebugSessionState>;
      s.state = { ...s.state, ...d };
      // Guard against bad enum values from old sessions.
      if (!isDebugStateValue(s.state.state)) s.state.state = DebugState.AwaitingContext;
    }
    return s;
  }

  /** Immutable snapshot of the current state. */
  getSnapshot(): Readonly<DebugSessionState> {
    return { ...this.state, snippetIds: [...this.state.snippetIds] };
  }

  isActive(): boolean {
    return this.state.active;
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Subscribe and immediately invoke once so callers render the current state. */
  subscribeAndEmit(cb: () => void): () => void {
    this.listeners.add(cb);
    cb();
    return () => this.listeners.delete(cb);
  }

  // --- lifecycle -------------------------------------------------------------

  start(opts: StartOptions): void {
    this.state = {
      ...initialState(),
      active: true,
      mode: opts.mode,
      state: DebugState.AwaitingContext,
      maxAttempts: opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      telemetryTarget: opts.telemetryTarget,
      logFile: opts.logFile,
      port: opts.port,
    };
    this.emit();
  }

  stop(): void {
    this.state = initialState();
    this.emit();
  }

  // --- context gathering (Phase 1) ------------------------------------------

  setAwaitingContext(): void {
    this.assertActive();
    this.transition(DebugState.AwaitingContext);
  }

  setAmbiguous(): void {
    this.assertActive();
    this.transition(DebugState.AwaitingContextAmbiguous);
  }

  setParsingAsset(): void {
    this.assertActive();
    this.transition(DebugState.ParsingAsset);
  }

  // --- hypothesis & fix loop (Phase 2) --------------------------------------

  /** Record a (new) hypothesis. Increments hypothesisCount. Enters HYPOTHESIS state. */
  reportHypothesis(hypothesis: Hypothesis): void {
    this.assertActive();
    this.state.hypothesis = hypothesis;
    this.state.hypothesisCount += 1;
    this.transition(DebugState.HypothesisValidation);
  }

  /** Enter FIXING BUG state (a fix has been deployed; awaiting user test). */
  startFix(): void {
    this.assertActive();
    this.transition(DebugState.FixingBug);
  }

  /**
   * User reported "Continue to Debug" (bug still present).
   * Increments attempts. Returns the next state:
   *  - if attempts >= maxAttempts → AWAITING CONTEXT (need more context), attempts reset
   *  - otherwise → HYPOTHESIS (model forms a new hypothesis via reportHypothesis)
   */
  recordContinue(): DebugStateValue {
    this.assertActive();
    this.state.attempts += 1;
    if (this.state.attempts >= this.state.maxAttempts) {
      this.state.attempts = 0;
      this.state.hypothesis = null;
      this.transition(DebugState.AwaitingContext);
      return DebugState.AwaitingContext;
    }
    this.state.hypothesis = null;
    this.transition(DebugState.HypothesisValidation);
    return this.state.state;
  }

  /** User reported "Bug Fixed". Enter BUG FIXED (cleanup follows). */
  recordFixed(): void {
    this.assertActive();
    this.transition(DebugState.BugFixed);
  }

  /** Enter DEBUG SUMMARY. */
  setSummary(): void {
    this.assertActive();
    this.transition(DebugState.DebugSummary);
  }

  // --- snippet tracking (Part 4) --------------------------------------------

  addSnippet(ref: SnippetRef): void {
    const existing = this.state.snippetIds.findIndex((s) => s.id === ref.id);
    if (existing >= 0) this.state.snippetIds[existing] = ref;
    else this.state.snippetIds.push(ref);
    this.emit();
  }

  removeSnippet(id: number): SnippetRef | undefined {
    const idx = this.state.snippetIds.findIndex((s) => s.id === id);
    if (idx < 0) return undefined;
    const [removed] = this.state.snippetIds.splice(idx, 1);
    this.emit();
    return removed;
  }

  getSnippets(): readonly SnippetRef[] {
    return this.state.snippetIds;
  }

  /** How many fix attempts remain before the loop falls back to AWAITING CONTEXT. */
  attemptsRemaining(): number {
    return Math.max(0, this.state.maxAttempts - this.state.attempts);
  }

  // --- internals -------------------------------------------------------------

  private assertActive(): void {
    if (!this.state.active) {
      throw new Error("Debug session is not active. Start it with /debug first.");
    }
  }

  private transition(next: DebugStateValue): void {
    this.state.state = next;
    this.emit();
  }

  private emit(): void {
    for (const cb of this.listeners) {
      try {
        cb();
      } catch {
        // listener errors must not corrupt the state machine
      }
    }
  }
}

function isDebugStateValue(v: unknown): v is DebugStateValue {
  return typeof v === "string" && Object.values(DebugState).includes(v as DebugStateValue);
}
