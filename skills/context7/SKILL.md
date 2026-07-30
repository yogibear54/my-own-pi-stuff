---
name: context7
description: Fetch up-to-date, version-specific documentation for any library, framework, or tool from Context7 (context7.com) into context. Use whenever accurate API references, installation steps, or usage examples are needed instead of relying on training-data knowledge that may be outdated — e.g. "how do I bootstrap Laravel 13", "current options for X", "the correct signature for Y in version Z".
---

# Context7

Pull current, version-specific documentation from [context7.com](https://context7.com) on demand. Context7 indexes official docs and source, then serves focused snippets. This skill wraps its HTTP API (`curl` + `jq`).

**Why:** model training data lags. For current major versions — or anything released after the training cutoff — fetching the real docs avoids hallucinated APIs, renamed methods, and wrong signatures.

## Setup

Requires `curl` and `jq`. Make the helper executable once:

```bash
chmod +x {baseDir}/scripts/docs.sh
```

## Workflow — two steps

### 1. Find the library

```bash
{baseDir}/scripts/docs.sh search laravel
```

Lists candidate libraries with their `id`, `title`, `branch`, and available `versions` (these `__branch__X.x` entries are the usable tags). Pick the official / verified one.

### 2. Fetch docs for a topic + version

```bash
{baseDir}/scripts/docs.sh get /laravel/docs 13.x --topic routing --tokens 4000
```

The script maps a bare version (`13.x`) to the internal `__branch__` tag automatically. Output is ready-to-read Markdown with per-snippet source links.

## Critical usage rules

- **Always pass `--tokens` and `--topic`.** Full libraries are often 100k–700k+ tokens — far beyond any context window. Scope every fetch. Sensible budgets: narrow topic 2k–4k; broad survey 6k–8k.
- **One topic per fetch.** If you need several areas, run multiple `get` calls (e.g. routing, then validation).
- **Match the version to the codebase.** Legacy code on 6.x → fetch `6.x`, not latest. Always confirm the major version in `composer.json` / `package.json` first.
- **`search` first when unsure.** Don't guess a library id or version tag — resolve it, then `get`.
- **Verify against reality.** Context7 is authoritative for API shape, but still confirm generated code runs. Snippets include source links for traceability.

## Options

```
search <query>                                  # list matching libraries (id, branch, versions)
get <library-id> <version> [options]            # fetch docs
  --topic "<text>"    focus area (e.g. "routing", "validation rules")
  --tokens <n>        max tokens returned (default 5000)
```

## Examples

```bash
# Discover what's indexed for a framework
{baseDir}/scripts/docs.sh search react

# Laravel 13 routing
{baseDir}/scripts/docs.sh get /laravel/docs 13.x --topic routing --tokens 4000

# Laravel 13 install / bootstrap
{baseDir}/scripts/docs.sh get /laravel/docs 13.x --topic "installation create-project" --tokens 5000

# Match a legacy codebase
{baseDir}/scripts/docs.sh get /laravel/docs 6.x --topic "eloquent relationships" --tokens 4000
```

## Troubleshooting

- **`could not fetch`** → the id or version tag differs from your assumption. Re-run `search` and use the exact `id` plus a `version` from its `versions` list.
- **Empty / irrelevant output** → topic too broad or too narrow. Rephrase (e.g. `"route model binding"` vs just `"routes"`), or raise `--tokens`.
- **Raw API** is documented at `https://context7.com/api/v1` — endpoints: `/search?query=`, and `/{libraryId}/{tag}?type=txt&topic=&tokens=`.
