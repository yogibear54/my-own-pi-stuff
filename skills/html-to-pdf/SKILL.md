---
name: html-to-pdf
description: Renders one or more HTML files to PDF using Chrome's headless --print-to-pdf mode. Reliable and standalone — no pre-running Chrome or CDP connection required, and a throwaway user-data-dir means it never collides with the user's running browser. Use for ATS resumes, cover letters, or any local HTML→PDF conversion. By default it forces A4 with 10mm margins on every page; headers/footers are omitted.
license: MIT
---

# HTML to PDF

Render HTML files to PDF via Chrome's headless `--print-to-pdf`. This is the
**consistent, standalone** method for HTML→PDF in this environment.

## Why this method

Other approaches (e.g. a CDP/`Page.printToPDF` client on port `:9222`) require a
Chrome instance to already be running with `--remote-debugging-port=9222`. If it
isn't, rendering fails with a connection error.

This skill spawns its **own** short-lived headless Chrome per run, pointed at a
throwaway `--user-data-dir`. Consequences:

- **No setup** — nothing needs to be running beforehand.
- **No collisions** — it never touches the user's running Chrome (different
  profile dir), so it works even while the user has Chrome open.
- **No port** — nothing listens on `:9222`; nothing to clean up.

## Requirements

- `google-chrome`, `google-chrome-stable`, `chromium-browser`, or `chromium` on
  `PATH`. The script auto-detects the first one found.

## Usage

```bash
# one file — PDF written next to it (same basename, .pdf)
./scripts/render-pdf.sh resume.html

# multiple files
./scripts/render-pdf.sh resume.html cover-letter.html

# explicit output path (single file only)
./scripts/render-pdf.sh --out /tmp/out.pdf resume.html

# keep Chrome's default header/footer (date, URL, page numbers)
./scripts/render-pdf.sh --header-footer resume.html

# use the HTML's own @page CSS instead of the forced A4/10mm margins
./scripts/render-pdf.sh --no-margins resume.html
```

The script is invoked from the skill directory, e.g.:

```bash
bash ~/.pi/agent/skills/html-to-pdf/scripts/render-pdf.sh <file.html>
```

## Defaults

| Behavior | Default | Override |
|---|---|---|
| Output path | `<input>.pdf` (same dir, same basename) | `--out <path>` |
| Header/footer | omitted (`--no-pdf-header-footer`) | `--header-footer` |
| Paper size / margins | A4, 10mm page margins, body margin 0 (injected) | `--no-margins` (use the HTML's CSS) |
| Chrome profile | throwaway temp dir, removed after each file | — |
| Per-file timeout | 60s | edit `CHROME_TIMEOUT` in the script |

## How page size and margins are controlled

By default, the script forces a consistent page setup on **every** render,
regardless of the HTML's own CSS:

```css
@page { size: A4 !important; margin: 10mm !important; }
body { margin: 0 !important; }
```

This guarantees a 10mm margin on all four edges of every page — including the
top of page 2+ and the bottom of page 1, which a `body` margin alone cannot do
(see below). It works by copying the HTML to a temp file and injecting this
`<style>` right after the opening `<head>` tag; **your source file is never
modified**.

To use the HTML's own `@page`/`body` CSS instead, pass `--no-margins`:

```bash
./scripts/render-pdf.sh --no-margins resume.html
```

Chrome's `--print-to-pdf` has no `--paper-size` flag; it honors `@page` CSS, so
under `--no-margins` a Letter-vs-A4 problem is fixed in the HTML, not via a flag.

### Why margins must live on `@page`, not `body` (matters under `--no-margins`)

A `body` margin applies **once**, at the start of the body — so on a multi-page
document page 2+ content is glued to the top edge and every page's bottom runs
flush. `@page` margins repeat on **every** page:

```css
/* correct — every page gets the margin */
@page { size: A4; margin: 10mm; }

/* wrong — page 2+ loses its top margin, every page loses its bottom */
@page { size: A4; margin: 0; }
@media print { body { margin: 16mm; } }
```

## Output

For each input the script prints one line:

```
→ resume.html
  ✓ /abs/path/resume.pdf  (23811 bytes)
```

followed by a summary. Exit code is `0` only if every file succeeded; on failure
the offending file's Chrome stderr is shown for debugging.

## Files

- `scripts/render-pdf.sh` — the renderer (bash, no dependencies).
