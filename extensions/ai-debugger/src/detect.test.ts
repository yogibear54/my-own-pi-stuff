/**
 * Tests for language auto-detection.
 *
 * Strategy:
 * - detectProjectLanguage, buildNoLanguageWarning, isSupportedProfile are tested
 *   with real filesystem operations in isolated temp directories
 * - Tests simulate various project structures (package.json, no manifests,
 *   multiple manifests)
 *
 * Per TODO verifies:
 * - Project with package.json → ["typescript"]
 * - Empty project → [] with warning
 * - Project with package.json + requirements.txt → ["typescript"] (Python not yet supported)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
	detectProjectLanguage,
	buildNoLanguageWarning,
	isSupportedProfile,
} from "./detect.js";

// ── Test isolation ─────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-debugger-detect-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────────────────────────────

function writeFile(name: string, content = "{}"): void {
	fs.writeFileSync(path.join(tmpDir, name), content, "utf-8");
}

// ── detectProjectLanguage ──────────────────────────────────────────────────

describe("detectProjectLanguage", () => {
	it("detects typescript when package.json exists", () => {
		writeFile("package.json", '{"name": "my-project"}');
		expect(detectProjectLanguage(tmpDir)).toEqual(["typescript"]);
	});

	it("returns empty array for empty project (no manifests)", () => {
		expect(detectProjectLanguage(tmpDir)).toEqual([]);
	});

	it("returns empty array when only non-JS manifests exist", () => {
		// Python manifests exist but Python is not yet supported
		writeFile("requirements.txt", "flask==2.0");
		writeFile("pyproject.toml", "[project]");
		expect(detectProjectLanguage(tmpDir)).toEqual([]);
	});

	it("returns only typescript even when other manifests exist", () => {
		writeFile("package.json", '{"name": "fullstack"}');
		writeFile("requirements.txt", "flask");
		writeFile("pyproject.toml", "[project]");
		expect(detectProjectLanguage(tmpDir)).toEqual(["typescript"]);
	});

	it("handles package.json with various content", () => {
		writeFile("package.json", '{"name":"test","dependencies":{"express":"^4"}}');
		expect(detectProjectLanguage(tmpDir)).toEqual(["typescript"]);
	});

	it("handles empty package.json", () => {
		writeFile("package.json", "{}");
		expect(detectProjectLanguage(tmpDir)).toEqual(["typescript"]);
	});

	it("handles malformed package.json (just checks existence)", () => {
		writeFile("package.json", "not valid json {{{");
		// Detection is based on file existence, not content parsing
		expect(detectProjectLanguage(tmpDir)).toEqual(["typescript"]);
	});

	it("does not detect from nested directories", () => {
		// package.json in a subdirectory should not count
		fs.mkdirSync(path.join(tmpDir, "subdir"));
		fs.writeFileSync(path.join(tmpDir, "subdir", "package.json"), "{}");
		expect(detectProjectLanguage(tmpDir)).toEqual([]);
	});

	it("returns a new array each call (no shared reference)", () => {
		writeFile("package.json");
		const result1 = detectProjectLanguage(tmpDir);
		const result2 = detectProjectLanguage(tmpDir);
		expect(result1).not.toBe(result2); // different array instances
		expect(result1).toEqual(result2); // same content
	});

	it("handles non-existent project root gracefully", () => {
		// fs.existsSync returns false for non-existent paths — no crash
		const result = detectProjectLanguage(path.join(tmpDir, "nonexistent"));
		expect(result).toEqual([]);
	});
});

// ── buildNoLanguageWarning ─────────────────────────────────────────────────

describe("buildNoLanguageWarning", () => {
	it("mentions the project doesn't appear to be JS/TS", () => {
		const warning = buildNoLanguageWarning();
		expect(warning).toContain("JS/TS");
	});

	it("mentions the debugger only supports JavaScript/TypeScript", () => {
		const warning = buildNoLanguageWarning();
		expect(warning).toContain("JavaScript/TypeScript");
	});

	it("is a clear, user-readable message", () => {
		const warning = buildNoLanguageWarning();
		expect(warning.length).toBeGreaterThan(20);
		expect(warning.endsWith(".")).toBe(true);
	});
});

// ── isSupportedProfile ─────────────────────────────────────────────────────

describe("isSupportedProfile", () => {
	it("returns true for typescript", () => {
		expect(isSupportedProfile("typescript")).toBe(true);
	});

	it("returns false for python (not yet supported)", () => {
		expect(isSupportedProfile("python")).toBe(false);
	});

	it("returns false for unknown profiles", () => {
		expect(isSupportedProfile("go")).toBe(false);
		expect(isSupportedProfile("rust")).toBe(false);
		expect(isSupportedProfile("unknown")).toBe(false);
	});

	it("returns false for empty string", () => {
		expect(isSupportedProfile("")).toBe(false);
	});
});
