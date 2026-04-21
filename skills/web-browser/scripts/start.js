#!/usr/bin/env node

import { spawn, execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const useProfile = args.includes("--profile");
const useHeadless = args.includes("--headless");

if (args.find(a => a.startsWith("-") && a !== "--profile" && a !== "--headless")) {
  console.log("Usage: start.js [--profile] [--headless]");
  console.log("\nOptions:");
  console.log("  --profile   Copy your default Chrome profile (cookies, logins)");
  console.log("  --headless  Run Chrome in headless mode (no GUI needed)");
  process.exit(1);
}

const PORT = 9222;
const DEBUG_LOG = join(tmpdir(), "chrome-debug.log");

async function isDebugEndpointUp() {
  try {
    const response = await fetch(`http://localhost:${PORT}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

function log(msg) {
  console.log(msg);
}

function killStaleChromeOnPort() {
  try {
    const result = execSync(
      `lsof -i TCP:${PORT} -t 2>/dev/null || true`,
      { encoding: "utf-8" },
    ).trim();
    if (result) {
      const pids = result.split("\n").filter(Boolean);
      log(`  Found stale process(es) on port ${PORT}: ${pids.join(", ")}`);
      for (const pid of pids) {
        try { process.kill(parseInt(pid), "SIGKILL"); } catch {}
      }
      execSync("sleep 1", { stdio: "ignore" });
      log("  Killed stale processes.");
    }
  } catch {}
}

function removeSingletonFiles(profileDir) {
  // Remove Chrome singleton lock/cookie/socket that prevent a new instance.
  // These are created by Chrome on startup and stale ones from a previous
  // run (or copied via --profile) will block the new instance.
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    const f = join(profileDir, name);
    try { rmSync(f, { force: true }); } catch {}
  }
}

// ── Main ──

if (await isDebugEndpointUp()) {
  log("✓ Chrome already running on :" + PORT + " (reusing existing instance)");
  process.exit(0);
}

log("Starting Chrome...");

// Kill any zombie Chrome that's holding our port but not responding.
killStaleChromeOnPort();

// ── Choose profile directory ──
let profileDir;

if (useProfile) {
  // Copy user's real profile. We MUST remove singleton files after rsync
  // because they point to the running Chrome's PID and will block us.
  profileDir = `${process.env["HOME"]}/.cache/scraping`;
  execSync("mkdir -p " + profileDir, { stdio: "ignore" });
  log("  Copying your Chrome profile (this may take a moment)...");
  try {
    execSync(
      `rsync -a --delete "${process.env["HOME"]}/.config/google-chrome/" "${profileDir}/"`,
      { stdio: "pipe" },
    );
  } catch {
    log("  ⚠ Profile copy failed, continuing with fresh profile.");
  }
  removeSingletonFiles(profileDir);
} else {
  // Use a temp directory every time. This avoids singleton-lock conflicts
  // with the user's running Chrome (their profile's SingletonLock points
  // to a different PID and will block us on ~/.cache/scraping).
  profileDir = mkdtempSync(join(tmpdir(), "chrome-cdp-"));
}

// ── Launch Chrome ──
const chromeArgs = [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profileDir}`,
  "--profile-directory=Default",
  "--disable-search-engine-choice-screen",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-features=ProfilePicker",
];
if (useHeadless) {
  chromeArgs.push("--headless=new");
}

const child = spawn("/usr/bin/google-chrome", chromeArgs, {
  detached: true,
  stdio: ["ignore", "ignore", "pipe"],
});
child.unref();

// Capture stderr for diagnostics.
const { createWriteStream } = await import("node:fs");
const logStream = createWriteStream(DEBUG_LOG, { flags: "w" });
logStream.write(`Chrome startup log: ${new Date().toISOString()}\n`);
logStream.write(`Command: /usr/bin/google-chrome ${chromeArgs.join(" ")}\n`);
logStream.write(`Profile dir: ${profileDir}\n\n`);
if (child.stderr) {
  child.stderr.on("data", (chunk) => logStream.write(chunk));
}

// ── Wait for Chrome to be ready ──
let connected = false;
for (let i = 0; i < 40; i++) {
  if (await isDebugEndpointUp()) {
    connected = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 500));
}

if (!connected) {
  console.error("");
  console.error("✗ Chrome did not start on :" + PORT + " after 20 seconds.");
  console.error("");
  console.error("  Possible causes:");
  console.error("    • Another Chrome instance is locking the profile directory");
  console.error("    • Display server not available (try --headless)");
  console.error("    • Chrome crashed on startup");
  console.error("");
  console.error("  Chrome stderr log: " + DEBUG_LOG);
  if (existsSync(DEBUG_LOG)) {
    try {
      const logContent = readFileSync(DEBUG_LOG, "utf-8");
      const lines = logContent.split("\n").filter(Boolean).slice(-8);
      if (lines.length > 2) {  // skip the header lines we wrote
        console.error("");
        console.error("  Last log lines:");
        for (const line of lines) {
          console.error("    " + line);
        }
      }
    } catch {}
  }
  console.error("");
  console.error("  Try:");
  console.error("    pkill -f google-chrome; sleep 2; ./scripts/start.js");
  console.error("    ./scripts/start.js --headless");
  process.exit(1);
}

// Start background watcher for logs/network (detached)
const watcherPath = join(__dirname, "watch.js");
spawn(process.execPath, [watcherPath], { detached: true, stdio: "ignore" }).unref();

log("✓ Chrome started on :" + PORT + (useProfile ? " with your profile" : "") + (useHeadless ? " (headless)" : ""));
