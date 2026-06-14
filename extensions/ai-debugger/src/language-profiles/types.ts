/**
 * Shared types for language profiles.
 *
 * A language profile defines how instrumentation is injected and how logs reach
 * the collector for a given programming language. See Section 7 of REQUIREMENTS.md.
 */

import type { LogLevel } from "../types.js";

/**
 * The data passed to a profile's `buildLogCall()` / `buildNodeLogCall()`.
 *
 * Most fields are static (known at instrumentation time). The `data` field is a
 * **JS source string** containing runtime expressions (e.g. `"{ items: cart.items.length, total }"`)
 * — it is embedded verbatim into the generated object literal because it references
 * variables that only exist at runtime.
 */
export interface InstrumentationEnvelope {
	/** Debug session ID */
	session: string;
	/** Hypothesis this instrumentation targets (1-indexed) */
	hypothesis: number;
	/** Source file path (as it should appear in the log) */
	file: string;
	/** Line number (optional; included in the POST body when provided) */
	line?: number;
	/** Log level */
	level: LogLevel;
	/** Categorization tag */
	tag: string;
	/** Collector port (the generated call POSTs to http://localhost:<port>/log) */
	port: number;
	/** JS source for the `data` object literal, e.g. "{ items: cart.items.length, total }" */
	data: string;
}

/**
 * A language profile — defines how instrumentation is generated for a language.
 */
export interface LanguageProfile {
	/** Profile name (e.g., "typescript", "python") */
	name: string;
	/** File extensions this profile handles (e.g., [".ts", ".tsx"]) */
	extensions: string[];
	/** Comment syntax — opening delimiter */
	commentStart: string;
	/** Comment syntax — closing delimiter (empty string for single-line comments) */
	commentEnd: string;
	/** Transport mode for emitting logs */
	transport: "http" | "stdout";
	/** Imports/requires injected at the top of the file when needed */
	imports: string[];

	/** Build the `__AI_DEBUG_START__` marker comment line. */
	buildMarkerStart(session: string, hypothesis: number): string;

	/** Build the `__AI_DEBUG_END__` marker comment line. */
	buildMarkerEnd(): string;

	/** Build the HTTP log emission call (fetch-based, single line). */
	buildLogCall(envelope: InstrumentationEnvelope): string;

	/** Build the Node.js log emission call (require('http')-based, for older Node). */
	buildNodeLogCall(envelope: InstrumentationEnvelope): string;

	/** Detect whether this profile applies to the given project root. */
	detect(projectRoot: string): boolean;
}
