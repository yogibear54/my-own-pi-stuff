/**
 * Tests for the TypeScript/JavaScript language profile.
 *
 * Strategy:
 * - **Unit tests** verify generated code structure, marker format, and detection.
 * - **Integration tests** actually *execute* the generated `fetch` and `require("http")`
 *   code against a running LogCollector, proving the instrumentation POSTs a valid
 *   entry that the collector stores. This is the strongest verification that
 *   `buildLogCall()` produces "valid JS that POSTs to localhost".
 *
 * Generated code is executed via `new Function`/`new AsyncFunction` so the test's
 * own scope isn't polluted. The Node variant receives `require` explicitly.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createRequire } from "node:module";
import { TypeScriptProfile } from "./typescript.js";
import { LogCollector } from "../log-collector.js";
import type { InstrumentationEnvelope } from "./types.js";
import type { DebugLogEntry } from "../types.js";

// ── Test setup ─────────────────────────────────────────────────────────────

let tmpDir: string;
let collector: LogCollector;
let port: number;

beforeEach(async () => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-debugger-profile-test-"));
	collector = new LogCollector(tmpDir, 100);
	await collector.start(0); // OS-assigned port
	port = collector.listeningPort;
});

afterEach(async () => {
	await collector.stop();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────────────────────────────

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const localRequire = createRequire(import.meta.url);

/** Build an envelope pointing at the running collector. */
function makeEnvelope(overrides: Partial<InstrumentationEnvelope> = {}): InstrumentationEnvelope {
	return {
		session: "abc123",
		hypothesis: 1,
		file: "src/cart.ts",
		line: 42,
		level: "info",
		tag: "cart_state",
		port,
		data: '{ items: 3, total: 49.99 }',
		...overrides,
	};
}

