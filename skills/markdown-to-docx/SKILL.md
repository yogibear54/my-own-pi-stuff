---
name: markdown-to-docx
description: Converts a Markdown file into an editable Microsoft Word (.docx) document using python-docx (no pandoc required). Supports headings, paragraphs, bold/italic/code/strikethrough, hyperlinks, pipe tables with column alignment, blockquote callouts, and bullet/ordered/nested/task lists. Use when the user wants a Word version of a markdown document — reports, briefs, documentation, READMEs, meeting notes, contracts, or any markdown that needs to be shared or edited as a .docx.
---

# Markdown → Word (.docx)

Produces an editable Microsoft Word document from a Markdown source. The conversion is done directly with `python-docx` (no pandoc, no headless browser), so Word heading styles, real tables, clickable hyperlinks, and proper list formatting are preserved for later editing.

```
Markdown (.md) ──► Word (.docx)   via python-docx
```

## Setup

Requires `python3` with the `python-docx` package.

```bash
python3 -c "import docx; print('python-docx', docx.__version__)"   # verify
pip install python-docx                                            # if missing
```

## Usage

The entry point is `scripts/md_to_docx.py`.

```bash
python3 scripts/md_to_docx.py \
    -i path/to/document.md \
    -o path/to/document.docx \
    --title "Document Title" \
    --author "Author Name" \
    --font "Calibri" \
    --font-size 11
```

### Arguments

| Flag | Default | Description |
|------|---------|-------------|
| `-i`, `--input` | *(required)* | Source Markdown file |
| `-o`, `--output` | `<input>.docx` | Output `.docx` path |
| `--title` | from frontmatter | Document title (saved as a Word core property) |
| `--author` | from frontmatter | Document author (saved as a Word core properties) |
| `--font` | `Calibri` | Body font family |
| `--font-size` | `11` | Body font size in points |

### Minimal example

```bash
python3 scripts/md_to_docx.py -i README.md
# → writes README.docx next to the source
```

## What the script supports

- **Headings** — ATX `#`…`######` mapped to Word Heading 1–6 styles (inline formatting preserved).
- **Paragraphs** — soft-wrapped lines are joined into single paragraphs.
- **Inline formatting** — `**bold**`, `*italic*`, `` `code` ``, `~~strikethrough~~`, and `[links](https://...)` (rendered as clickable Word hyperlinks).
- **Tables** — GitHub-flavoured pipe tables with per-column alignment (`:---` left, `---:` right, `:---:` center). Header row is bolded.
- **Blockquotes** — rendered as indented callout paragraphs. Soft-wrapped lines join; a blank `>` line or a list/clause marker (e.g. `(a)`, `1.`) starts a new paragraph.
- **Lists** — bullet (`-`/`*`/`+`), ordered (`1.`/`1)`), nested (indent with 2 spaces per level), and task lists (`- [ ]` / `- [x]`, rendered as ☐ / ☒).
- **Horizontal rules** — `---`, `***`, `___` render as a paragraph bottom border.
- **Frontmatter** — a leading `--- … ---` YAML block is parsed for `title` / `author` and excluded from the body.

## Output characteristics

- Output is a standard `.docx` that opens in Word, Google Docs, LibreOffice, or Pages and is fully editable.
- Headings use Word's built-in heading styles, so they populate the navigation pane and work with Word's table-of-contents feature.
- Hyperlinks are clickable in Word and most viewers.
- Typical output is tens of KB for a multi-page text document.

## Limitations

- **No images** — `![alt](url)` is not embedded; the alt text may render as a link. Add images manually in Word afterwards.
- **No syntax highlighting** — fenced code blocks are not specially styled (inline `` `code` `` is rendered in Consolas).
- **No LaTeX math** — `$...$` is rendered as literal text.
- **Nested blockquotes with inner lists** are flattened (a `>` line starting with `-` is treated as a blockquote paragraph, not a nested list).
- **Footnotes and definition lists** are not supported.
- For heavy formatting needs (complex nested lists, math, syntax highlighting, image embedding), pandoc with a reference doc is more powerful: `pandoc input.md -o output.docx`.

## Customizing the look

Edit `scripts/md_to_docx.py`:

- `--font` / `--font-size` (or the `convert()` defaults) — body typography.
- `add_blockquote()` indent (`Inches(0.25)`) — blockquote indentation.
- `bullets` list in `add_list()` — bullet glyphs per nesting level.
- `add_table()` — swap `Table Grid` for another built-in style (e.g. `Light List Accent 1`).

## Tip

If you only need a **PDF** (not an editable Word file), use the sibling `markdown-to-pdf` skill instead, which produces a styled, print-ready PDF via headless Chrome.
