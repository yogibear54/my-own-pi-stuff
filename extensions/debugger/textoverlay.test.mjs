/**
 * Tests for TextOverlay (read-only scrollable text viewer).
 *
 * Run: `node textoverlay.test.mjs`. Requires the node_modules SDK symlink that
 * cli.mjs bootstraps (imports @earendil-works/pi-tui for visibleWidth).
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import { TextOverlay } from "./textoverlay.ts";

let failures = 0;
function ok(cond, msg) {
	if (cond) console.log("  ok  -", msg);
	else { failures++; console.log("  FAIL-", msg); }
}

// Fake theme: wraps text in <color>…</color> tags so color decisions are assertable.
const theme = {
	fg: (c, s) => `<${c}>${s}</${c}>`,
	bold: (s) => s,
};

const tui = { requestRender() {}, terminal: { rows: 24 } };

console.log("\n[TextOverlay wrapping]");
{
	const long = "word ".repeat(30).trim(); // 149 visible chars, no newlines
	const overlay = new TextOverlay("BUG", [long], tui, theme, () => {});
	const width = 42; // innerW = 40, wrapW = 39
	const out = overlay.render(width);

	// Body lines sit between the header rule and the footer rule.
	const bodyLines = out.filter((l) => l.includes("word"));
	ok(bodyLines.length > 1, `long line wraps to multiple body lines (got ${bodyLines.length})`);
	const stripTags = (s) => s.replace(/<[^>]+>/g, ""); // fake-theme tags are literal text, not ANSI
	for (const l of bodyLines) {
		ok(visibleWidth(stripTags(l)) <= width, `wrapped body line fits width ${width} (got ${visibleWidth(stripTags(l))})`);
	}

	// Footer range reflects the wrapped line count, not the raw 1-line input.
	const footer = out[out.length - 2];
	ok(footer.includes(`of ${bodyLines.length}`), `footer counts wrapped lines (${footer.trim()})`);
}

console.log("\n[TextOverlay short content]");
{
	const overlay = new TextOverlay("HYPOTHESIS #1", ["one", "", "three"], tui, theme, () => {});
	const out = overlay.render(60);
	const bodyLines = out.filter((l) => l.includes("one") || l.includes("three"));
	ok(bodyLines.length === 2, "short lines render unwrapped");
	ok(out.some((l) => l.includes("lines 1–3 of 3")), "blank line preserved in range count");
}

console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
