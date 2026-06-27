/**
 * Scrollable telemetry overlay for the Pi AI Debugger.
 *
 * The always-on widget is hard-capped at 10 lines and is never focusable, so it
 * can only show a compact tail. Real scroll-back lives here: a focusable overlay
 * (opened via `/debugger logs`) that renders expanded packets with full history,
 * live-refreshing as new packets arrive (follow mode).
 *
 * Built on the pi-tui Component/Focusable contract (see pi's overlay-test / snake
 * examples). Reference: docs/03-instrumentation-widget.md.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Focusable } from "@earendil-works/pi-tui";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";

import type { TelemetryPacket } from "./server.ts";
import { formatPacketExpanded } from "./widget.ts";

/** Minimal slice of the TUI the overlay needs. */
interface TuiLike {
	requestRender(): void;
	terminal: { rows: number };
}

const V = "\u2502"; // │
const H = "\u2500"; // ─

/**
 * Focusable, scrollable view over the session packet buffer.
 *
 * `packets` is shared by reference with index.ts (mutated in place there), so
 * the overlay always sees the latest history. Call `refresh()` from `onPacket`
 * while the overlay is open to live-update it.
 */
export class LogStreamOverlay implements Focusable {
	/** Set by the TUI when focus changes. */
	focused = false;

	private readonly packets: TelemetryPacket[];
	private readonly tui: TuiLike;
	private readonly theme: Theme;
	private readonly onClose: () => void;

	/** Flat-line index at the top of the visible window (0 = oldest). */
	private scrollOffset = 0;
	/** Pinned to the newest packet (advances as packets arrive). */
	private follow = true;
	/** Body rows in the visible window (recomputed each render). */
	private windowHeight = 20;

	private cachedBody: string[] = [];
	private version = 0;
	private cachedVersion = -1;

	constructor(packets: TelemetryPacket[], tui: TuiLike, theme: Theme, onClose: () => void) {
		this.packets = packets;
		this.tui = tui;
		this.theme = theme;
		this.onClose = onClose;
	}

	/** Called by index.ts when a new packet arrives while the overlay is open. */
	refresh(): void {
		this.version++;
		this.tui.requestRender();
	}

	/** Close the overlay (used by `/debugger stop` and the close keys). */
	close(): void {
		this.onClose();
	}

	invalidate(): void {
		this.cachedVersion = -1;
	}

	dispose(): void {
		// No timers/streams to clean up.
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || data === "q" || data === "Q") {
			this.close();
			return;
		}
		if (matchesKey(data, "end")) {
			this.follow = true;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "home")) {
			this.follow = false;
			this.scrollOffset = 0;
			this.tui.requestRender();
			return;
		}

		const total = this.body().length;
		const max = Math.max(0, total - this.windowHeight);
		const step = (n: number) => {
			this.follow = false;
			this.scrollOffset = Math.max(0, Math.min(max, this.scrollOffset + n));
			this.tui.requestRender();
		};
		if (matchesKey(data, "down")) step(1);
		else if (matchesKey(data, "up")) step(-1);
		else if (matchesKey(data, "pageDown")) step(this.windowHeight);
		else if (matchesKey(data, "pageUp")) step(-this.windowHeight);
	}

	render(width: number): string[] {
		const th = this.theme;
		const body = this.body();
		const innerW = Math.max(1, width - 2); // one border char on each side

		// Size the window to ~90% of the terminal, leaving room for 6 chrome lines.
		const termRows = this.tui.terminal.rows || 24;
		this.windowHeight = Math.max(4, Math.floor(termRows * 0.9) - 6);

		const max = Math.max(0, body.length - this.windowHeight);
		let start: number;
		if (this.follow || body.length <= this.windowHeight) {
			start = max;
		} else {
			start = Math.min(this.scrollOffset, max);
			this.scrollOffset = start;
		}
		const end = Math.min(body.length, start + this.windowHeight);
		const visible = body.slice(start, end);

		const pad = (s: string) => s + " ".repeat(Math.max(0, innerW - 1 - visibleWidth(s)));
		const side = (s: string) => th.fg("border", `${V} `) + s + th.fg("border", V);
		const rule = (l: string, r: string) => th.fg("border", l + H.repeat(innerW) + r);

		const lines: string[] = [];
		lines.push(rule("\u256D", "\u256E")); // ╭─╮

		// Header
		const state = this.follow ? th.fg("success", "● live") : th.fg("accent", "⏸ paused");
		const head = `${th.fg("accent", th.bold("LOG STREAM"))} ${state} ${th.fg("muted", `${body.length} line(s), ${this.packets.length} packet(s)`)}`;
		lines.push(side(pad(head)));
		lines.push(rule("\u251C", "\u2524")); // ├─┤

		// Body window (pad short so the box height stays stable)
		for (const line of visible) lines.push(side(pad(line)));
		for (let i = visible.length; i < this.windowHeight; i++) lines.push(side(pad("")));

		lines.push(rule("\u251C", "\u2524")); // ├─┤
		const range = body.length > 0 ? `lines ${start + 1}\u2013${end} of ${body.length}` : "empty";
		const hint = `${th.fg("muted", range)}  ${th.fg("dim", "\u2191\u2193 scroll \u2022 PgUp/PgDn \u2022 Home/End \u2022 q/Esc close")}`;
		lines.push(side(pad(hint)));
		lines.push(rule("\u2570", "\u256F")); // ╰─╯

		return lines;
	}

	/** Cached flat list of expanded packet lines (rebuilt on version change). */
	private body(): string[] {
		if (this.cachedVersion === this.version) {
			return this.cachedBody;
		}
		const out: string[] = [];
		for (let i = 0; i < this.packets.length; i++) {
			if (i > 0) out.push(this.theme.fg("borderMuted", `\u2500${H.repeat(2)}`)); // ───
			for (const line of formatPacketExpanded(this.packets[i]!, this.theme)) out.push(line);
		}
		this.cachedBody = out;
		this.cachedVersion = this.version;
		return out;
	}
}