/** Resolve when the collector receives a log entry (or time out). */
function waitForLog(timeoutMs = 1000): Promise<DebugLogEntry> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Timed out waiting for log entry")), timeoutMs);
		collector.once("log", (entry: DebugLogEntry) => {
			clearTimeout(timer);
			resolve(entry);
		});
	});
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("TypeScriptProfile", () => {
	// ── Metadata ────────────────────────────────────────────────────────
	describe("metadata", () => {
		it("has the correct name", () => {
			expect(TypeScriptProfile.name).toBe("typescript");
		});

		it("handles .ts, .tsx, .js, .jsx", () => {
			expect(TypeScriptProfile.extensions).toEqual([".ts", ".tsx", ".js", ".jsx"]);
		});

		it("uses // comments", () => {
			expect(TypeScriptProfile.commentStart).toBe("//");
			expect(TypeScriptProfile.commentEnd).toBe("");
		});

		it("uses HTTP transport", () => {
			expect(TypeScriptProfile.transport).toBe("http");
		});

		it("needs no imports (fetch is global)", () => {
			expect(TypeScriptProfile.imports).toEqual([]);
		});
	});

	// ── Markers ─────────────────────────────────────────────────────────
	describe("markers", () => {
		it("buildMarkerStart includes session and hypothesis", () => {
			const marker = TypeScriptProfile.buildMarkerStart("abc123", 2);
			expect(marker).toBe("// __AI_DEBUG_START__ session=abc123 hypothesis=2");
		});

		it("buildMarkerEnd is the end delimiter", () => {
			expect(TypeScriptProfile.buildMarkerEnd()).toBe("// __AI_DEBUG_END__");
		});

		it("markers are parseable (session and hypothesis extractable)", () => {
			// Cleanup code will parse these markers via regex. Verify the format is consistent.
			const marker = TypeScriptProfile.buildMarkerStart("sess99", 3);
			const match = marker.match(/__AI_DEBUG_START__ session=(\S+) hypothesis=(\d+)/);
			expect(match).not.toBeNull();
			expect(match![1]).toBe("sess99");
			expect(match![2]).toBe("3");
		});

		it("markers contain the __AI_DEBUG_START__ / __AI_DEBUG_END__ sentinel", () => {
			expect(TypeScriptProfile.buildMarkerStart("x", 1)).toContain("__AI_DEBUG_START__");
			expect(TypeScriptProfile.buildMarkerEnd()).toContain("__AI_DEBUG_END__");
		});
	});

	// ── buildLogCall — code generation ──────────────────────────────────
	describe("buildLogCall — code generation", () => {
		it("produces a single line", () => {
			const code = TypeScriptProfile.buildLogCall(makeEnvelope());
			expect(code.split("\n")).toHaveLength(1);
		});

		it("POSTs to http://localhost:<port>/log", () => {
			const code = TypeScriptProfile.buildLogCall(makeEnvelope({ port: 19847 }));
			expect(code).toContain('fetch("http://localhost:19847/log"');
		});

		it("uses POST with JSON content type", () => {
			const code = TypeScriptProfile.buildLogCall(makeEnvelope());
			expect(code).toContain('method: "POST"');
			expect(code).toContain('"Content-Type": "application/json"');
		});

		it("is fire-and-forget (.catch to swallow errors)", () => {
			const code = TypeScriptProfile.buildLogCall(makeEnvelope());
			expect(code).toContain(".catch(() => {})");
		});

		it("embeds the envelope fields into the body", () => {
			const code = TypeScriptProfile.buildLogCall(makeEnvelope({
				session: "s1", hypothesis: 7, file: "app/x.ts", level: "warn", tag: "mytag",
			}));
			expect(code).toContain('session: "s1"');
			expect(code).toContain("hypothesis: 7");
			expect(code).toContain('file: "app/x.ts"');
			expect(code).toContain('level: "warn"');
			expect(code).toContain('tag: "mytag"');
		});

		it("includes line when provided", () => {
			const code = TypeScriptProfile.buildLogCall(makeEnvelope({ line: 99 }));
			expect(code).toContain("line: 99");
		});

		it("omits line when not provided", () => {
			const code = TypeScriptProfile.buildLogCall(makeEnvelope({ line: undefined }));
			expect(code).not.toMatch(/line:/);
		});

		it("embeds data source verbatim", () => {
			const code = TypeScriptProfile.buildLogCall(makeEnvelope({ data: "{ count: items.length }" }));
			expect(code).toContain("data: { count: items.length }");
		});

		it("generates timestamp at runtime", () => {
			const code = TypeScriptProfile.buildLogCall(makeEnvelope());
			expect(code).toContain("new Date().toISOString()");
		});

		it("is syntactically valid JS", () => {
			// new Function throws SyntaxError on invalid code
			expect(() => new Function(TypeScriptProfile.buildLogCall(makeEnvelope()))).not.toThrow();
		});
	});

	// ── buildLogCall — integration ──────────────────────────────────────
	describe("buildLogCall — integration (executes and POSTs)", () => {
		it("POSTs a valid entry to the collector", async () => {
			const envelope = makeEnvelope({ data: "{ items: 3 }" });
			const code = TypeScriptProfile.buildLogCall(envelope);
			const done = waitForLog();

			// Execute the generated instrumentation
			const fn = new AsyncFunction(code);
			await fn();

			const entry = await done;
			expect(entry.session).toBe("abc123");
			expect(entry.hypothesis).toBe(1);
			expect(entry.file).toBe("src/cart.ts");
			expect(entry.line).toBe(42);
			expect(entry.level).toBe("info");
			expect(entry.tag).toBe("cart_state");
			expect(entry.data).toEqual({ items: 3 });
		});

		it("embeds runtime expressions that evaluate at execution time", async () => {
			// The data source references a variable `cart` — the generated code must
			// evaluate it at runtime, not stringify it at build time.
			const envelope = makeEnvelope({ data: "{ total: cart.total }" });
			const code = TypeScriptProfile.buildLogCall(envelope);
			const done = waitForLog();

			// Provide `cart` in scope when executing
			const fn = new AsyncFunction("cart", code);
			await fn({ total: 42.5 });

			const entry = await done;
			expect(entry.data).toEqual({ total: 42.5 });
		});

		it("does not throw when the collector is unreachable", async () => {
			// Point at a dead port — the .catch(() => {}) must swallow the error.
			const envelope = makeEnvelope({ port: 1 }); // port 1 is privileged/unused
			const code = TypeScriptProfile.buildLogCall(envelope);
			const fn = new AsyncFunction(code);
			await expect(fn()).resolves.toBeUndefined();
		});
	});

	// ── buildNodeLogCall — code generation ──────────────────────────────
	describe("buildNodeLogCall — code generation", () => {
		it("uses require('http')", () => {
			const code = TypeScriptProfile.buildNodeLogCall(makeEnvelope());
			expect(code).toContain('require("http")');
			expect(code).toContain(".request(");
		});

		it("attaches an error handler so it never crashes", () => {
			const code = TypeScriptProfile.buildNodeLogCall(makeEnvelope());
			expect(code).toContain('.on("error", () => {})');
		});

		it("writes the JSON body and ends the request", () => {
			const code = TypeScriptProfile.buildNodeLogCall(makeEnvelope());
			expect(code).toContain(".write(JSON.stringify(");
			expect(code).toContain(".end();");
		});

		it("includes line when provided", () => {
			const code = TypeScriptProfile.buildNodeLogCall(makeEnvelope({ line: 55 }));
			expect(code).toContain("line: 55");
		});

		it("omits line when not provided", () => {
			const code = TypeScriptProfile.buildNodeLogCall(makeEnvelope({ line: undefined }));
			expect(code).not.toMatch(/line:/);
		});

		it("is syntactically valid JS", () => {
			// Provide `require` as a parameter — the body uses require("http")
			expect(() => new Function("require", TypeScriptProfile.buildNodeLogCall(makeEnvelope()))).not.toThrow();
		});
	});

	// ── buildNodeLogCall — integration ──────────────────────────────────
	describe("buildNodeLogCall — integration (executes and POSTs)", () => {
		it("POSTs a valid entry to the collector", async () => {
			const envelope = makeEnvelope({ data: "{ items: 3 }" });
			const code = TypeScriptProfile.buildNodeLogCall(envelope);
			const done = waitForLog();

			// Execute with require in scope
			const fn = new Function("require", code);
			fn(localRequire);

			const entry = await done;
			expect(entry.session).toBe("abc123");
			expect(entry.hypothesis).toBe(1);
			expect(entry.data).toEqual({ items: 3 });
		});

		it("does not throw when the collector is unreachable", async () => {
			const envelope = makeEnvelope({ port: 1 });
			const code = TypeScriptProfile.buildNodeLogCall(envelope);
			const fn = new Function("require", code);
			expect(() => fn(localRequire)).not.toThrow();
		});
	});

	// ── detect ──────────────────────────────────────────────────────────
	describe("detect", () => {
		it("returns true when package.json exists", () => {
			fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
			expect(TypeScriptProfile.detect(tmpDir)).toBe(true);
		});

		it("returns false when package.json does not exist", () => {
			expect(TypeScriptProfile.detect(tmpDir)).toBe(false);
		});
	});

	// ── Full instrumentation block ──────────────────────────────────────
	describe("full instrumentation block", () => {
		it("marker + log call + marker forms a removable block", () => {
			const envelope = makeEnvelope();
			const block = [
				TypeScriptProfile.buildMarkerStart(envelope.session, envelope.hypothesis),
				TypeScriptProfile.buildLogCall(envelope),
				TypeScriptProfile.buildMarkerEnd(),
			].join("\n");

			// The block is bounded by START/END markers
			expect(block.startsWith("// __AI_DEBUG_START__")).toBe(true);
			expect(block.endsWith("// __AI_DEBUG_END__")).toBe(true);
			// And contains the log call in between
			expect(block).toContain("fetch(");
		});
	});
});
