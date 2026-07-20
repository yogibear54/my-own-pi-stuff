/**
 * Read-only scrollable text overlay for the Pi AI Debugger.
 *
 * The always-on widget renders the bug / hypothesis summaries as a single line
 * each (see widget.ts renderSummaryLine); the full multi-line text lives here,
 * opened via `/debugger bug` and `/debugger hypothesis`.
 *
 * Same Component/Focusable contract as LogStreamOverlay (logstream.ts), minus
 * the live-refresh: the content is a static snapshot of the summary text at
 * open time.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Focusable } from "@earendil-works/pi-tui";
import { matchesKey, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

/** Minimal slice of the TUI the overlay needs. */
interface TuiLike {
	requestRender(): void;
	terminal: { rows: number };
}

const V = "│"; // │
const H = "─"; // ─

/** Focusable, scrollable read-only view over a flat list of text lines. */
export class TextOverlay implements Focusable {
	/** Set by the TUI when focus changes. */
	focused = false;

	private readonly title: string;
	private readonly content: string[];
	private readonly tui: TuiLike;
	private readonly theme: Theme;
	private readonly onClose: () => void;

	/** Line index at the top of the visible window (0 = first). */
	private scrollOffset = 0;
	/** Body rows in the visible window (recomputed each render). */
	private windowHeight = 20;
	/** Content wrapped to the last rendered width (drives scroll math in handleInput). */
	private wrapped: string[] = [];

	constructor(title: string, content: string[], tui: TuiLike, theme: Theme, onClose: () => void) {
		this.title = title;
		this.content = content;
		this.tui = tui;
		this.theme = theme;
		this.onClose = onClose;
	}

	/** Close the overlay (used by `/debugger stop` and the close keys). */
	close(): void {
		this.onClose();
	}

	invalidate(): void {
		// Static content; nothing to recompute.
	}

	dispose(): void {
		// No timers/streams to clean up.
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || data === "q" || data === "Q") {
			this.close();
			return;
		}
		const total = this.wrapped.length > 0 ? this.wrapped.length : this.content.length;
		const max = Math.max(0, total - this.windowHeight);
		const step = (n: number) => {
			this.scrollOffset = Math.max(0, Math.min(max, this.scrollOffset + n));
			this.tui.requestRender();
		};
		if (matchesKey(data, "home")) {
			this.scrollOffset = 0;
			this.tui.requestRender();
		} else if (matchesKey(data, "end")) {
			this.scrollOffset = max;
			this.tui.requestRender();
		} else if (matchesKey(data, "down")) step(1);
		else if (matchesKey(data, "up")) step(-1);
		else if (matchesKey(data, "pageDown")) step(this.windowHeight);
		else if (matchesKey(data, "pageUp")) step(-this.windowHeight);
	}

	render(width: number): string[] {
		const th = this.theme;
		const innerW = Math.max(1, width - 2); // one border char on each side

		// Size the window to ~90% of the terminal, leaving room for 6 chrome lines.
		const termRows = this.tui.terminal.rows || 24;
		this.windowHeight = Math.max(4, Math.floor(termRows * 0.9) - 6);

		// Wrap content to the body width; scroll math operates on wrapped lines.
		const wrapW = Math.max(1, innerW - 1); // pad() leaves one leading space
		const wrapped = this.content.flatMap((l) => (l === "" ? [""] : wrapTextWithAnsi(l, wrapW)));
		this.wrapped = wrapped;

		const max = Math.max(0, wrapped.length - this.windowHeight);
		const start = Math.min(this.scrollOffset, max);
		this.scrollOffset = start;
		const end = Math.min(wrapped.length, start + this.windowHeight);
		const visible = wrapped.slice(start, end);

		const pad = (s: string) => s + " ".repeat(Math.max(0, innerW - 1 - visibleWidth(s)));
		const side = (s: string) => th.fg("border", `${V} `) + s + th.fg("border", V);
		const rule = (l: string, r: string) => th.fg("border", l + H.repeat(innerW) + r);

		const lines: string[] = [];
		lines.push(rule("╭", "╮"));

		// Header
		const head = `${th.fg("accent", th.bold(this.title))} ${th.fg("muted", `${wrapped.length} line(s)`)}`;
		lines.push(side(pad(head)));
		lines.push(rule("├", "┤"));

		// Body window (pad short so the box height stays stable)
		for (const line of visible) lines.push(side(pad(line)));
		for (let i = visible.length; i < this.windowHeight; i++) lines.push(side(pad("")));

		lines.push(rule("├", "┤"));
		const range = wrapped.length > 0 ? `lines ${start + 1}–${end} of ${wrapped.length}` : "empty";
		const hint = `${th.fg("muted", range)}  ${th.fg("dim", "↑↓ scroll • PgUp/PgDn • Home/End • q/Esc close")}`;
		lines.push(side(pad(hint)));
		lines.push(rule("╰", "╯"));

		return lines;
	}
}
