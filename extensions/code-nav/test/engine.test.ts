/**
 * Engine integration tests: test core functions against real Tree-sitter + SQLite.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
	ensureParser,
	createTempProject,
	createTestStore,
	indexProject,
	getTestConfig,
} from "./helpers.js";
import {
	findDefinitions,
	findReferences,
	listFileSymbols,
	searchSymbols,
	fetchContext,
	searchCodebase,
} from "../src/engine.js";

// ── Fixture files ──

const FIXTURES: Record<string, string> = {
	"src/utils.ts": `
export function greet(name: string): string {
  return "Hello, " + name;
}

export const VERSION = "1.0.0";

export class Calculator {
  private value: number = 0;

  add(n: number): void {
    this.value += n;
  }

  getResult(): number {
    return this.value;
  }
}

export type Config = {
  debug: boolean;
};

export enum Direction {
  Up = "UP",
  Down = "DOWN",
}
`.trimStart(),

	"src/main.ts": `
import { greet, Calculator, VERSION } from "./utils.js";

const calc = new Calculator();
calc.add(5);
calc.add(3);

console.log(greet("world"));
console.log("version:", VERSION);
`.trimStart(),

	"src/empty.ts": ``,

	"src/nested/deep.ts": `
export function deepFunction(): boolean {
  return true;
}

export class DeepClass {
  method(): void {}
}
`.trimStart(),
};

describe("engine integration", () => {
	beforeAll(async () => {
		await ensureParser();
	});

	// Per-test temp project + store
	let root: string;
	let cleanupProject: () => void;
	let store: ReturnType<typeof createTestStore>["store"];
	let cleanupStore: () => void;

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
		return { root, store };
	}

	// ── findDefinitions ──

	describe("findDefinitions", () => {
		it("finds a function definition", () => {
			const { store: s, root: r } = setup();
			const results = findDefinitions("greet", undefined, s, r);
			expect(results.length).toBeGreaterThanOrEqual(1);
			expect(results[0].symbol.name).toBe("greet");
			expect(results[0].symbol.kind).toBe("function");
			expect(results[0].symbol.file).toContain("utils.ts");
		});

		it("finds a class definition", () => {
			const { store: s, root: r } = setup();
			const results = findDefinitions("Calculator", undefined, s, r);
			expect(results.length).toBeGreaterThanOrEqual(1);
			expect(results[0].symbol.kind).toBe("class");
		});

		it("finds a type alias", () => {
			const { store: s, root: r } = setup();
			const results = findDefinitions("Config", undefined, s, r);
			expect(results.length).toBeGreaterThanOrEqual(1);
			expect(results[0].symbol.kind).toBe("type");
		});

		it("finds an enum", () => {
			const { store: s, root: r } = setup();
			const results = findDefinitions("Direction", undefined, s, r);
			expect(results.length).toBeGreaterThanOrEqual(1);
			expect(results[0].symbol.kind).toBe("enum");
		});

		it("finds a method within a class (scoped)", () => {
			const { store: s, root: r } = setup();
			const results = findDefinitions("add", undefined, s, r);
			expect(results.length).toBeGreaterThanOrEqual(1);
			// 'add' should be a method in Calculator
			const addMethods = results.filter((r) => r.symbol.kind === "method");
			expect(addMethods.length).toBeGreaterThanOrEqual(1);
			expect(addMethods[0].symbol.scope).toBe("Calculator");
		});

		it("returns empty for unknown symbol", () => {
			const { store: s, root: r } = setup();
			const results = findDefinitions("nonexistent_xyz", undefined, s, r);
			expect(results).toHaveLength(0);
		});

		it("prefers context file when multiple matches exist", () => {
			const { store: s, root: r } = setup();
			// 'Calculator' is only in utils.ts, but contextFile should prefer it
			const results = findDefinitions("Calculator", "src/utils.ts", s, r);
			expect(results.length).toBeGreaterThanOrEqual(1);
			expect(results[0].symbol.file).toContain("utils.ts");
		});
	});

	// ── findReferences ──

	describe("findReferences", () => {
		it("finds references to a function", () => {
			const { store: s, root: r } = setup();
			const results = findReferences("greet", undefined, s, r);
			// greet is defined in utils.ts and used in main.ts
			expect(results.length).toBeGreaterThanOrEqual(2);
			const files = new Set(results.map((ref) => ref.file));
			expect(files.size).toBeGreaterThanOrEqual(2);
		});

		it("finds references to a class", () => {
			const { store: s, root: r } = setup();
			const results = findReferences("Calculator", undefined, s, r);
			expect(results.length).toBeGreaterThanOrEqual(2);
		});

		it("marks definition vs usage when definitionFile is provided", () => {
			const { store: s, root: r } = setup();
			const results = findReferences("VERSION", "src/utils.ts", s, r);
			const definitions = results.filter((r) => r.isDefinition);
			const usages = results.filter((r) => !r.isDefinition);
			expect(definitions.length).toBeGreaterThanOrEqual(1);
			expect(usages.length).toBeGreaterThanOrEqual(1);
		});

		it("returns empty for unknown symbol", () => {
			const { store: s, root: r } = setup();
			const results = findReferences("nonexistent_xyz", undefined, s, r);
			expect(results).toHaveLength(0);
		});
	});

	// ── listFileSymbols ──

	describe("listFileSymbols", () => {
		it("lists all symbols in a file", () => {
			const { store: s } = setup();
			const results = listFileSymbols("src/utils.ts", s);
			const names = results.map((r) => r.symbol.name);
			expect(names).toContain("greet");
			expect(names).toContain("Calculator");
			expect(names).toContain("VERSION");
		});

		it("includes class members scoped to their class", () => {
			const { store: s } = setup();
			const results = listFileSymbols("src/utils.ts", s);
			const methods = results.filter((r) => r.symbol.kind === "method");
			const methodNames = methods.map((r) => r.symbol.name);
			expect(methodNames).toContain("add");
			expect(methodNames).toContain("getResult");
			// Methods should be scoped
			for (const m of methods) {
				expect(m.symbol.scope).toBe("Calculator");
			}
		});

		it("returns empty for unindexed file", () => {
			const { store: s } = setup();
			const results = listFileSymbols("src/nonexistent.ts", s);
			expect(results).toHaveLength(0);
		});

		it("returns empty for empty file", () => {
			const { store: s } = setup();
			const results = listFileSymbols("src/empty.ts", s);
			expect(results).toHaveLength(0);
		});
	});

	// ── searchSymbols ──

	describe("searchSymbols", () => {
		it("finds symbols by prefix", () => {
			const { store: s } = setup();
			const results = searchSymbols("get", s, 50);
			const names = results.map((r) => r.symbol.name);
			expect(names).toContain("getResult");
		});

		it("respects limit", () => {
			const { store: s } = setup();
			const results = searchSymbols("", s, 1);
			expect(results.length).toBeLessThanOrEqual(1);
		});
	});

	// ── fetchContext ──

	describe("fetchContext", () => {
		it("fetches context for a function", () => {
			const { store: s, root: r } = setup();
			const result = fetchContext("greet", s, r, { contextFile: "src/utils.ts" });
			expect(result.content).toContain("greet");
			expect(result.content).toContain("function");
			expect(result.file).toContain("utils.ts");
		});

		it("fetches context for a class (member summary)", () => {
			const { store: s, root: r } = setup();
			const result = fetchContext("Calculator", s, r, { contextFile: "src/utils.ts" });
			expect(result.content).toContain("Calculator");
			// Member summary should show methods
			expect(result.content).toContain("add");
			expect(result.content).toContain("getResult");
		});

		it("respects before/after padding", () => {
			const { store: s, root: r } = setup();
			const small = fetchContext("greet", s, r, { contextFile: "src/utils.ts" }, { ...getTestConfig().fetchContext, defaultBefore: 0, defaultAfter: 0 });
			const padded = fetchContext("greet", s, r, { contextFile: "src/utils.ts" }, { ...getTestConfig().fetchContext, defaultBefore: 3, defaultAfter: 3 });
			// Padded should have more lines
			expect(padded.content.split("\n").length).toBeGreaterThanOrEqual(small.content.split("\n").length);
		});

		it("returns not-found for unknown symbol", () => {
			const { store: s, root: r } = setup();
			const result = fetchContext("nonexistent_xyz", s, r, {});
			expect(result.content).toContain("No definition found");
		});

		it("fetches context for a nested file symbol", () => {
			const { store: s, root: r } = setup();
			const result = fetchContext("deepFunction", s, r, {});
			expect(result.content).toContain("deepFunction");
			expect(result.file).toContain("nested");
		});
	});

	// ── searchCodebase ──

	describe("searchCodebase", () => {
		it("finds text matches", () => {
			const { store: s, root: r } = setup();
			const { results } = searchCodebase("Hello", s, r, 10);
			expect(results.length).toBeGreaterThanOrEqual(1);
			expect(results[0].lineText).toContain("Hello");
		});

		it("finds matches in symbol names", () => {
			const { store: s, root: r } = setup();
			const { results } = searchCodebase("Calculator", s, r, 10);
			expect(results.length).toBeGreaterThanOrEqual(1);
		});

		it("finds matches across files", () => {
			const { store: s, root: r } = setup();
			const { results } = searchCodebase("VERSION", s, r, 10);
			const files = new Set(results.map((r) => r.file));
			expect(files.size).toBeGreaterThanOrEqual(2); // utils.ts (def) + main.ts (usage)
		});

		it("returns empty for no matches", () => {
			const { store: s, root: r } = setup();
			const { results } = searchCodebase("zzz_nonexistent_xyz", s, r, 10);
			expect(results).toHaveLength(0);
		});

		it("respects limit", () => {
			const { store: s, root: r } = setup();
			const { results } = searchCodebase("export", s, r, 2);
			expect(results.length).toBeLessThanOrEqual(2);
		});

		it("returns stats", () => {
			const { store: s, root: r } = setup();
			const { stats } = searchCodebase("Hello", s, r, 10);
			expect(stats).toHaveProperty("candidateFiles");
			expect(stats).toHaveProperty("totalMs");
			expect(typeof stats.totalMs).toBe("number");
		});
	});
});
