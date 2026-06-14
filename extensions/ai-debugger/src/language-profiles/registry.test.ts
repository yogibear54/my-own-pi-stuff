/**
 * Tests for the language profile registry.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { getProfileForFile, getProfileByName, listProfiles, detectProfiles } from "./registry.js";
import { TypeScriptProfile } from "./typescript.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-debugger-registry-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("registry", () => {
	describe("getProfileForFile", () => {
		it("returns the TypeScript profile for .ts", () => {
			expect(getProfileForFile("src/cart.ts")?.name).toBe("typescript");
		});

		it("returns the TypeScript profile for .tsx, .js, .jsx", () => {
			expect(getProfileForFile("App.tsx")?.name).toBe("typescript");
			expect(getProfileForFile("index.js")?.name).toBe("typescript");
			expect(getProfileForFile("Component.jsx")?.name).toBe("typescript");
		});

		it("returns undefined for unknown extensions", () => {
			expect(getProfileForFile("script.py")).toBeUndefined();
			expect(getProfileForFile("Cart.php")).toBeUndefined();
			expect(getProfileForFile("README.md")).toBeUndefined();
		});

		it("handles paths with no extension", () => {
			expect(getProfileForFile("Makefile")).toBeUndefined();
		});
	});

	describe("getProfileByName", () => {
		it("returns the TypeScript profile by name", () => {
			expect(getProfileByName("typescript")).toBe(TypeScriptProfile);
		});

		it("returns undefined for unknown name", () => {
			expect(getProfileByName("rust")).toBeUndefined();
		});
	});

	describe("listProfiles", () => {
		it("includes the TypeScript profile", () => {
			const names = listProfiles().map((p) => p.name);
			expect(names).toContain("typescript");
		});

		it("returns a copy (not the internal array)", () => {
			const a = listProfiles();
			const b = listProfiles();
			expect(a).not.toBe(b);
		});
	});

	describe("detectProfiles", () => {
		it("detects TypeScript when package.json exists", () => {
			fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
			const detected = detectProfiles(tmpDir).map((p) => p.name);
			expect(detected).toContain("typescript");
		});

		it("returns empty for a project with no recognized manifests", () => {
			expect(detectProfiles(tmpDir)).toEqual([]);
		});
	});
});
