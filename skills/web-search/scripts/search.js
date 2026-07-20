#!/usr/bin/env node

/**
 * Web Search via DuckDuckGo (primary) or Brave Search (fallback)
 *
 * Usage:
 *   search.js "query"           # Search DuckDuckGo
 *   search.js "query" -n 10     # More results
 *   search.js "query" --brave   # Use Brave Search directly
 *
 * SINGLE-INSTANCE ONLY
 * --------------------
 * This script drives a single shared Chrome tab through the web-browser skill.
 * Concurrent invocations will race for the same tab and produce
 * cross-contaminated results. A file lock enforces single-instance execution:
 * if another search is already in flight, this process exits with a clear
 * error. Run queries sequentially in separate tool calls, or use
 * batch-search.js for scripted sequential batches.
 */

import { connect } from "../../web-browser/scripts/cdp.js";
import { execSync } from "node:child_process";
import {
  openSync,
  closeSync,
  unlinkSync,
  readFileSync,
  writeSync,
  constants,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEBUG = process.env.DEBUG === "1";
const log = DEBUG ? (...args) => console.error("[debug]", ...args) : () => {};

// ---------------------------------------------------------------------------
// Single-instance lock (file-based, atomic via O_EXCL)
// ---------------------------------------------------------------------------
const LOCK_PATH = join(__dirname, ".search.lock");
let lockFd = null;

function acquireLock() {
  try {
    lockFd = openSync(LOCK_PATH, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
    const meta = JSON.stringify({
      pid: process.pid,
      host: hostname(),
      startedAt: new Date().toISOString(),
    });
    writeSync(lockFd, meta + "\n");
  } catch (err) {
    if (err && err.code === "EEXIST") {
      let existing = "";
      try {
        existing = readFileSync(LOCK_PATH, "utf8").trim();
      } catch {}
      console.error("✗ Another search.js invocation is already running.");
      console.error("  This skill drives a single shared Chrome tab — concurrent searches");
      console.error("  cross-contaminate results. Run queries ONE AT A TIME.");
      if (existing) {
        console.error(`  Existing lock holder: ${existing}`);
      }
      console.error("  If you're sure no other search is running, remove:");
      console.error(`    ${LOCK_PATH}`);
      process.exit(2);
    }
    throw err;
  }
}

function releaseLock() {
  try {
    if (lockFd !== null) closeSync(lockFd);
    unlinkSync(LOCK_PATH);
  } catch {
    // best-effort
  }
  lockFd = null;
}

// Acquire lock immediately. All subsequent exits (early returns, throws,
// uncaught exceptions) must release the lock — register cleanup hooks first.
process.on("exit", releaseLock);
process.on("SIGINT", () => { releaseLock(); process.exit(130); });
process.on("SIGTERM", () => { releaseLock(); process.exit(143); });
process.on("uncaughtException", (err) => {
  console.error("✗ Uncaught exception:", err && err.stack ? err.stack : err);
  releaseLock();
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
let query = "";
let numResults = 5;
let useBrave = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "-n" && args[i + 1]) {
    numResults = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === "--brave") {
    useBrave = true;
  } else if (!args[i].startsWith("-") && !query) {
    query = args[i];
  }
}

if (!query) {
  console.log('Usage: search.js "query" [-n <num>] [--brave]');
  console.log("");
  console.log("WARNING: this skill is SINGLE-INSTANCE. Run queries one at a time.");
  console.log("For batched sequential queries, use batch-search.js.");
  console.log("");
  console.log("Options:");
  console.log("  -n <num>   Number of results (default: 5)");
  console.log("  --brave    Use Brave Search instead of DuckDuckGo");
  console.log("");
  console.log("Examples:");
  console.log('  search.js "node.js tutorials"');
  console.log('  search.js "rust documentation" -n 10');
  console.log('  search.js "api reference" --brave');
  process.exit(1);
}

const DUCKDUCKGO_URL = "https://duckduckgo.com/";
const BRAVE_URL = "https://search.brave.com/";

const SEARCH_ENGINES = {
  duckduckgo: {
    url: DUCKDUCKGO_URL,
    // The DuckDuckGo result extractor below targets the actual results
    // region (data-testid="results") and grabs each result's h2 anchor plus
    // the snippet within the same article. This is the canonical layout for
    // DDG's modern HTML results and avoids the previous behaviour of
    // returning whatever anchors were left in the DOM from a prior query.
    resultExtract: `
      () => {
        const results = [];
        const NUM = ${numResults};

        // Primary: each result is an <article data-testid="result"> with an
        // <h2><a href>...</a></h2> and a snippet node.
        const articles = document.querySelectorAll('article[data-testid="result"]');
        for (const article of articles) {
          if (results.length >= NUM) break;
          const link = article.querySelector('h2 a[href^="http"]');
          if (!link) continue;
          const href = link.href;
          if (href.includes('duckduckgo.com') || href.includes('duck.com')) continue;
          if (results.some(r => r.url === href)) continue;

          const title = link.textContent.trim();

          // DDG renders the snippet in a span with data-testid or in a
          // descendant that is NOT the title's own h2. We probe a few
          // candidate selectors and fall back to the article's plain text.
          let snippet = '';
          const candidates = [
            '[data-result="snippet"]',
            'span[data-testid="snippet"]',
            'div[data-testid="snippet-content"]',
            'div.snippet',
            'span.snippet',
          ];
          for (const sel of candidates) {
            const el = article.querySelector(sel);
            if (el) { snippet = el.textContent.trim(); break; }
          }
          if (!snippet) {
            // Use the first <p> inside the article as a last resort.
            const p = article.querySelector('p');
            if (p) snippet = p.textContent.trim();
          }

          results.push({ title, url: href, snippet });
        }

        // Secondary fallback: if the data-testid layout isn't present (e.g.
        // DDG served an alternate layout), scan h2 anchors scoped to the main
        // results column only.
        if (results.length < NUM) {
          const scope = document.querySelector('[data-testid="results"]')
                      || document.querySelector('ol.react-results--main')
                      || document.body;
          const titleLinks = scope.querySelectorAll('h2 a[href^="http"]');
          for (const link of titleLinks) {
            if (results.length >= NUM) break;
            const href = link.href;
            if (href.includes('duckduckgo.com') || href.includes('duck.com')) continue;
            if (results.some(r => r.url === href)) continue;
            const title = link.textContent.trim();
            if (!title || title.length < 4) continue;
            results.push({ title, url: href, snippet: '' });
          }
        }

        return results;
      }
    `,
  },
  brave: {
    url: BRAVE_URL,
    resultExtract: `
      () => {
        const results = [];
        const seen = new Set();
        const NUM = ${numResults};

        const snippets = document.querySelectorAll('div[class*="snippet"]');
        for (const snippet of snippets) {
          if (results.length >= NUM) break;
          const link = snippet.querySelector('a[href^="http"]');
          if (link && !seen.has(link.href)) {
            seen.add(link.href);
            const title = link.textContent.trim();
            const domainEl = snippet.querySelector('[class*="atribution"], [class*="domain"]');
            const domain = domainEl ? domainEl.textContent.trim() : '';
            const descEl = snippet.querySelector('div[class*="description"], p, span');
            const snippet2 = descEl ? descEl.textContent.trim() : domain;

            if (title && link.href) {
              results.push({ title, url: link.href, snippet: snippet2 });
            }
          }
        }

        if (results.length < NUM) {
          const links = document.querySelectorAll('a[href^="http"]');
          for (const link of links) {
            if (results.length >= NUM) break;
            if (seen.has(link.href)) continue;
            if (link.href.includes('brave.com')) continue;

            const title = link.textContent.trim();
            if (title && title.length > 5 && !title.startsWith('http')) {
              seen.add(link.href);
              results.push({ title, url: link.href, snippet: '' });
            }
          }
        }

        return results;
      }
    `,
  },
};

// Global timeout
const globalTimeout = setTimeout(() => {
  console.error("✗ Global timeout exceeded (90s)");
  process.exit(1);
}, 90000);

async function waitFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Try to auto-start Chrome via start.js if the debug port isn't responding.
 */
async function ensureChromeRunning() {
  try {
    const resp = await fetch("http://localhost:9222/json/version", { signal: AbortSignal.timeout(2000) });
    if (resp.ok) return; // already running
  } catch {}

  log("Chrome not running, auto-starting...");
  // __dirname = ~/.pi/agent/skills/web-search/scripts/
  // need     = ~/.pi/agent/skills/web-browser/scripts/start.js
  const startScript = join(__dirname, "..", "..", "web-browser", "scripts", "start.js");

  try {
    execSync(`node "${startScript}"`, {
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    // start.js may have printed its own error. Fall through — we'll try to connect
    // and if that fails too, we'll give a combined error below.
    log("Auto-start output:", e.stdout?.toString(), e.stderr?.toString());
  }
}

// Ensure a tab exists, creating one if needed
async function ensureTab(cdp, initialUrl = null) {
  const pages = await cdp.getPages();
  let page = pages.at(-1);

  if (!page) {
    log("No tab found, creating one...");
    const { targetId } = await cdp.send("Target.createTarget", {
      url: initialUrl || "about:blank",
    });
    await waitFor(1500);
    const newPages = await cdp.getPages();
    page = newPages.find(p => p.targetId === targetId) || newPages.at(-1);
  }

  return page;
}

/**
 * Wait for the page to reach network-idle after navigation. Subscribes to
 * Page.loadEventFired + Network.responseReceived via the CDP emitter and
 * resolves when no network activity has occurred for `quietMs` and the load
 * event has fired (or the overall deadline elapses).
 *
 * Returns true if the page reached idle within the deadline, false on
 * timeout. Either way, the caller proceeds — false just means the extractor
 * will run on a possibly-partial DOM, which the caller should handle.
 */
function waitForNetworkIdle(cdp, sessionId, { timeoutMs = 15000, quietMs = 1200 } = {}) {
  return new Promise((resolve) => {
    let loadFired = false;
    let lastActivity = Date.now();
    const start = Date.now();
    let settled = false;

    const onLoad = () => { loadFired = true; lastActivity = Date.now(); };
    const onResponse = () => { lastActivity = Date.now(); };
    const onRequest = () => { lastActivity = Date.now(); };

    cdp.on("Page.loadEventFired", onLoad);
    cdp.on("Network.responseReceived", onResponse);
    cdp.on("Network.requestWillBeSent", onRequest);

    const cleanup = () => {
      if (settled) return;
      settled = true;
      cdp.off("Page.loadEventFired", onLoad);
      cdp.off("Network.responseReceived", onResponse);
      cdp.off("Network.requestWillBeSent", onRequest);
    };

    const tick = () => {
      if (settled) return;
      const now = Date.now();
      const quiet = now - lastActivity;
      if (loadFired && quiet >= quietMs) {
        cleanup();
        resolve(true);
        return;
      }
      if (now - start >= timeoutMs) {
        cleanup();
        resolve(false);
        return;
      }
      setTimeout(tick, 200);
    };

    setTimeout(tick, 200);
  });
}

async function search(engine, cdp, sessionId, query) {
  const config = SEARCH_ENGINES[engine];
  log(`Using ${engine} search...`);

  const searchUrls = {
    duckduckgo: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
    brave: `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`,
  };

  const searchUrl = searchUrls[engine];
  if (!searchUrl) {
    throw new Error(`Unknown engine: ${engine}`);
  }

  // Ensure the page and network domains are enabled so we can observe
  // load + network events for an accurate network-idle wait. enable() is
  // idempotent per CDP session.
  try {
    await cdp.send("Page.enable", {}, sessionId, 5000);
    await cdp.send("Network.enable", {}, sessionId, 5000);
  } catch (e) {
    log("Page/Network.enable failed (non-fatal):", e.message);
  }

  log(`Navigating to ${searchUrl}...`);
  await cdp.navigate(sessionId, searchUrl);

  // Wait for network-idle instead of a fixed sleep.
  const idle = await waitForNetworkIdle(cdp, sessionId, { timeoutMs: 15000, quietMs: 1200 });
  log(`Network idle reached: ${idle}`);

  // Dismiss cookie dialogs
  log("Dismissing cookie dialogs...");
  try {
    await cdp.evaluate(sessionId, `
      (async () => {
        const buttons = document.querySelectorAll('button, [role="button"], input[type="submit"]');
        const acceptPatterns = ['accept', 'agree', 'allow', 'got it', 'continue', 'i agree'];
        for (const btn of buttons) {
          const text = (btn.textContent || btn.value || '').toLowerCase();
          if (acceptPatterns.some(p => text.includes(p))) {
            try { btn.click(); await new Promise(r => setTimeout(r, 500)); } catch {}
          }
        }
      })();
    `, 5000);
  } catch (e) {
    log("Cookie dismissal failed (non-fatal):", e.message);
  }
  // Brief settle after cookie dismissal in case it triggers UI changes.
  await waitFor(500);

  // Sanity check: confirm the current page is the search results page for
  // THIS query. If it's still showing a stale query (can happen if a prior
  // search left the tab on its results page and the new navigation was
  // blocked by a JS-driven SPA router), bail out so the caller can retry
  // the other engine.
  try {
    const current = await cdp.evaluate(sessionId, `(() => {
      const u = new URL(location.href);
      const q = u.searchParams.get('q');
      return { href: location.href, queryParam: q, title: document.title };
    })()`, 5000);
    log(`Post-nav URL: ${current && current.href} | q="${current && current.queryParam}"`);
    if (current && current.queryParam && current.queryParam !== query) {
      throw new Error(`Navigation did not load the new query (page shows q="${current.queryParam}", expected q="${query}"). This indicates a stale tab.`);
    }
  } catch (e) {
    // If it's our own sanity-check error, rethrow so the engine fails over.
    if (/Navigation did not load/.test(e.message)) throw e;
    log("URL sanity check failed (non-fatal):", e.message);
  }

  // Extract results
  log("Extracting results...");
  const results = await cdp.evaluate(sessionId, `(${config.resultExtract})()`);
  return results;
}

async function main() {
  // Auto-start Chrome if needed
  await ensureChromeRunning();

  log("connecting...");
  let cdp;
  try {
    cdp = await connect(8000);
  } catch (e) {
    console.error("✗ Failed to connect to Chrome:", e.message);
    console.error("");
    console.error("  Auto-start failed. Try manually:");
    console.error("    cd ~/.pi/agent/skills/web-browser && ./scripts/start.js");
    console.error("    cd ~/.pi/agent/skills/web-browser && ./scripts/start.js --headless  # no GUI");
    process.exit(1);
  }

  log("ensuring tab exists...");
  const page = await ensureTab(cdp);

  if (!page) {
    console.error("✗ Could not create or find a tab");
    process.exit(1);
  }

  log("attaching to page...");
  const sessionId = await cdp.attachToPage(page.targetId);

  let results = [];
  const engines = useBrave ? ["brave"] : ["duckduckgo", "brave"];
  let lastError = null;

  for (const engine of engines) {
    try {
      results = await search(engine, cdp, sessionId, query);
      if (results && results.length > 0) {
        log(`Got ${results.length} results from ${engine}`);
        break;
      }
    } catch (e) {
      log(`${engine} search failed:`, e.message);
      lastError = e;

      if (!useBrave && engine === "duckduckgo" && engines.indexOf(engine) < engines.length - 1) {
        console.error(`⚠ DuckDuckGo failed, falling back to Brave Search...`);
      }
    }
  }

  cdp.close();

  if (!results || results.length === 0) {
    if (lastError) {
      console.error("✗ Search failed:", lastError.message);
    } else {
      console.error("✗ No results found");
    }
    process.exit(1);
  }

  // Output results
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (i > 0) console.log("");
    console.log(`--- Result ${i + 1} ---`);
    console.log(`Title: ${r.title}`);
    console.log(`URL: ${r.url}`);
    if (r.snippet) console.log(`Snippet: ${r.snippet}`);
  }
}

// Acquire the single-instance lock right before doing real work. We do it
// here (not at the top of the module) so that the file lock is only held
// while a Chrome interaction is happening, not while the script is just
// being parsed. Module-parse-time errors will therefore not leave a stale
// lock behind.
acquireLock();

try {
  await main();
} catch (e) {
  console.error("✗", e.message);
  process.exit(1);
} finally {
  clearTimeout(globalTimeout);
  releaseLock();
  setTimeout(() => process.exit(0), 100);
}
