#!/usr/bin/env python3
"""Convert a Markdown file to a styled PDF.

Pipeline: Markdown ──► HTML (with embedded stylesheet) ──► PDF (headless Chrome).

Designed to be invoked as a skill helper; takes its inputs from CLI flags so the
same script works on any Markdown file.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from markdown_it import MarkdownIt

# ---------------------------------------------------------------------------
# Stylesheet
# ---------------------------------------------------------------------------
CSS = r"""
@page {
  size: A4;
  margin: 22mm 20mm 24mm 20mm;
  @top-center {
    content: var(--report-title, "Report");
    font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
    font-size: 9pt;
    color: #6b7280;
  }
  @bottom-center {
    content: counter(page) " / " counter(pages);
    font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
    font-size: 9pt;
    color: #6b7280;
  }
}

@page :first {
  margin: 0;
  @top-center { content: none; }
  @bottom-center { content: none; }
}

* { box-sizing: border-box; }
html { font-size: 11pt; }

body {
  font-family: "Charter", "Iowan Old Style", "Georgia", "Source Serif Pro", serif;
  color: #1f2937;
  line-height: 1.55;
  text-rendering: geometricPrecision;
  -webkit-font-smoothing: antialiased;
  hyphens: auto;
}

/* ---------- Cover ---------- */
.cover {
  page: cover;
  page-break-after: always;
  break-after: page;
  min-height: 297mm;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 32mm 24mm;
  background:
    radial-gradient(circle at 20% 10%, rgba(56, 189, 248, 0.10), transparent 55%),
    radial-gradient(circle at 85% 90%, rgba(99, 102, 241, 0.12), transparent 60%),
    linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  color: #0f172a;
}

.cover .eyebrow {
  font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
  font-size: 10pt;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #0ea5e9;
  font-weight: 600;
}

.cover h1 {
  font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
  font-size: 44pt;
  line-height: 1.05;
  font-weight: 800;
  margin: 18mm 0 6mm 0;
  letter-spacing: -0.02em;
  color: #0b1220;
  padding: 0;
  border: none;
  page-break-before: auto;
  break-before: auto;
}

