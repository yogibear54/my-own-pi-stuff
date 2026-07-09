#!/usr/bin/env node
/**
 * CLI runner for the Pi AI Debugger HTTP log server.
 *
 * Daemon-style: `start` launches the server detached in the background
 * (survives terminal close), `stop` stops it, `status` reports it.
 *
 *   node cli.mjs start [--port N] [--cwd DIR]
 *   node cli.mjs stop  [--cwd DIR]
 *   node cli.mjs status [--cwd DIR]
 *
 * The server is implemented in ./server.ts (see docs/01-log-server-usage.md).
 * This file is a thin wrapper: it does not modify server.ts.
 *
 * Resolution note: server.ts imports `@earendil-works/pi-coding-agent`, which
 * pi resolves at runtime via jiti aliases. For a standalone CLI run we ensure a
 * local `node_modules/@earendil-works/pi-coding-agent` symlink to the global
 * install (created on first run, left in place; gitignored by the repo).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const EXT_DIR = path.dirname(SCRIPT_PATH);
const STATE_FILENAME = "debug-server.json";
const DAEMON_LOG_NAME = "debug-server.daemon.log";
const START_TIMEOUT_MS = 5000;
const STOP_TIMEOUT_MS = 5000;

// --- SDK symlink bootstrap -------------------------------------------------
// Ensures ./node_modules/@earendil-works/pi-coding-agent points at the global
// install so the bare specifier resolves under plain `node`. Idempotent.
function findSdkPath() {
	const dir = path.join(path.dirname(process.execPath), "..", "lib", "node_modules");
	const p = path.join(dir, "@earendil-works", "pi-coding-agent");
	return fs.existsSync(p) ? p : null;
}
function ensureSdkLink() {
	const target = findSdkPath();
	if (!target) {
		console.error("Could not locate @earendil-works/pi-coding-agent global install.");
		process.exit(1);
	}
	const linkDir = path.join(EXT_DIR, "node_modules", "@earendil-works");
	const link = path.join(linkDir, "pi-coding-agent");
	fs.mkdirSync(linkDir, { recursive: true });
	let existing = null;
	try { existing = fs.readlinkSync(link); } catch {}
	if (existing === target) return;
	try { fs.rmSync(link, { recursive: true, force: true }); } catch {}
	fs.symlinkSync(target, link, "dir");
}
ensureSdkLink();

const { startLogServer } = await import("./server.ts");
const { CONFIG_DIR_NAME } = await import("@earendil-works/pi-coding-agent");

// --- helpers ---------------------------------------------------------------
function parseArgs(argv) {
	const out = { _: [], port: undefined, cwd: undefined, help: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "-h" || a === "--help") out.help = true;
		else if (a === "--port") out.port = parsePort(argv[++i]);
		else if (a.startsWith("--port=")) out.port = parsePort(a.slice("--port=".length));
		else if (a === "--cwd") out.cwd = argv[++i];
		else if (a.startsWith("--cwd=")) out.cwd = a.slice("--cwd=".length);
		else out._.push(a);
	}
	return out;
}
function parsePort(v) {
	if (v === undefined) { console.error("--port requires a value"); process.exit(2); }
	const n = Number(v);
	if (!Number.isInteger(n) || n < 1 || n > 65535) {
		console.error(`Invalid port: ${v}`); process.exit(2);
	}
	return n;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function stateFile(cwd) {
	return path.join(cwd, CONFIG_DIR_NAME, STATE_FILENAME);
}
function readState(cwd) {
	try { return JSON.parse(fs.readFileSync(stateFile(cwd), "utf8")); } catch { return null; }
}
function writeState(cwd, obj) {
	const file = stateFile(cwd);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
	fs.renameSync(tmp, file);
}
function removeState(cwd) {
	try { fs.unlinkSync(stateFile(cwd)); } catch {}
}
function isAlive(pid) {
	try { process.kill(pid, 0); return true; }
	catch (e) { return e.code === "EPERM"; } // ESRCH=gone, EPERM=alive but not ours
}
function formatUptime(ms) {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${m % 60}m`;
}

// --- commands --------------------------------------------------------------
async function start(args) {
	const cwd = path.resolve(args.cwd ?? process.cwd());

	// Refuse if a live server is already tracked; clear stale state.
	const existing = readState(cwd);
	if (existing && isAlive(existing.pid)) {
		console.log(`Already running: pid ${existing.pid}, port ${existing.port}, target ${existing.telemetryTarget}`);
		console.log(`Run "stop" first.`);
		return;
	}
	if (existing) removeState(cwd);

	// Ensure config + logs dirs (the daemon writes here).
	const logsDir = path.join(cwd, CONFIG_DIR_NAME, "logs");
	fs.mkdirSync(logsDir, { recursive: true });
	const daemonLog = path.join(logsDir, DAEMON_LOG_NAME);

	const childArgs = [SCRIPT_PATH, "__serve", "--cwd", cwd];
	if (args.port !== undefined) childArgs.push("--port", String(args.port));
	const out = fs.openSync(daemonLog, "a");
	const child = spawn(process.execPath, childArgs, {
		cwd,
		detached: true,
		stdio: ["ignore", out, out],
		env: { ...process.env },
	});
	child.unref();
	child.on("exit", (code, sig) => { childExited = { code, sig }; });
	let childExited = null;

	// Wait for the daemon to write state with our child's pid.
	const deadline = Date.now() + START_TIMEOUT_MS;
	while (Date.now() < deadline && !childExited) {
		const s = readState(cwd);
		if (s && s.pid === child.pid && typeof s.port === "number") {
			console.log(`Started: pid ${s.pid}, port ${s.port}, target ${s.telemetryTarget}`);
			console.log(`  log file: ${s.logFile}`);
			console.log(`  state:    ${stateFile(cwd)}`);
			return;
		}
		await sleep(100);
	}
	console.error("Failed to confirm server start.");
	console.error(childExited
		? `Daemon exited (code=${childExited.code} sig=${childExited.sig}). See ${daemonLog}`
		: `Timed out waiting for state. See ${daemonLog}`);
	// Best-effort cleanup of a half-started daemon.
	if (child.pid && isAlive(child.pid)) { try { process.kill(child.pid, "SIGKILL"); } catch {} }
	removeState(cwd);
	process.exit(1);
}

async function stop(args) {
	const cwd = path.resolve(args.cwd ?? process.cwd());
	const s = readState(cwd);
	if (!s) { console.log("Not running (no state)."); return; }
	if (!isAlive(s.pid)) {
		console.log(`Not running (stale state for pid ${s.pid}). Cleaning up.`);
		removeState(cwd);
		return;
	}
	console.log(`Stopping pid ${s.pid} (port ${s.port})...`);
	try { process.kill(s.pid, "SIGTERM"); }
	catch (e) { console.error(`Failed to signal: ${e.message}`); process.exit(1); }

	const deadline = Date.now() + STOP_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (!isAlive(s.pid)) { removeState(cwd); console.log("Stopped."); return; }
		await sleep(100);
	}
	console.error("Did not exit after SIGTERM; sending SIGKILL.");
	try { process.kill(s.pid, "SIGKILL"); } catch {}
	removeState(cwd);
}

function status(args) {
	const cwd = path.resolve(args.cwd ?? process.cwd());
	const s = readState(cwd);
	if (!s) { console.log("Not running."); return; }
	if (!isAlive(s.pid)) { console.log(`Not running (stale state for pid ${s.pid}).`); return; }
	console.log(`Running: pid ${s.pid}, port ${s.port}`);
	console.log(`  target:   ${s.telemetryTarget}`);
	console.log(`  log file: ${s.logFile}`);
	console.log(`  state:    ${stateFile(cwd)}`);
	if (typeof s.startedAt === "number") console.log(`  uptime:   ${formatUptime(Date.now() - s.startedAt)}`);
}

async function serve(args) {
	// Internal: this is the detached daemon process.
	const cwd = path.resolve(args.cwd ?? process.cwd());
	const opts = { cwd };
	if (args.port !== undefined) opts.port = args.port;

	let srv;
	try {
		srv = await startLogServer(opts);
	} catch (e) {
		console.error(`Failed to start log server: ${e.message}`);
		process.exit(1);
	}
	writeState(cwd, {
		pid: process.pid,
		port: srv.port,
		logFile: srv.logFile,
		telemetryTarget: srv.telemetryTarget,
		startedAt: Date.now(),
		node: process.execPath,
	});
	console.log(`debug-server serving on ${srv.telemetryTarget} (pid ${process.pid})`);

	const shutdown = (sig) => {
		removeState(cwd);
		srv.close();
		process.exit(0);
	};
	process.on("SIGTERM", () => shutdown("SIGTERM"));
	process.on("SIGINT", () => shutdown("SIGINT"));
}

function help() {
	console.log(`Pi AI Debugger — HTTP log server CLI

Usage:
  node cli.mjs start [--port N] [--cwd DIR]
  node cli.mjs stop  [--cwd DIR]
  node cli.mjs status [--cwd DIR]

Commands:
  start    Start the server in the background (detached; survives terminal close).
  stop     Stop a running server (SIGTERM, then SIGKILL after ${STOP_TIMEOUT_MS / 1000}s).
  status   Show whether the server is running (pid, port, log file, uptime).

Options:
  --port N   Port to bind. Overrides PI_DEBUGGER_PORT / settings / default (8866).
  --cwd DIR  Working directory for <DIR>/${CONFIG_DIR_NAME}/logs/ and state file.
             Defaults to the current directory.

Port precedence: --port > PI_DEBUGGER_PORT (env) > debugger.port (settings) > 8866.
A busy port auto-increments until free.`);
}

// --- dispatch --------------------------------------------------------------
const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (args.help || !cmd) { help(); process.exit(0); }
switch (cmd) {
	case "start": await start(args); break;
	case "stop": await stop(args); break;
	case "status": status(args); break;
	case "__serve": await serve(args); break;
	default: console.error(`Unknown command: ${cmd}`); help(); process.exit(1);
}
