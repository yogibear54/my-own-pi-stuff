---
name: web-search
description: Web search using DuckDuckGo (primary) and Brave Search (fallback) via the web-browser skill. Use for searching documentation, facts, or any web content when API-based search is not available.
---

# Web Search

Interactive web search using the web-browser skill. Searches DuckDuckGo by default, falls back to Brave Search if needed.

**Note:** This skill does NOT use Google for any searches.

---

## ⚠ Run searches ONE AT A TIME — never in parallel

This skill **drives a single shared Chrome tab** through the web-browser skill. Running multiple `search.js` invocations concurrently (e.g. as parallel `bash` tool calls) will cause them to race for the same tab and **return cross-contaminated results** — each invocation may extract whatever the previous one left on the page.

`search.js` enforces this with a file lock: a concurrent invocation will exit immediately with an error rather than produce garbage output.

### When you need to do many queries

**Run them sequentially** in separate tool calls and wait for each result before issuing the next. The recommended pattern is:

```bash
node .../search.js "first query" -n 5
# wait for output
node .../search.js "second query" -n 5
# wait for output
node .../search.js "third query" -n 5
```

If you genuinely need to script a batch sequentially, use the helper:

```bash
node .../scripts/batch-search.js "query one" "query two" "query three" -n 5
```

This runs the queries one at a time against the same shared Chrome and emits a clearly delimited result block per query. Never wrap the per-query `search.js` in a shell parallelizer like `xargs -P` or `parallel`.

---

## Prerequisites

Requires the web-browser skill. Chrome is **auto-started** if not already running — no manual step needed.

If auto-start fails, you can start Chrome manually:

```bash
{baseDir}/../web-browser/scripts/start.js              # Fresh profile
{baseDir}/../web-browser/scripts/start.js --profile    # Copy your profile (cookies, logins)
{baseDir}/../web-browser/scripts/start.js --headless   # No GUI needed
```

## Search

```bash
{baseDir}/scripts/search.js "query"             # Basic search (5 results)
{baseDir}/scripts/search.js "query" -n 10       # More results
{baseDir}/scripts/search.js "query" --brave     # Use Brave Search directly
```

> Reminder: one query at a time, per the warning above.

### Options

- `-n <num>` - Number of results (default: 5)
- `--brave` - Use Brave Search instead of DuckDuckGo

## Output Format

```
--- Result 1 ---
Title: Page Title
URL: https://example.com/page
Snippet: Description from search results

--- Result 2 ---
...
```

## How It Works

1. Acquires a single-instance file lock (refuses to run if another search is in flight)
2. Checks if Chrome is running; auto-starts it if not
3. Attaches to a single shared tab
4. Navigates to DuckDuckGo (search.brave.com if `--brave` flag used)
5. Waits for the results page to render (network-idle check, not just a fixed delay)
6. Extracts results from the page
7. Falls back to Brave Search if DuckDuckGo fails
8. Releases the file lock

## When to Use

- Searching for documentation or API references
- Looking up facts or current information
- When API-based search (brave-search skill) is not available
- When you need to browse search results interactively
