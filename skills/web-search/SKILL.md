---
name: web-search
description: Web search using DuckDuckGo (primary) and Brave Search (fallback) via the web-browser skill. Use for searching documentation, facts, or any web content when API-based search is not available.
---

# Web Search

Interactive web search using the web-browser skill. Searches DuckDuckGo by default, falls back to Brave Search if needed.

**Note:** This skill does NOT use Google for any searches.

## Prerequisites

Requires the web-browser skill. Start Chrome first:

```bash
./scripts/start.js              # Fresh profile
./scripts/start.js --profile    # Copy your profile (cookies, logins)
```

## Search

```bash
{baseDir}/scripts/search.js "query"# Basic search (5 results)
{baseDir}/scripts/search.js "query" -n 10   # More results
{baseDir}/scripts/search.js "query" --brave # Use Brave Search directly
```

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

1. Navigates to DuckDuckGo (search.brave.com if `--brave` flag used)
2. Enters search query in the search box
3. Extracts results from the page
4. Falls back to Brave Search if DuckDuckGo fails

## When to Use

- Searching for documentation or API references
- Looking up facts or current information
- When API-based search (brave-search skill) is not available
- When you need to browse search results interactively