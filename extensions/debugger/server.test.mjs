/**
 * Standalone test for server.ts — exercises the Part 1 acceptance criteria.
 *
 * Run: `node server.test.mjs` (Node ≥ 22.6 with type-stripping on by default).
 *
 * The extension imports `@earendil-works/pi-coding-agent`, which pi resolves at
 * runtime via jiti aliases. For standalone testing we symlink the global npm
 * install into a local node_modules (created and removed per run) so the bare
 * specifier resolves during `import("./server.ts")`.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Locate the global SDK install ----------------------------------------
const PKG_NAME = "@earendil-works/pi-coding-agent";
const globalNm = path.join(path.dirname(process.execPath), "../lib/node_modules");
const pkgPath = path.join(globalNm, PKG_NAME);
if (!fs.existsSync(pkgPath)) {
	console.error(`Could not find ${PKG_NAME} at ${pkgPath}`);
	process.exit(1);
}
// Create a temporary local symlink so the bare specifier resolves.
const linkDir = path.join(__dirname, "node_modules/@earendil-works");
const link = path.join(linkDir, "pi-coding-agent");
fs.mkdirSync(linkDir, { recursive: true });
try {
	fs.symlinkSync(pkgPath, link, "dir");
} catch (e) {
	if (e.code !== "EEXIST") throw e;
}

// --- Minimal assert helpers (no server.ts dependency) ---------------------
let failures = 0;
function ok(cond, msg) {
	if (cond) console.log("  ok  -", msg);
	else {
		failures++;
		console.log("  FAIL-", msg);
	}
}
function eq(actual, expected, msg) {
	ok(actual === expected, `${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}
async function post(port, body) {
	const res = await fetch(`http://127.0.0.1:${port}/`, {
		method: "POST",
		body,
		headers: { "Content-Type": "application/json", Connection: "close" },
	});
	let json = null;
	try { json = await res.json(); } catch {}
	return { status: res.status, json };
}
async function get(port) {
	const res = await fetch(`http://127.0.0.1:${port}/`, { method: "GET", headers: { Connection: "close" } });
	let json = null;
	try { json = await res.json(); } catch {}
	return { status: res.status, json, allow: res.headers.get("allow") };
}
function getFreePort() {
	return new Promise((resolve, reject) => {
		const s = net.createServer();
		s.listen(0, "127.0.0.1", () => {
			const p = s.address().port;
			s.close(() => resolve(p));
		});
		s.on("error", reject);
	});
}
function readLines(file) {
	return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.length > 0);
}

const tmpDirs = [];
function tmpCwd() {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), "pi-debug-"));
	tmpDirs.push(d);
	return d;
}

const validPacket = {
	log_id: "1698844392123-4",
	event_timestamp: "2023-11-01T14:53:12.123Z",
	level: "ERROR",
	source: { file: "auth_controller.py", line: 145, function: "validate_user_token" },
	message: "Failed to decrypt user token.",
	variables: { token_length: 12 },
	stack_trace: "Traceback (...)",
};

const savedEnv = process.env.PI_DEBUGGER_PORT;
delete process.env.PI_DEBUGGER_PORT;

try {
	const { startLogServer, DEFAULT_PORT } = await import("./server.ts");

	// === Endpoint behavior (criteria 1–4) =================================
	{
		console.log("\n[endpoint behavior]");
		const srv = await startLogServer({ cwd: tmpCwd() });
		try {
			const r1 = await post(srv.port, JSON.stringify(validPacket));
			eq(r1.status, 200, "valid POST → 200");
			eq(r1.json?.status, "success", "valid POST body → {status:success}");

			const r2 = await post(srv.port, "not json");
			eq(r2.status, 400, "malformed JSON → 400");

			const r3 = await post(srv.port, "{}");
			eq(r3.status, 400, "missing required fields → 400");

			const r4 = await get(srv.port);
			eq(r4.status, 405, "GET → 405");
			eq(r4.allow, "POST", "405 sets Allow: POST");
		} finally {
			srv.close();
		}
	}

	// === Log file append (criterion 5) =====================================
	{
		console.log("\n[log file append]");
		const srv = await startLogServer({ cwd: tmpCwd() });
		try {
			await post(srv.port, JSON.stringify(validPacket));
			await post(srv.port, JSON.stringify({ ...validPacket, log_id: "2" }));

			ok(fs.existsSync(srv.logFile), "session log file exists");
			ok(/\.log$/.test(path.basename(srv.logFile)), "filename ends in .log");
			eq(path.basename(srv.logFile).length, 12, "filename = 8 chars + '.log'");
			eq(/^[a-z0-9]{8}\.log$/.test(path.basename(srv.logFile)), true, "stem is 8 lowercase-alphanumeric chars");

			const lines = readLines(srv.logFile);
			eq(lines.length, 2, "two POSTs → two JSONL lines in the SAME file");
			eq(JSON.parse(lines[0]).log_id, "1698844392123-4", "first line is first packet");
			eq(JSON.parse(lines[1]).log_id, "2", "second line is second packet");
		} finally {
			srv.close();
		}
	}

	// === Dir auto-create (criterion 7) ====================================
	{
		console.log("\n[dir auto-create]");
		const cwd = tmpCwd();
		const srv = await startLogServer({ cwd });
		try {
			ok(fs.existsSync(path.join(cwd, ".pi", "logs")), ".pi/logs/ auto-created under cwd");
			ok(fs.existsSync(srv.logFile), "log file created at start (before any packet)");
		} finally {
			srv.close();
		}
	}

	// === Validation edge cases (level, source types, optional fields) ======
	{
		console.log("\n[validation]");
		const srv = await startLogServer({ cwd: tmpCwd() });
		try {
			const expect400 = async (mut, label) => {
				const r = await post(srv.port, JSON.stringify({ ...validPacket, ...mut }));
				eq(r.status, 400, label);
			};
			await expect400({ level: "" }, "empty level → 400");
			await expect400({ level: 5 }, "non-string level → 400");
			await expect400({ source: { file: "a", line: "1", function: "f" } }, "line not number → 400");
			await expect400({ source: { file: "a", line: 1 } }, "missing source.function → 400");
			await expect400({ message: 5 }, "non-string message → 400");
			await expect400({ variables: "x" }, "wrong-typed variables → 400");
			await expect400({ stack_trace: 5 }, "wrong-typed stack_trace → 400");
			await expect400({ log_id: 5 }, "non-string log_id → 400");
			await expect400({ source: "x" }, "non-object source → 400");
			await expect400({ source: null }, "null source → 400");

			// level is a non-empty string — custom levels accepted (no enum)
			eq((await post(srv.port, JSON.stringify({ ...validPacket, level: "VERBOSE" }))).status, 200, "custom (non-enum) level → 200");

			// missing optional fields still ok
			const minimal = { ...validPacket };
			delete minimal.variables;
			delete minimal.stack_trace;
			eq((await post(srv.port, JSON.stringify(minimal))).status, 200, "packet without optional fields → 200");

			// extra unknown fields are tolerated (only required fields are checked)
			eq((await post(srv.port, JSON.stringify({ ...validPacket, mystery: 42 }))).status, 200, "packet with extra fields → 200");
		} finally {
			srv.close();
		}
	}

	// === onPacket callback + seq ==========================================
	{
		console.log("\n[onPacket]");
		const srv = await startLogServer({ cwd: tmpCwd() });
		try {
			const seen = [];
			srv.onPacket((packet, seq) => seen.push({ packet, seq }));
			await post(srv.port, JSON.stringify(validPacket));
			await post(srv.port, JSON.stringify({ ...validPacket, log_id: "2" }));
			eq(seen.length, 2, "onPacket fires once per accepted packet");
			eq(seen[0].seq, 1, "first packet seq = 1");
			eq(seen[1].seq, 2, "second packet seq = 2");
			eq(seen[0].packet.log_id, "1698844392123-4", "onPacket receives the packet");

			// rejected packets do NOT trigger onPacket
			seen.length = 0;
			await post(srv.port, "not json");
			await post(srv.port, "{}");
			eq(seen.length, 0, "rejected packets do not trigger onPacket");
		} finally {
			srv.close();
		}
	}

	// === telemetryTarget ===================================================
	{
		console.log("\n[telemetryTarget]");
		const srv = await startLogServer({ cwd: tmpCwd() });
		try {
			eq(srv.telemetryTarget, `http://localhost:${srv.port}`, "telemetryTarget is http://localhost:<port>");
		} finally {
			srv.close();
		}
	}

	// === Port resolution precedence =======================================
	{
		console.log("\n[port precedence]");
		// default (no env, no opts, no settings)
		const def = await startLogServer({ cwd: tmpCwd() });
		eq(def.port, DEFAULT_PORT, `no config → DEFAULT_PORT (${DEFAULT_PORT})`);
		def.close();

		// env overrides default (probed-free port → honored exactly, not auto-incremented)
		const envPort = await getFreePort();
		process.env.PI_DEBUGGER_PORT = String(envPort);
		const envSrv = await startLogServer({ cwd: tmpCwd() });
		eq(envSrv.port, envPort, "env PI_DEBUGGER_PORT honored");
		envSrv.close();

		// opts override env
		const optPort = await getFreePort();
		const optSrv = await startLogServer({ port: optPort, cwd: tmpCwd() });
		eq(optSrv.port, optPort, "opts.port overrides env");
		optSrv.close();

		// project-local settings.json honored
		delete process.env.PI_DEBUGGER_PORT;
		const settingsPort = await getFreePort();
		const cwdS = tmpCwd();
		fs.mkdirSync(path.join(cwdS, ".pi"), { recursive: true });
		fs.writeFileSync(path.join(cwdS, ".pi", "settings.json"), JSON.stringify({ debugger: { port: settingsPort } }));
		const setSrv = await startLogServer({ cwd: cwdS });
		eq(setSrv.port, settingsPort, "project settings.json debugger.port honored");
		setSrv.close();
	}

	// === Auto-increment on EADDRINUSE =====================================
	{
		console.log("\n[auto-increment]");
		const base = await getFreePort();
		const a = await startLogServer({ port: base, cwd: tmpCwd() });
		try {
			const b = await startLogServer({ port: base, cwd: tmpCwd() }); // base now in use by a
			try {
				eq(a.port, base, "first server kept its port");
				eq(b.port, base + 1, "second server auto-increments to base+1");
			} finally {
				b.close();
			}
		} finally {
			a.close();
		}
	}

	// === close() idempotent + drops listener (criterion 6) =================
	{
		console.log("\n[close]");
		const srv = await startLogServer({ cwd: tmpCwd() });
		srv.close();
		srv.close(); // idempotent — must not throw

		let refused = false;
		try {
			await post(srv.port, JSON.stringify(validPacket));
		} catch {
			refused = true;
		}
		ok(refused, "POST fails to connect after close()");
	}
} finally {
	// restore env
	if (savedEnv === undefined) delete process.env.PI_DEBUGGER_PORT;
	else process.env.PI_DEBUGGER_PORT = savedEnv;
	// remove the standalone-resolution symlink (unlink, never the target) and any now-empty parents
	try { fs.unlinkSync(link); } catch {}
	try { fs.rmdirSync(linkDir); } catch {}
	try { fs.rmdirSync(path.join(__dirname, "node_modules")); } catch {}
	// clean temp cwds
	for (const d of tmpDirs) {
		try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
	}
}

console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
process.exit(failures === 0 ? 0 : 1);
