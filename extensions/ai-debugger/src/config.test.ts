/**
 * Tests for configuration loading.
 *
 * Strategy:
 * - Each test gets an isolated temp directory. A `.pi/debug-config.json` is
 *   written directly when needed (no factory — the test data is small).
 * - Tests cover every verification criterion from the TODO:
 *   missing file → defaults, partial file → merge, invalid JSON → clear error.
 * - Additional tests cover edge cases: wrong types, non-object JSON, unknown keys.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadConfig, DEFAULTS } from "./config.js";

// ── Test isolation ─────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-debugger-config-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Write a `.pi/debug-config.json` in the test's temp directory. */
function writeConfig(json: object): void {
	const dir = path.join(tmpDir, ".pi");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "debug-config.json"), JSON.stringify(json), "utf-8");
}

/** Write raw text to `.pi/debug-config.json` (for invalid JSON tests). */
function writeRawConfig(text: string): void {
	const dir = path.join(tmpDir, ".pi");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "debug-config.json"), text, "utf-8");
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("loadConfig", () => {
	// ── Missing file ──────────────────────────────────────────────────
	describe("missing file", () => {
		it("returns defaults when no config file exists", () => {
			const config = loadConfig(tmpDir);
			expect(config).toEqual(DEFAULTS);
		});

		it("returns a fresh copy (not the frozen DEFAULTS object)", () => {
			const config = loadConfig(tmpDir);
			expect(config).toEqual(DEFAULTS);
			expect(config).not.toBe(DEFAULTS);
		});
	});

	// ── Partial file ──────────────────────────────────────────────────
	describe("partial file", () => {
		it("merges user values with defaults for missing fields", () => {
			writeConfig({ port: 9999 });
			const config = loadConfig(tmpDir);
			expect(config.port).toBe(9999);
			expect(config.maxIterations).toBe(DEFAULTS.maxIterations);
			expect(config.maxLogEntries).toBe(DEFAULTS.maxLogEntries);
		});

		it("merges correctly when only maxIterations is set", () => {
			writeConfig({ maxIterations: 10 });
			const config = loadConfig(tmpDir);
			expect(config.port).toBe(DEFAULTS.port);
			expect(config.maxIterations).toBe(10);
			expect(config.maxLogEntries).toBe(DEFAULTS.maxLogEntries);
		});

		it("all three fields override defaults when provided", () => {
			writeConfig({ port: 3000, maxIterations: 8, maxLogEntries: 5000 });
			const config = loadConfig(tmpDir);
			expect(config).toEqual({ port: 3000, maxIterations: 8, maxLogEntries: 5000 });
		});
	});

	// ── Invalid JSON ──────────────────────────────────────────────────
	describe("invalid JSON", () => {
		it("throws a clear error for malformed JSON", () => {
			writeRawConfig("{ invalid json !!!");
			expect(() => loadConfig(tmpDir)).toThrow(/Invalid JSON in debug config/);
		});

		it("throws a clear error for an empty file", () => {
			writeRawConfig("");
			expect(() => loadConfig(tmpDir)).toThrow(/Invalid JSON in debug config/);
		});

		it("throws when the file contains an array instead of an object", () => {
			writeRawConfig("[1, 2, 3]");
			expect(() => loadConfig(tmpDir)).toThrow(/must be a JSON object/);
		});

		it("throws when the file contains a primitive", () => {
			writeRawConfig("42");
			expect(() => loadConfig(tmpDir)).toThrow(/must be a JSON object/);
		});

		it("throws when the file contains null", () => {
			writeRawConfig("null");
			expect(() => loadConfig(tmpDir)).toThrow(/must be a JSON object/);
		});
	});

	// ── Wrong types ───────────────────────────────────────────────────
	describe("wrong types", () => {
		it("falls back to default when port is a string", () => {
			writeConfig({ port: "not-a-number" });
			const config = loadConfig(tmpDir);
			expect(config.port).toBe(DEFAULTS.port);
		});

		it("falls back to default when maxIterations is a boolean", () => {
			writeConfig({ maxIterations: true });
			const config = loadConfig(tmpDir);
			expect(config.maxIterations).toBe(DEFAULTS.maxIterations);
		});

		it("falls back to default when maxLogEntries is null", () => {
			writeConfig({ maxLogEntries: null });
			const config = loadConfig(tmpDir);
			expect(config.maxLogEntries).toBe(DEFAULTS.maxLogEntries);
		});

		it("handles multiple wrong types at once", () => {
			writeConfig({ port: "8080", maxIterations: null, maxLogEntries: "many" });
			const config = loadConfig(tmpDir);
			expect(config).toEqual(DEFAULTS);
		});
	});

	// ── Unknown keys ──────────────────────────────────────────────────
	describe("unknown keys", () => {
		it("ignores unknown keys without error", () => {
			writeConfig({ port: 4000, futureFeature: true, anotherOne: "hello" });
			const config = loadConfig(tmpDir);
			expect(config.port).toBe(4000);
			expect((config as Record<string, unknown>).futureFeature).toBeUndefined();
			expect((config as Record<string, unknown>).anotherOne).toBeUndefined();
		});

		it("empty object returns all defaults", () => {
			writeConfig({});
			const config = loadConfig(tmpDir);
			expect(config).toEqual(DEFAULTS);
		});
	});
});
