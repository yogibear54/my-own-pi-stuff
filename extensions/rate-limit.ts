/**
 * Rate-Limit Reset Tracker
 *
 * Polls Z.ai (GLM Coding Plan) and MiniMax (Token Plan) quota endpoints and
 * shows live status in the footer. Captures `Retry-After` / `X-RateLimit-Reset`
 * on every provider response so the user can see when a model will become
 * available again after a 429.
 *
 * Reads: ZAI_API_KEY, MINIMAX_API_KEY
 * Provides: `/quota` command (full report)
 *
 * Sources:
 *  - https://docs.z.ai/devpack/faq
 *  - https://platform.minimax.io/docs/token-plan/faq
 *  - https://github.com/guyinwonder168/opencode-glm-quota (Z.ai endpoint shape)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

// ─── Types ──────────────────────────────────────────────────────────────────

interface ZaiLimit {
	type: string;
	unit: number;
	number: number;
	percentage: number;
	nextResetTime: number;
}

interface ZaiQuota {
	level?: string;
	limits: ZaiLimit[];
}

interface MinimaxModelRemains {
	model_name: string;
	current_interval_remaining_percent: number;
	current_weekly_remaining_percent: number;
	// Despite the `_time` suffix, these are in MILLISECONDS.
	remains_time: number;
	weekly_remains_time: number;
}

interface MinimaxQuota {
	model_remains: MinimaxModelRemains[];
}

interface ProviderState {
	ok: boolean;
	fiveHour?: { usedPct: number; resetAt: number };
	weekly?: { usedPct: number; resetAt: number };
	level?: string;
	fetchedAt?: number;
	error?: string;
}

interface RateLimitEvent {
	provider: string;
	resetAt?: number;
	retryAfter?: number;
	capturedAt: number;
}

interface Snapshot {
	zai?: ProviderState;
	minimax?: ProviderState;
	rateLimited: RateLimitEvent | null;
}

// ─── State ──────────────────────────────────────────────────────────────────

let snapshot: Snapshot = { rateLimited: null };
let pollTimer: ReturnType<typeof setInterval> | null = null;
let activeCtx: { ui: { setStatus(k: string, v: string): void; notify(m: string, lvl?: string): void }; model?: { provider: string; id: string } } | null = null;

// ─── HTTP ───────────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string, headers: Record<string, string>): Promise<T> {
	const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return (await res.json()) as T;
}

async function pollZai(key: string): Promise<ProviderState> {
	// Z.ai auth quirk: no "Bearer" prefix. Confirmed in the opencode-glm-quota README.
	const data = await fetchJson<{ data: ZaiQuota }>(
		"https://api.z.ai/api/monitor/usage/quota/limit",
		{ Authorization: key, "Content-Type": "application/json" },
	);
	const q = data.data;
	// 5h window  = TOKENS_LIMIT, unit:3 (hours), number:5
	// weekly     = TOKENS_LIMIT, unit:6 (weeks),  number:1
	const five = q.limits.find((l) => l.type === "TOKENS_LIMIT" && l.unit === 3 && l.number === 5);
	const weekly = q.limits.find((l) => l.type === "TOKENS_LIMIT" && l.unit === 6 && l.number === 1);
	return {
		ok: true,
		fetchedAt: Date.now(),
		level: q.level,
		fiveHour: five ? { usedPct: five.percentage, resetAt: five.nextResetTime } : undefined,
		weekly: weekly ? { usedPct: weekly.percentage, resetAt: weekly.nextResetTime } : undefined,
	};
}

async function pollMinimax(key: string): Promise<ProviderState> {
	const data = await fetchJson<MinimaxQuota>(
		"https://www.minimax.io/v1/token_plan/remains",
		{ Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
	);
	const general = data.model_remains.find((m) => m.model_name === "general");
	if (!general) throw new Error("no 'general' model_remains entry");
	return {
		ok: true,
		fetchedAt: Date.now(),
		fiveHour: {
			usedPct: 100 - general.current_interval_remaining_percent,
			resetAt: Date.now() + general.remains_time,
		},
		weekly: {
			usedPct: 100 - general.current_weekly_remaining_percent,
			resetAt: Date.now() + general.weekly_remains_time,
		},
	};
}

async function poll(): Promise<void> {
	const zaiKey = process.env.ZAI_API_KEY;
	const minimaxKey = process.env.MINIMAX_API_KEY;
	const next: Snapshot = { rateLimited: snapshot.rateLimited };

	if (zaiKey) {
		try {
			next.zai = await pollZai(zaiKey);
		} catch (e) {
			next.zai = { ok: false, error: eMsg(e), ...snapshot.zai };
		}
	}
	if (minimaxKey) {
		try {
			next.minimax = await pollMinimax(minimaxKey);
		} catch (e) {
			next.minimax = { ok: false, error: eMsg(e), ...snapshot.minimax };
		}
	}
	snapshot = next;
	renderStatus();
}

const eMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ─── Formatting ─────────────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
	if (!Number.isFinite(ms)) return "—";
	if (ms <= 0) return "now";
	const min = Math.floor(ms / 60_000);
	const h = Math.floor(min / 60);
	const d = Math.floor(h / 24);
	if (d > 0) return `${d}d${h % 24}h`;
	if (h > 0) return `${h}h${min % 60}m`;
	return `${min}m`;
}

function parseRetryAfter(v: unknown): number | undefined {
	if (v == null) return undefined;
	const s = String(v);
	if (/^\d+$/.test(s)) return parseInt(s, 10);
	const d = Date.parse(s);
	return isNaN(d) ? undefined : Math.max(0, Math.round((d - Date.now()) / 1000));
}

function parseResetTime(v: unknown): number | undefined {
	if (v == null) return undefined;
	const toMs = (n: number): number => (n > 1e12 ? n : n * 1000);
	if (typeof v === "number" && !isNaN(v)) return toMs(v);
	const s = String(v);
	if (/^\d+$/.test(s)) return toMs(parseInt(s, 10));
	const d = Date.parse(s);
	return isNaN(d) ? undefined : d;
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function renderStatus(): void {
	if (!activeCtx) return;
	const parts: string[] = [];

	if (snapshot.zai?.ok && snapshot.zai.fiveHour) {
		const z = snapshot.zai;
		const rem = 100 - z.fiveHour!.usedPct;
		const label = z.level ? `GLM ${z.level}` : "GLM";
		parts.push(`${label} 5h ${rem}% (${fmtDuration(z.fiveHour!.resetAt - Date.now())})`);
	} else if (snapshot.zai && !snapshot.zai.ok) {
		parts.push("GLM err");
	}

	if (snapshot.minimax?.ok && snapshot.minimax.fiveHour) {
		const m = snapshot.minimax;
		const rem = 100 - m.fiveHour!.usedPct;
		parts.push(`MiniMax 5h ${rem}% (${fmtDuration(m.fiveHour!.resetAt - Date.now())})`);
	} else if (snapshot.minimax && !snapshot.minimax.ok) {
		parts.push("MiniMax err");
	}

	const rl = snapshot.rateLimited;
	if (rl?.resetAt && rl.resetAt > Date.now()) {
		parts.push(`blocked ${fmtDuration(rl.resetAt - Date.now())}`);
	}

	activeCtx.ui.setStatus("rate-limit", parts.length ? parts.join(" · ") : "rate-limit idle");
}

function formatReport(): string {
	const lines: string[] = [];

	if (snapshot.zai?.ok && snapshot.zai.fiveHour) {
		const z = snapshot.zai;
		lines.push(`GLM ${z.level ?? "?"} · 5h: ${100 - z.fiveHour!.usedPct}% left, resets in ${fmtDuration(z.fiveHour!.resetAt - Date.now())}`);
	}
	if (snapshot.zai?.ok && snapshot.zai.weekly) {
		const z = snapshot.zai;
		lines.push(`GLM ${z.level ?? "?"} · weekly: ${100 - z.weekly!.usedPct}% left, resets in ${fmtDuration(z.weekly!.resetAt - Date.now())}`);
	}
	if (snapshot.minimax?.ok && snapshot.minimax.fiveHour) {
		const m = snapshot.minimax;
		lines.push(`MiniMax · 5h: ${100 - m.fiveHour!.usedPct}% left, resets in ${fmtDuration(m.fiveHour!.resetAt - Date.now())}`);
	}
	if (snapshot.minimax?.ok && snapshot.minimax.weekly) {
		const m = snapshot.minimax;
		lines.push(`MiniMax · weekly: ${100 - m.weekly!.usedPct}% left, resets in ${fmtDuration(m.weekly!.resetAt - Date.now())}`);
	}
	if (snapshot.zai && !snapshot.zai.ok && snapshot.zai.error) {
		lines.push(`GLM error: ${snapshot.zai.error}`);
	}
	if (snapshot.minimax && !snapshot.minimax.ok && snapshot.minimax.error) {
		lines.push(`MiniMax error: ${snapshot.minimax.error}`);
	}
	const rl = snapshot.rateLimited;
	if (rl) {
		const t = rl.resetAt ? new Date(rl.resetAt).toLocaleTimeString() : "?";
		lines.push(`⚠ ${rl.provider} blocked (until ${t}${rl.retryAfter ? `, retry-after ${rl.retryAfter}s` : ""})`);
	}
	if (!snapshot.zai && !snapshot.minimax) {
		lines.push("No API keys found (set ZAI_API_KEY and/or MINIMAX_API_KEY)");
	}
	return lines.join("\n");
}

// ─── Extension ──────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_e, ctx) => {
		activeCtx = ctx as typeof activeCtx;
		await poll().catch(() => {});
		pollTimer = setInterval(() => {
			poll().catch(() => {});
		}, POLL_INTERVAL_MS);
	});

	pi.on("session_shutdown", async () => {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
		activeCtx = null;
	});

	pi.on("after_provider_response", async (event, ctx) => {
		if (event.status !== 429 && event.status !== 403) return;
		const retryAfter = parseRetryAfter(event.headers["retry-after"]);
		const reset = parseResetTime(event.headers["x-ratelimit-reset"] ?? event.headers["x-rate-limit-reset"]);
		if (!retryAfter && !reset) return;
		activeCtx = ctx as typeof activeCtx;
		const m = ctx.model;
		snapshot.rateLimited = {
			provider: m ? `${m.provider}/${m.id}` : "current",
			resetAt: reset ?? Date.now() + (retryAfter ?? 60) * 1000,
			retryAfter,
			capturedAt: Date.now(),
		};
		renderStatus();
	});

	pi.registerCommand("quota", {
		description: "Show current LLM API quota status (Z.ai GLM, MiniMax)",
		handler: async (_args, ctx) => {
			activeCtx = ctx as typeof activeCtx;
			await poll().catch(() => {});
			ctx.ui.notify(formatReport(), "info");
		},
	});
}