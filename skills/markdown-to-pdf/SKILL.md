---
name: markdown-to-pdf
description: Converts a Markdown file to a professionally styled PDF with cover page, hierarchical headings, tables, links, blockquote callouts, and proper page breaks. Use when the user wants a polished PDF version of a markdown document (research reports, documentation, READMEs, briefs). Output is rendered via headless Chrome from a styled HTML intermediate.
---

# Markdown → PDF

Produces a publication-quality PDF from a Markdown source. The conversion pipeline is:

```
Markdown ──► HTML (with stylesheet) ──► PDF (via headless Chrome)
```

## Setup

No installation required. The skill depends on tools that are normally preinstalled on the host:

- `python3` with the `markdown-it-py` package (`pip install markdown-it-py` if missing)
- `google-chrome` (or any Chromium-based browser) on `PATH`

Verify with:

```bash
python3 -c "import markdown_it; print('ok')" && which google-chrome
```

## Usage

The entry point is `scripts/md_to_pdf.py`. It accepts CLI arguments with sensible defaults.

```bash
python3 scripts/md_to_pdf.py \
    --input path/to/report.md \
    --output path/to/report.pdf \
    --title "Report Title" \
    --eyebrow "Research Report · 2026" \
    --subtitle "A short italic blurb shown on the cover." \
    --scope "Scope keywords · separated · by dots" \
    --focus "System A, System B, System C" \
    --sources "Source 1, Source 2, Source 3"
```

### Arguments

| Flag | Default | Description |
|------|---------|-------------|
| `--input`, `-i` | *(required)* | Source Markdown file |
| `--output`, `-o` | `<input>.pdf` | Output PDF path |
| `--title` | *(required)* | Main title on the cover page |
| `--eyebrow` | `"Report"` | Small uppercase label above the title |
| `--subtitle` | *none* | Italic subtitle paragraph below the title |
| `--scope` | *none* | One-line metadata shown on the cover |
| `--focus` | *none* | One-line metadata shown on the cover |
| `--sources` | *none* | One-line metadata shown on the cover |
| `--theme` | `default` | Reserved for future themes; only `default` exists today |

### Minimal example

```bash
python3 scripts/md_to_pdf.py -i README.md -o README.pdf --title "Project README"
```

The cover page is skipped if `--title` is not provided, and the document begins directly with the rendered Markdown.

## What the script does

1. **Parse Markdown** with `markdown-it-py` (CommonMark + tables + strikethrough, autolinks enabled).
2. **Rewrite external links** so they open in a new tab and get an arrow indicator.
3. **Wrap in HTML** with an embedded CSS stylesheet that controls:
   - **Typography** — Charter/Iowan/Georgia serif body, Inter/Helvetica/Arial sans-serif headings
   - **Color palette** — slate gray body, sky-blue (`#0ea5e9`) accents
   - **Cover page** — soft radial gradients, large display title, metadata strip, footer line
   - **Headings** — distinct sizes/colors per level with blue underline borders on h1/h2
   - **Tables** — navy header row, zebra-striped body rows, soft drop shadow
   - **Lists** — colored bullet markers in the accent color
   - **Blockquotes** — soft blue callout box with left border and gradient fill
   - **Code** — monospace inline and dark code blocks
   - **Hyperlinks** — blue with underline, ↗ arrow on external links
   - **Page layout** — A4, 22/20/24/20mm margins, header (title) and footer (page n / N)
   - **Page breaks** — every h1 starts a new page; tables and callouts avoid mid-page splits
4. **Render HTML → PDF** with headless Chrome:

   ```
   google-chrome --headless=new --no-sandbox --hide-scrollbars \
       --print-to-pdf=<output> file://<html>
   ```

## Customizing the look

Edit the `CSS` string at the top of `scripts/md_to_pdf.py`. The variables to tweak first:

- `@page` margin block — overall page padding
- `body` font-family / font-size — body typography
- `h1` border-bottom + `h2` border-bottom — accent rules under headings
- `--accent` (the literal hex `#0ea5e9`) — recolor links, table headers, bullets, blockquotes
- `.cover` background gradients — cover page atmosphere

Because the stylesheet is embedded, no external CSS file is needed.

## Output characteristics

- Page size: A4 (210 × 297 mm)
- Typical size: ~30–50 KB per page of rendered text
- Hyperlinks are clickable in PDF viewers that support them (most desktop viewers do)
- External links open in a new browser tab when clicked in the PDF

## Limitations

- Fonts rely on the OS — the CSS specifies a stack (Charter → Iowan → Georgia → serif). On hosts without Charter/Iowan, Georgia is used. No webfonts are downloaded.
- No syntax highlighting inside code blocks (rendered as plain monospace).
- Images are not resized; they render at their native size.
- No multi-column layout, no figures with captions, no footnotes.
- No support for LaTeX math — `$...$` is rendered as literal text.

For features beyond these, render to LaTeX (e.g. with Pandoc + a LaTeX engine) instead.