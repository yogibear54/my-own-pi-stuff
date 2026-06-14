/**
 * TypeScript / JavaScript language profile.
 *
 * Transport: HTTP POST via `fetch` (global in browsers and Node 18+).
 * The Node variant uses `require('http')` for environments without fetch.
 *
 * Per Section 7.1 of REQUIREMENTS.md. Design principles (7.8):
 * - Never crash the app — fetch call is fire-and-forget with `.catch(() => {})`.
 * - Never block execution — fetch is async by default.
 * - Zero dependencies — `fetch` is global, no imports needed.
 * - Single-line where possible — the fetch variant is one line.
 * - Identifiable markers — `__AI_DEBUG_START__` / `__AI_DEBUG_END__` comments.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { InstrumentationEnvelope, LanguageProfile } from "./types.js";

/**
 * Build a JS object-literal string for the log envelope's body.
 *
 * Static fields are emitted via JSON.stringify (correct escaping + valid JS).
 * `timestamp` is a runtime call (`new Date().toISOString()`).
 * `data` is embedded verbatim (it contains runtime expressions).
 * `line` is included only when provided.
 */
function buildBodyLiteral(envelope: InstrumentationEnvelope): string {
	const parts: string[] = [
		"timestamp: new Date().toISOString()",
		`session: ${JSON.stringify(envelope.session)}`,
		`hypothesis: ${envelope.hypothesis}`,
		`file: ${JSON.stringify(envelope.file)}`,
	];
	if (envelope.line !== undefined) {
		parts.push(`line: ${envelope.line}`);
	}
	parts.push(
		`level: ${JSON.stringify(envelope.level)}`,
		`tag: ${JSON.stringify(envelope.tag)}`,
		`data: ${envelope.data}`,
	);
	return `{ ${parts.join(", ")} }`;
}

export const TypeScriptProfile: LanguageProfile = {
	name: "typescript",
	extensions: [".ts", ".tsx", ".js", ".jsx"],
	commentStart: "//",
	commentEnd: "",
	transport: "http",
	imports: [],

	buildMarkerStart(session, hypothesis) {
		return `// __AI_DEBUG_START__ session=${session} hypothesis=${hypothesis}`;
	},

	buildMarkerEnd() {
		return "// __AI_DEBUG_END__";
	},

	/**
	 * Generate the fetch-based log emission call (single line).
	 *
	 * Example output:
	 * ```
	 * fetch("http://localhost:19847/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timestamp: new Date().toISOString(), session: "abc123", hypothesis: 1, file: "src/cart.ts", level: "info", tag: "cart_state", data: { items: cart.items.length } }) }).catch(() => {});
	 * ```
	 */
	buildLogCall(envelope) {
		const url = JSON.stringify(`http://localhost:${envelope.port}/log`);
		const body = buildBodyLiteral(envelope);
		return `fetch(${url}, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(${body}) }).catch(() => {});`;
	},

	/**
	 * Generate the Node.js log emission call (for environments without fetch).
	 *
	 * Returns multiple statements joined by newlines. Uses `require("http")` (stdlib).
	 * Fire-and-forget with an error handler so it never crashes the app.
	 */
	buildNodeLogCall(envelope) {
		const url = `http://localhost:${envelope.port}/log`;
		const body = buildBodyLiteral(envelope);
		return [
			`const __aiDebugReq = require("http").request(${JSON.stringify(url)}, { method: "POST", headers: { "Content-Type": "application/json" } }, () => {});`,
			`__aiDebugReq.on("error", () => {});`,
			`__aiDebugReq.write(JSON.stringify(${body}));`,
			`__aiDebugReq.end();`,
		].join("\n");
	},

	/** Detect a JS/TS project by looking for package.json. */
	detect(projectRoot) {
		return fs.existsSync(path.join(projectRoot, "package.json"));
	},
};
