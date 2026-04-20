---
name: pdf-extractor
description: Extract and analyze content from PDF files using vision AI. Supports single or multiple PDFs (batch), full text extraction, structured data extraction with Pydantic schemas, Markdown/HTML conversion, worksheet-clean modes, user-content extraction, and custom prompt extraction. Use when you need to extract, summarize, or analyze content from one or more PDF documents.
---

# PDF Extractor Skill

Image-first PDF extraction and analysis using vision AI models via `scripts/extract.py`.

## When This Skill Is Used

When the user wants to extract, analyze, summarize, or convert content from PDF documents, you **MUST** gather the following flag values before running the script. **Do not proceed to the extraction step until all required questions have been answered.**

Support **one PDF or many**: pass multiple paths as separate positional arguments (see [Multi-file processing](#multi-file-processing)).

---

## MANDATORY: Gather All Required Questions First

**You MUST ask the user for answers to ALL 7 questions below. Do NOT skip any question. Do NOT proceed to extraction until you have an answer for each question.**

If the user provides partial answers, **STOP immediately** and ask only for the remaining unanswered questions. Continue this loop until all 7 questions have been answered.

---

### Question 1: PDF path(s) (required — one or more)

Absolute path(s) to every PDF to process.

- **Single file:** one absolute path (e.g. `/home/user/docs/report.pdf`).
- **Multiple files:** list each absolute path. The agent should resolve globs or folders into explicit paths before running so the command is unambiguous.

### Question 2: `--mode` (required — select one)

The extraction mode to use:

| Option | Description |
|--------|-------------|
| `full_text` | Transcribes all text with layout preservation |
| `structured` | Extracts data matching a Pydantic schema |
| `markdown` | Converts pages to Markdown with proper formatting |
| `html` | Converts pages to HTML with styling |
| `html_worksheet_clean` | Converts worksheet pages to clean blank-template HTML (removes filled answers) |
| `markdown_worksheet_clean` | Converts worksheet pages to clean blank-template Markdown (removes filled answers) |
| `prompt` | Custom prompt for flexible extraction |
| `user_content` | Extracts only user-created content (answers/annotations), ignoring pre-printed text |

### Question 3: `--write` (required — select one)

The output format:

| Option | Description |
|--------|-------------|
| *(omit flag)* | Default JSON output to stdout |
| `markdown` | Save as `.md` file(s) |
| `html` | Save as `.html` file(s) |

### Question 4: `--image-max-long-edge` (required)

Maximum pixel size for the longest edge of rendered page images. Default: `1024`. Increase for higher quality (e.g. `2048`), decrease for speed (e.g. `512`). The user must provide a value — suggest `1024` as the default.

### Question 5: `--dpi` (required)

DPI for rendered page images. Typical values: `150`, `300`. The user must provide a value — suggest `300` as the default.

### Question 6: `--per-page` (required — yes/no)

Whether to return per-page output (one array entry per page) instead of a combined result. This now works for **all modes**. In persistent cache mode, markdown/html families also write per-page sidecar files. The user must choose yes or no — suggest no as the default.

### Question 7: Other flags (required — free text, can be empty)

Ask the user if they want to pass any additional flags to the script. These are appended **after** the mandatory `--async --max-workers 4` (see [Running the Script](#running-the-script)). For example: `--pretty`, `--prompt "..."`, `--model openai/gpt-4o`, `--stop-on-error`, `--max-workers 8` (to override the default worker count), etc.

Do **not** ask the user to opt into `--async` or `--max-workers 4`; those are always applied by the skill unless question 7 supplies a different `--max-workers` (use that value instead of `4`, once).

**This question MUST be presented to the user, but the answer can be empty/null.** An empty response means no additional flags beyond the defaults.

---

## Gathering Answers: Loop Until Complete

Use the `questionnaire` tool to gather answers. If the user gives partial answers:

1. Note which questions are answered
2. Present a new questionnaire with ONLY the unanswered questions
3. Repeat until all 7 questions have answers

**Do not proceed to extraction until all 7 questions are answered.** If the user tries to skip or redirect before all questions are answered, firmly but politely repeat your request for the missing answers.

---

## Running the Script

Once all values are gathered, construct and run the command.

**Mandatory on every call:** `--async --max-workers 4` (after `--mode` / image / dpi / per-page, before question 7). If question 7 includes `--max-workers <N>`, use `--async --max-workers <N>` instead of `4` so there is only one `--max-workers` in the command.

**Single PDF:**

```bash
/home/yogibear54/.pi/agent/skills/pdf-extractor/scripts/extract.py <pdf_path> \
  --mode <mode> \
  [--write <format>] \
  [--image-max-long-edge <N>] \
  [--dpi <N>] \
  [--per-page] \
  --async --max-workers 4 \
  [<additional flags>]
```

**Multiple PDFs:** repeat each path as its own argument (same flags apply to all inputs):

```bash
/home/yogibear54/.pi/agent/skills/pdf-extractor/scripts/extract.py \
  <pdf_path_1> <pdf_path_2> [more paths...] \
  --mode <mode> \
  [--write <format>] \
  [--image-max-long-edge <N>] \
  [--dpi <N>] \
  [--per-page] \
  --async --max-workers 4 \
  [<additional flags>]
```

- Omit `--write` if the user chose the default (no flag).
- Omit `--image-max-long-edge` if the user didn't specify a value.
- Omit `--dpi` if the user didn't specify a value.
- Omit `--per-page` if the user chose no.
- Always include `--async` and `--max-workers` (`4` unless overridden from question 7).
- Append any additional flags from question 7 (even if empty).

---

## Multi-file processing

- **Invocation:** pass one positional argument per PDF; order is preserved.
- **Parallel documents + async:** the skill always passes `--async --max-workers 4` (or `--max-workers N` from question 7). Increase `N` for throughput when the user asks; keep within API/provider limits.
- **Failures:** `--stop-on-error` aborts the batch on the first failed PDF; without it, batch results usually include per-file `success` / `error` entries.
- **Stdout (no `--write`):** batch output is a **JSON array** of items. Each item typically includes `pdf_path`, `status`, `result`, and `error` (shape matches the upstream `pdf-extractor` / `pdf_extractor_analyzer` batch API).
- **`--write`:** each successful input PDF gets its own output file. With `--per-page` in batch runs, filenames are per-document (e.g. `invoice-p1.html`).

---

## Notes

- The script requires either `OPENROUTER_API_KEY` or `REPLICATE_API_TOKEN` to be set in the environment.
- The `structured` mode requires `--schema-import module:ClassName` — if the user selects structured mode, ask for the schema import path as a follow-up.
- The `prompt` mode requires `--prompt "..."` — if the user selects prompt mode, ask for the prompt text as a follow-up.
- `--write` mode compatibility:
  - `html` and `html_worksheet_clean` only support `--write html` (or omit `--write`).
  - `markdown_worksheet_clean` only supports `--write markdown` (or omit `--write`).
- Always use absolute paths for every PDF file.