.cover h1 .accent { color: #0ea5e9; }

.cover .subtitle {
  font-family: "Charter", "Georgia", serif;
  font-size: 14pt;
  font-style: italic;
  color: #475569;
  max-width: 130mm;
  line-height: 1.45;
}

.cover .meta {
  font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
  font-size: 10.5pt;
  color: #475569;
  line-height: 1.7;
}
.cover .meta strong { color: #0f172a; }

.cover .footer-strip {
  font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
  font-size: 9pt;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #64748b;
  border-top: 1px solid #e2e8f0;
  padding-top: 6mm;
  display: flex;
  flex-wrap: wrap;
  gap: 8mm 24mm;
  justify-content: space-between;
}

/* ---------- Body ---------- */
.body { counter-reset: section; }

h1, h2, h3, h4, h5 {
  font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
  color: #0b1220;
  letter-spacing: -0.01em;
  page-break-after: avoid;
  break-after: avoid;
}

h1 {
  font-size: 26pt;
  font-weight: 800;
  margin: 0 0 8mm 0;
  padding-bottom: 4mm;
  border-bottom: 2px solid #0ea5e9;
  page-break-before: always;
  break-before: page;
}
h1:first-of-type { page-break-before: auto; break-before: auto; }

h2 {
  font-size: 17pt;
  font-weight: 700;
  margin: 12mm 0 4mm 0;
  padding-bottom: 2mm;
  border-bottom: 1px solid #e2e8f0;
}

h3 { font-size: 13pt; font-weight: 600; margin: 8mm 0 3mm 0; color: #0369a1; }
h4 { font-size: 11.5pt; font-weight: 600; margin: 6mm 0 2mm 0; color: #334155; }

p { margin: 0 0 3.5mm 0; }
strong { color: #0b1220; font-weight: 700; }
em { color: #334155; }

a {
  color: #0369a1;
  text-decoration: none;
  border-bottom: 1px solid rgba(3, 105, 161, 0.35);
  word-break: break-word;
}
a.ext::after {
  content: " \2197";
  font-size: 0.75em;
  color: #0ea5e9;
  vertical-align: super;
}
a:hover { border-bottom-color: #0369a1; }

hr {
  border: none;
  height: 1px;
  background: linear-gradient(90deg, transparent, #cbd5e1, transparent);
  margin: 10mm 0;
}

ul, ol { margin: 0 0 4mm 0; padding-left: 6mm; }
li { margin-bottom: 1.5mm; }
li::marker { color: #0ea5e9; }

blockquote {
  margin: 5mm 0;
  padding: 4mm 5mm;
  border-left: 3px solid #0ea5e9;
  background: linear-gradient(90deg, #f0f9ff, #ffffff 60%);
  color: #0c4a6e;
  font-style: italic;
  border-radius: 0 4px 4px 0;
  page-break-inside: avoid;
  break-inside: avoid;
}
blockquote p:last-child { margin-bottom: 0; }

code {
  font-family: "JetBrains Mono", "SF Mono", "Menlo", monospace;
  font-size: 0.88em;
  background: #f1f5f9;
  padding: 1px 4px;
  border-radius: 3px;
  color: #be185d;
}
pre {
  background: #0f172a;
  color: #e2e8f0;
  padding: 5mm;
  border-radius: 4px;
  overflow: auto;
  font-size: 9.5pt;
  page-break-inside: avoid;
  break-inside: avoid;
}
pre code { background: transparent; color: inherit; padding: 0; }

table {
  width: 100%;
  border-collapse: collapse;
  margin: 5mm 0 6mm 0;
  font-size: 10pt;
  font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
  page-break-inside: avoid;
  break-inside: avoid;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  border-radius: 4px;
  overflow: hidden;
}
thead { background: #0f172a; color: #f8fafc; }
th {
  text-align: left;
  padding: 3mm 4mm;
  font-weight: 600;
  letter-spacing: 0.02em;
  font-size: 9.5pt;
  text-transform: uppercase;
  border-bottom: 2px solid #0ea5e9;
}
td {
  padding: 3mm 4mm;
  border-bottom: 1px solid #e2e8f0;
  vertical-align: top;
  background: #ffffff;
}
tbody tr:nth-child(even) td { background: #f8fafc; }
tbody tr:last-child td { border-bottom: none; }
td a { font-size: 9.5pt; }
"""


# ---------------------------------------------------------------------------
# Markdown → HTML
# ---------------------------------------------------------------------------
def render_markdown(md_text: str) -> str:
    md = MarkdownIt("commonmark", {"html": True, "linkify": True, "typographer": True}).enable(
        ["table", "strikethrough"]
    )
    html = md.render(md_text)

    # Add class + target=_blank on external links
    def upgrade(match: re.Match) -> str:
        full, href = match.group(0), match.group(1)
        if href.startswith(("http://", "https://")):
            return full.replace(
                ">", ' class="ext" target="_blank" rel="noopener noreferrer">', 1
            )
        return full

    return re.sub(r'<a href="([^"]+)"[^>]*>', upgrade, html)


def build_html(body_html: str, *, title: str | None, eyebrow: str,
               subtitle: str | None, scope: str | None, focus: str | None,
               sources: str | None) -> str:
    has_cover = bool(title)
    cover_html = ""
    if has_cover:
        meta_rows = []
        if scope:
            meta_rows.append(f'<div><strong>Scope.</strong> {scope}</div>')
        if focus:
            meta_rows.append(f'<div><strong>Focus systems.</strong> {focus}</div>')
        if sources:
            meta_rows.append(f'<div><strong>Key sources.</strong> {sources}</div>')

        cover_html = f"""
<section class="cover">
  <div>
    <div class="eyebrow">{eyebrow}</div>
    <h1>{title}</h1>
    {f'<div class="subtitle">{subtitle}</div>' if subtitle else ''}
  </div>
  <div>
    <div class="meta">{"".join(meta_rows)}</div>
    <div class="footer-strip">
      <span>Compiled from primary sources</span>
      <span>All claims referenced</span>
    </div>
  </div>
</section>
"""

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{title or "Report"}</title>
  <style>
    :root {{ --report-title: "{(title or 'Report').replace('"', '\\"')}"; }}
    {CSS}
  </style>
</head>
<body>
{cover_html}
<main class="body">
{body_html}
</main>
</body>
</html>
"""


# ---------------------------------------------------------------------------
# HTML → PDF (Chrome headless)
# ---------------------------------------------------------------------------
def render_pdf(html_path: Path, pdf_path: Path) -> None:
    cmd = [
        "google-chrome",
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--hide-scrollbars",
        "--virtual-time-budget=20000",
        f"--print-to-pdf={pdf_path}",
        f"file://{html_path}",
    ]
    subprocess.run(cmd, check=True)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("-i", "--input", required=True, type=Path, help="Markdown input file")
    p.add_argument("-o", "--output", type=Path,
                   help="PDF output file (default: <input>.pdf)")
    p.add_argument("--title", help="Cover title (omit to skip cover page)")
    p.add_argument("--eyebrow", default="Report",
                   help="Small uppercase label above the cover title")
    p.add_argument("--subtitle", help="Italic subtitle on the cover")
    p.add_argument("--scope", help="One-line 'Scope' metadata on the cover")
    p.add_argument("--focus", help="One-line 'Focus systems' metadata on the cover")
    p.add_argument("--sources", help="One-line 'Key sources' metadata on the cover")
    p.add_argument("--theme", default="default", choices=["default"],
                   help="Reserved for future themes")
    p.add_argument("--keep-html", action="store_true",
                   help="Keep the intermediate HTML file next to the PDF")
    args = p.parse_args()

    if not args.input.exists():
        print(f"error: input file not found: {args.input}", file=sys.stderr)
        return 2

    out_pdf = args.output or args.input.with_suffix(".pdf")
    out_pdf.parent.mkdir(parents=True, exist_ok=True)

    body_html = render_markdown(args.input.read_text())
    full_html = build_html(
        body_html,
        title=args.title,
        eyebrow=args.eyebrow,
        subtitle=args.subtitle,
        scope=args.scope,
        focus=args.focus,
        sources=args.sources,
    )

    if args.keep_html:
        html_path = out_pdf.with_suffix(".html")
    else:
        tmp = tempfile.NamedTemporaryFile(suffix=".html", delete=False)
        tmp.close()
        html_path = Path(tmp.name)
    html_path.write_text(full_html)

    print(f"HTML written: {html_path} ({len(full_html):,} bytes)")
    print(f"Rendering PDF…")
    render_pdf(html_path, out_pdf)

    print(f"\n✓ PDF written: {out_pdf} ({out_pdf.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())