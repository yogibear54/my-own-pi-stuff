#!/usr/bin/env node

/**
 * Web Search via DuckDuckGo (primary) or Brave Search (fallback)
 *
 * Usage:
 *   search.js "query"           # Search DuckDuckGo
 *   search.js "query" -n 10     # More results
 *   search.js "query" --brave   # Use Brave Search directly
 */

import { connect } from "../../web-browser/scripts/cdp.js";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEBUG = process.env.DEBUG === "1";
const log = DEBUG ? (...args) => console.error("[debug]", ...args) : () => {};

// Parse arguments
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
  console.log("\nOptions:");
  console.log("  -n <num>   Number of results (default: 5)");
  console.log("  --brave    Use Brave Search directly");
  console.log("\nExamples:");
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
    searchBox: 'input[name="q"], input[type="text"][class*="search"], input[aria-label*="Search"], #searchbox_input, .searchbox_input',
    submitSelector: 'button[type="submit"], button[aria-label*="Search"]',
    resultsSelector: '[data-testid="result"], article[data-testid], .results_links, li[data-layout], [class*="result"]',
    resultExtract: `
      () => {
        const results = [];
        const titleLinks = document.querySelectorAll('h2 a[href^="http"]');
        
        for (const link of titleLinks) {
          const href = link.href;
          if (href.includes('duckduckgo.com') || href.includes('duck.com')) continue;
          if (results.some(r => r.url === href)) continue;
          
          const title = link.textContent.trim();
          const parent = link.closest('li') || link.closest('article') || link.closest('div[class]');
          let snippet = '';
          if (parent) {
            const snippetEl = parent.querySelector('p, span[class*="snippet"], [class*="description"]');
            if (snippetEl) snippet = snippetEl.textContent.trim();
          }
          
          results.push({ title, url: href, snippet });
          if (results.length >= ${numResults}) break;
        }
        
        if (results.length < ${numResults}) {
          const allLinks = document.querySelectorAll('a[href^="http"]');
          for (const link of allLinks) {
            const href = link.href;
            if (href.includes('duckduckgo.com') || href.includes('duck.com')) continue;
            if (results.some(r => r.url === href)) continue;
            
            const title = link.textContent.trim();
            if (title && !title.startsWith('http') && title.length > 5) {
              results.push({ title, url: href, snippet: '' });
              if (results.length >= ${numResults}) break;
            }
          }
        }
        
        return results;
      }
    `
  },
  brave: {
    url: BRAVE_URL,
    resultExtract: `
      () => {
        const results = [];
        const seen = new Set();
        
        const snippets = document.querySelectorAll('div[class*="snippet"]');
        for (const snippet of snippets) {
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
              if (results.length >= ${numResults}) break;
            }
          }
        }
        
        if (results.length < ${numResults}) {
          const links = document.querySelectorAll('a[href^="http"]');
          for (const link of links) {
            if (seen.has(link.href)) continue;
            if (link.href.includes('brave.com')) continue;
            
            const title = link.textContent.trim();
            if (title && title.length > 5 && !title.startsWith('http')) {
              seen.add(link.href);
              results.push({ title, url: link.href, snippet: '' });
              if (results.length >= ${numResults}) break;
            }
          }
        }
        
        return results;
      }
    `
  }
};

// Global timeout
const globalTimeout = setTimeout(() => {
  console.error("✗ Global timeout exceeded (60s)");
  process.exit(1);
}, 60000);

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

async function search(engine, cdp, sessionId, query) {
  const config = SEARCH_ENGINES[engine];
  log(`Using ${engine} search...`);
  
  const searchUrls = {
    duckduckgo: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
    brave: `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`
  };
  
  const searchUrl = searchUrls[engine];
  if (!searchUrl) {
    throw new Error(`Unknown engine: ${engine}`);
  }
  
  log(`Navigating to ${searchUrl}...`);
  await cdp.navigate(sessionId, searchUrl);
  await waitFor(4000);
  
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
  await waitFor(1000);
  
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

try {
  await main();
} catch (e) {
  console.error("✗", e.message);
  process.exit(1);
} finally {
  clearTimeout(globalTimeout);
  setTimeout(() => process.exit(0), 100);
}
