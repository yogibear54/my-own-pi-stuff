/**
 * Tool-level tests: mock the Pi ExtensionAPI, capture registered tool execute
 * functions, and test the full parameter → engine → output pipeline.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import {
	ensureParser,
	createTempProject,
	createTestStore,
	indexProject,
	getTestConfig,
} from "./helpers.js";
import { registerTools } from "../src/tools.js";
import type { Store } from "../src/store.js";
import { resolveToolsConfig } from "../src/config.js";

// ── Pi API mock ──

interface RegisteredTool {
	name: string;
	parameters: any;
	execute: (toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) => Promise<any>;
}

function createMockPi(): {
	pi: any;
	tools: Map<string, RegisteredTool>;
} {
	const tools = new Map<string, RegisteredTool>();
	const pi = {
		registerTool: vi.fn((tool: any) => {
			tools.set(tool.name, {
				name: tool.name,
				parameters: tool.parameters,
				execute: tool.execute,
			});
		}),
	};
	return { pi, tools };
}

// ── Shared fixtures ──

const FIXTURES: Record<string, string> = {
	"src/app.ts": `
import { Config, loadConfig } from "./loader.js";

export function runApp(config: Config): void {
  const loaded = loadConfig("prod");
  console.log("Running with:", loaded);
}

export class AppService {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  getName(): string {
    return this.name;
  }

  setName(name: string): void {
    this.name = name;
  }
}
`.trimStart(),

	"src/loader.ts": `
export interface Config {
  debug: boolean;
  port: number;
}

export function loadConfig(env: string): Config {
  return { debug: env === "dev", port: 3000 };
}

export const DEFAULT_PORT = 3000;
`.trimStart(),
};

// ── Test suite ──

describe("tool-level tests", () => {
	beforeAll(async () => {
		await ensureParser();
	});

	let root: string;
	let cleanupProject: () => void;
	let store: Store;
	let cleanupStore: () => void;
	let tools: Map<string, RegisteredTool>;

	afterEach(() => {
		cleanupProject?.();
		cleanupStore?.();
	});

	function setup() {
		const proj = createTempProject(FIXTURES);
		root = proj.root;
		cleanupProject = proj.cleanup;

		const s = createTestStore();
		store = s.store;
		cleanupStore = s.cleanup;

		indexProject(root, store);

		// Register tools with mock Pi
		const config = getTestConfig();
		// Store config in meta so getConfig() can read it
		store.setMeta("toolsConfig", JSON.stringify(config));

		const { pi, tools: t } = createMockPi();
		tools = t;
		registerTools(
			pi,
			() => store,
			() => root,
			() => config,
		);

		return { root, store, tools };
	}

	// Helper: call a tool's execute function
	async function callTool(name: string, params: Record<string, unknown>) {
		const tool = tools.get(name);
		if (!tool) throw new Error(`Tool "${name}" not registered`);
		return tool.execute("test-call-id", params, undefined, undefined, {});
	}

	// ── Tool registration ──

	describe("tool registration", () => {
		it("registers all 5 tools", () => {
			setup();
			expect(tools.has("code_nav_definition")).toBe(true);
			expect(tools.has("code_nav_references")).toBe(true);
			expect(tools.has("code_nav_symbols")).toBe(true);
			expect(tools.has("code_nav_fetch_context")).toBe(true);
			expect(tools.has("code_nav_search")).toBe(true);
		});
	});

	// ── code_nav_definition ──

	describe("code_nav_definition", () => {
		it("finds a function definition", async () => {
			setup();
			const result = await callTool("code_nav_definition", { symbol: "loadConfig" });
			expect(result.content[0].text).toContain("loadConfig");
			expect(result.content[0].text).toContain("loader.ts");
			expect(result.details.definitions.length).toBeGreaterThanOrEqual(1);
		});

		it("returns not-found message for unknown symbol", async () => {
			setup();
			const result = await callTool("code_nav_definition", { symbol: "nonexistent_xyz" });
			expect(result.content[0].text).toContain("No definitions found");
		});

		it("finds class definition", async () => {
			setup();
			const result = await callTool("code_nav_definition", { symbol: "AppService" });
			expect(result.content[0].text).toContain("AppService");
			expect(result.content[0].text).toContain("app.ts");
		});
	});

	// ── code_nav_references ──

	describe("code_nav_references", () => {
		it("finds references across files", async () => {
			setup();
			const result = await callTool("code_nav_references", { symbol: "Config" });
			const text = result.content[0].text;
			expect(text).toContain("Config");
			// Config appears in both app.ts and loader.ts
			expect(text).toContain("app.ts");
			expect(text).toContain("loader.ts");
		});

		it("returns empty for unknown", async () => {
			setup();
			const result = await callTool("code_nav_references", { symbol: "nonexistent_xyz" });
			expect(result.content[0].text).toContain("No references found");
		});
	});

	// ── code_nav_symbols ──

	describe("code_nav_symbols", () => {
		it("lists symbols in a file", async () => {
			setup();
			const result = await callTool("code_nav_symbols", { file: "src/loader.ts" });
			const text = result.content[0].text;
			expect(text).toContain("loadConfig");
			expect(text).toContain("DEFAULT_PORT");
		});

		it("searches symbols by prefix", async () => {
			setup();
			const result = await callTool("code_nav_symbols", { query: "load" });
			expect(result.content[0].text).toContain("loadConfig");
		});

		it("returns stats when no params given", async () => {
			setup();
			const result = await callTool("code_nav_symbols", {});
			expect(result.content[0].text).toContain("symbols");
		});

		it("returns empty for unindexed file", async () => {
			setup();
			const result = await callTool("code_nav_symbols", { file: "src/nope.ts" });
			expect(result.content[0].text).toContain("No symbols found");
		});
	});

	// ── code_nav_fetch_context ──

	describe("code_nav_fetch_context", () => {
		it("fetches function context", async () => {
			setup();
			const result = await callTool("code_nav_fetch_context", {
				symbol: "loadConfig",
				file: "src/loader.ts",
			});
			expect(result.content[0].text).toContain("loadConfig");
			expect(result.details.file).toContain("loader.ts");
			expect(typeof result.details.startLine).toBe("number");
			expect(typeof result.details.endLine).toBe("number");
		});

		it("fetches class context with member summary", async () => {
			setup();
			const result = await callTool("code_nav_fetch_context", {
				symbol: "AppService",
				file: "src/app.ts",
			});
			const text = result.content[0].text;
			expect(text).toContain("AppService");
			// Member summary should list methods
			expect(text).toContain("getName");
			expect(text).toContain("setName");
		});

		it("respects before/after params", async () => {
			setup();
			const zeroPad = await callTool("code_nav_fetch_context", {
				symbol: "loadConfig",
				file: "src/loader.ts",
				before: 0,
				after: 0,
			});
			const defaultPad = await callTool("code_nav_fetch_context", {
				symbol: "loadConfig",
				file: "src/loader.ts",
				before: 5,
				after: 5,
			});
			// More padding = more lines
			const zeroLines = zeroPad.content[0].text.split("\n").length;
			const defaultLines = defaultPad.content[0].text.split("\n").length;
			expect(defaultLines).toBeGreaterThanOrEqual(zeroLines);
		});

		it("returns not-found for unknown symbol", async () => {
			setup();
			const result = await callTool("code_nav_fetch_context", {
				symbol: "nonexistent_xyz",
			});
			expect(result.content[0].text).toContain("No definition found");
		});
	});

	// ── code_nav_search ──

	describe("code_nav_search", () => {
		it("finds text matches", async () => {
			setup();
			const result = await callTool("code_nav_search", { query: "debug" });
			expect(result.content[0].text).toContain("debug");
			expect(result.details.results.length).toBeGreaterThanOrEqual(1);
		});

		it("finds matches across files", async () => {
			setup();
			const result = await callTool("code_nav_search", { query: "Config" });
			const files = new Set(result.details.results.map((r: any) => r.file));
			expect(files.size).toBeGreaterThanOrEqual(2);
		});

		it("respects limit param", async () => {
			setup();
			const result = await callTool("code_nav_search", { query: "export", limit: 2 });
			expect(result.details.results.length).toBeLessThanOrEqual(2);
		});

		it("returns empty for no matches", async () => {
			setup();
			const result = await callTool("code_nav_search", { query: "zzz_nonexistent" });
			expect(result.content[0].text).toContain("No content matches");
		});

		it("includes stats in details", async () => {
			setup();
			const result = await callTool("code_nav_search", { query: "debug" });
			expect(result.details.stats).toBeDefined();
			expect(result.details.stats).toHaveProperty("candidateFiles");
		});

		it("shows stats in text when includeStats=true", async () => {
			setup();
			const result = await callTool("code_nav_search", { query: "debug", includeStats: true });
			expect(result.content[0].text).toContain("Search Stats");
		});
	});
});
