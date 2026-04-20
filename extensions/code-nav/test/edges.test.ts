/**
 * Tests for edge extraction, dependency queries, and import-aware references.
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
	findDependencies,
	findDependents,
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
`.trimStart(),

	"src/main.ts": `
import { greet, Calculator, VERSION } from "./utils";

const calc = new Calculator();
calc.add(5);
calc.add(3);

console.log(greet("world"));
console.log("version:", VERSION);
`.trimStart(),

	"src/services/auth.ts": `
import { Calculator } from "../utils";
import type { Config } from "../utils";

export class AuthService extends Calculator {
  constructor() {
    super();
  }

  authenticate(token: string): boolean {
    return this.getResult() > 0;
  }
}
`.trimStart(),

	"src/services/user.ts": `
import type { Config } from "../utils";

export class UserService implements Config {
  debug: boolean = false;
}
`.trimStart(),

	"src/reexport.ts": `
export { greet } from "./utils";
export * from "./services/auth";
`.trimStart(),

	"src/noimports.ts": `
export function standalone(): void {
  console.log("I have no imports");
}
`.trimStart(),
};

describe("edge extraction", () => {
	beforeAll(async () => {
		await ensureParser();
	});

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

	// ── Import extraction ──

	describe("findDependencies (imports)", () => {
		it("finds named imports from a file", () => {
			const { store: s } = setup();
			const deps = findDependencies("src/main.ts", s);
			const importDeps = deps.filter((d) => d.relationship === "imports");
			expect(importDeps.length).toBeGreaterThanOrEqual(3); // greet, Calculator, VERSION

			const symbols = importDeps.map((d) => d.sourceSymbol);
			expect(symbols).toContain("greet");
			expect(symbols).toContain("Calculator");
			expect(symbols).toContain("VERSION");
		});

		it("resolves relative import paths to target files", () => {
			const { store: s } = setup();
			const deps = findDependencies("src/main.ts", s);
			const importDeps = deps.filter((d) => d.relationship === "imports");
			for (const dep of importDeps) {
				expect(dep.targetFile).toBe("src/utils.ts");
			}
		});

		it("resolves parent-relative imports", () => {
			const { store: s } = setup();
			const deps = findDependencies("src/services/auth.ts", s);
			const importDeps = deps.filter((d) => d.relationship === "imports");
			expect(importDeps.length).toBeGreaterThanOrEqual(2);

			const targetFiles = new Set(importDeps.map((d) => d.targetFile));
			expect(targetFiles).toContain("src/utils.ts");
		});

		it("returns empty for files with no imports", () => {
			const { store: s } = setup();
			const deps = findDependencies("src/noimports.ts", s);
			expect(deps).toHaveLength(0);
		});

		it("filters by relationship type", () => {
			const { store: s } = setup();
			const deps = findDependencies("src/main.ts", s, "imports");
			const hasExtends = deps.some((d) => d.relationship === "extends");
			expect(hasExtends).toBe(false);
		});
	});

	// ── Re-export extraction ──

	describe("re-exports", () => {
		it("extracts named re-exports", () => {
			const { store: s } = setup();
			const deps = findDependencies("src/reexport.ts", s);
			const reExports = deps.filter((d) => d.relationship === "re_exports");
			expect(reExports.length).toBeGreaterThanOrEqual(1);

			const greetReExport = reExports.find((d) => d.sourceSymbol === "greet");
			expect(greetReExport).toBeDefined();
			expect(greetReExport!.targetFile).toBe("src/utils.ts");
		});
	});

	// ── Extends/implements extraction ──

	describe("extends", () => {
		it("extracts class extends relationships", () => {
			const { store: s } = setup();
			const deps = findDependencies("src/services/auth.ts", s);
			const extendsDeps = deps.filter((d) => d.relationship === "extends");
			expect(extendsDeps.length).toBeGreaterThanOrEqual(1);

			const calcExtend = extendsDeps.find((d) => d.targetSymbol === "Calculator");
			expect(calcExtend).toBeDefined();
			expect(calcExtend!.sourceSymbol).toBe("AuthService");
		});
	});

	describe("implements", () => {
		it("extracts class implements relationships", () => {
			const { store: s } = setup();
			const deps = findDependencies("src/services/user.ts", s);
			const implDeps = deps.filter((d) => d.relationship === "implements");
			expect(implDeps.length).toBeGreaterThanOrEqual(1);

			const configImpl = implDeps.find((d) => d.targetSymbol === "Config");
			expect(configImpl).toBeDefined();
			expect(configImpl!.sourceSymbol).toBe("UserService");
		});
	});

	// ── findDependents (reverse dependencies) ──

	describe("findDependents", () => {
		it("finds files that import from a target file", () => {
			const { store: s } = setup();
			const dependents = findDependents(s, { file: "src/utils.ts" });
			expect(dependents.length).toBeGreaterThanOrEqual(3);

			const sourceFiles = new Set(dependents.map((d) => d.sourceFile));
			expect(sourceFiles).toContain("src/main.ts");
			expect(sourceFiles).toContain("src/services/auth.ts");
			expect(sourceFiles).toContain("src/services/user.ts");
		});

		it("finds classes that extend a target class", () => {
			const { store: s } = setup();
			const dependents = findDependents(s, { symbol: "Calculator", relationship: "extends" });
			expect(dependents.length).toBeGreaterThanOrEqual(1);

			const authExtends = dependents.find((d) => d.sourceSymbol === "AuthService");
			expect(authExtends).toBeDefined();
			expect(authExtends!.sourceFile).toContain("auth.ts");
		});

		it("finds classes that implement an interface", () => {
			const { store: s } = setup();
			const dependents = findDependents(s, { symbol: "Config", relationship: "implements" });
			expect(dependents.length).toBeGreaterThanOrEqual(1);

			const userImpl = dependents.find((d) => d.sourceSymbol === "UserService");
			expect(userImpl).toBeDefined();
		});

		it("returns empty for unused symbols", () => {
			const { store: s } = setup();
			const dependents = findDependents(s, { symbol: "nonexistent_xyz" });
			expect(dependents).toHaveLength(0);
		});
	});

	// ── Import-aware reference filtering ──

	describe("import-aware findReferences", () => {
		it("finds references using import-aware filtering", () => {
			const { store: s, root: r } = setup();
			const results = findReferences("greet", "src/utils.ts", s, r);

			// greet should be found in utils.ts (definition) and main.ts (usage)
			const files = new Set(results.map((ref) => ref.file));
			expect(files).toContain("src/utils.ts");
			expect(files).toContain("src/main.ts");

			// Should NOT include files that don't import greet
			expect(files).not.toContain("src/noimports.ts");
		});

		it("marks definition site correctly", () => {
			const { store: s, root: r } = setup();
			const results = findReferences("Calculator", "src/utils.ts", s, r);
			const definitions = results.filter((r) => r.isDefinition);
			expect(definitions.length).toBeGreaterThanOrEqual(1);

			const defFile = definitions[0].file;
			expect(defFile).toContain("utils.ts");
		});

		it("assigns high confidence to importing files", () => {
			const { store: s, root: r } = setup();
			const results = findReferences("VERSION", "src/utils.ts", s, r);
			const highConf = results.filter((r) => r.confidence === "high");
			expect(highConf.length).toBeGreaterThanOrEqual(2); // definition + usage
		});

		it("falls back to lexical search when import data is sparse", () => {
			const { store: s, root: r } = setup();
			// 'standalone' is defined in noimports.ts which nobody imports from
			// Should still be findable via fallback
			const results = findReferences("standalone", "src/noimports.ts", s, r);
			expect(results.length).toBeGreaterThanOrEqual(1);
		});
	});
});

// ── Python edge tests ──

const PYTHON_FIXTURES: Record<string, string> = {
	"utils.py": `
def greet(name):
    return "Hello, " + name

class Calculator:
    def add(self, n):
        return n
`.trimStart(),

	"main.py": `
from utils import greet, Calculator

calc = Calculator()
greet("world")
`.trimStart(),

	"models.py": `
from utils import Calculator

class ExtendedCalc(Calculator):
    def subtract(self, n):
        return -n
`.trimStart(),

	"standalone.py": `
def helper():
    pass
`.trimStart(),
};

describe("Python edge extraction", () => {
	beforeAll(async () => {
		await ensureParser();
	});

	let root: string;
	let cleanupProject: () => void;
	let store: ReturnType<typeof createTestStore>["store"];
	let cleanupStore: () => void;

	afterEach(() => {
		cleanupProject?.();
		cleanupStore?.();
	});

	function setup() {
		const proj = createTempProject(PYTHON_FIXTURES);
		root = proj.root;
		cleanupProject = proj.cleanup;

		const s = createTestStore();
		store = s.store;
		cleanupStore = s.cleanup;

		indexProject(root, store);
		return { root, store };
	}

	describe("Python imports", () => {
		it("extracts from-import with multiple names", () => {
			const { store: s } = setup();
			const deps = findDependencies("main.py", s);
			const importDeps = deps.filter((d) => d.relationship === "imports");
			expect(importDeps.length).toBeGreaterThanOrEqual(2);

			const symbols = importDeps.map((d) => d.sourceSymbol);
			expect(symbols).toContain("greet");
			expect(symbols).toContain("Calculator");
		});

		it("resolves Python module imports to files", () => {
			const { store: s } = setup();
			const deps = findDependencies("main.py", s);
			const importDeps = deps.filter((d) => d.relationship === "imports");
			const targetFiles = new Set(importDeps.map((d) => d.targetFile));
			expect(targetFiles).toContain("utils.py");
		});

		it("extracts class extends from argument list", () => {
			const { store: s } = setup();
			const deps = findDependencies("models.py", s);
			const extendsDeps = deps.filter((d) => d.relationship === "extends");
			expect(extendsDeps.length).toBeGreaterThanOrEqual(1);

			const calcExtend = extendsDeps.find((d) => d.targetSymbol === "Calculator");
			expect(calcExtend).toBeDefined();
			expect(calcExtend!.sourceSymbol).toBe("ExtendedCalc");
		});
	});

	describe("Python findDependents", () => {
		it("finds files that import from a Python module", () => {
			const { store: s } = setup();
			const dependents = findDependents(s, { file: "utils.py" });
			expect(dependents.length).toBeGreaterThanOrEqual(2);

			const sourceFiles = new Set(dependents.map((d) => d.sourceFile));
			expect(sourceFiles).toContain("main.py");
			expect(sourceFiles).toContain("models.py");
		});
	});
});
