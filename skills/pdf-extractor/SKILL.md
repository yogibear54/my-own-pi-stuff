---
name: pdf-extractor
description: Extract and analyze text from PDF files using vision AI. Supports full text extraction, summarization, structured data extraction with Pydantic schemas, Markdown conversion, and custom prompt extraction. Use when you need to extract, summarize, or analyze content from PDF documents.
---

# PDF Extractor Skill

Image-first PDF extraction and analysis using vision AI models via `scripts/extract.py`.

## When This Skill Is Used

When the user wants to extract, analyze, summarize, or convert content from PDF documents, ask the following questions to configure the extraction. The PDF file path(s) are taken from the user's request directly.

## Required Questions

Ask the user for the following flag values before running the script:

### 1. `--mode` (select one)

The extraction mode to use:

| Option | Description |
|--------|-------------|
| `full_text` | Transcribes all text with layout preservation |
| `summary` | 3-5 sentence summary with key details |
| `structured` | Extracts data matching a Pydantic schema |
| `markdown` | Converts pages to Markdown with proper formatting |
| `html` | Converts pages to HTML with styling |
| `prompt` | Custom prompt for flexible extraction |

### 2. `--output` (select one)

The output format:

| Option | Description |
|--------|-------------|
| *(omit flag)* | Default JSON output to stdout |
| `markdown` | Save as `.md` file(s) |
| `html` | Save as `.html` file(s) |

### 3. `--image-max-long-edge` (required)

Maximum pixel size for the longest edge of rendered page images. Default: `1024`. Increase for higher quality (e.g. `2048`), decrease for speed (e.g. `512`). The user must provide a value — suggest `1024` as the default.

### 4. `--dpi` (required)

DPI for rendered page images. Typical values: `150`, `300`. The user must provide a value — suggest `300` as the default.

### 5. `--per-page` (required — yes/no)

Whether to write per-page output files. Only relevant for `markdown` and `html` output modes. The user must choose yes or no — suggest no as the default.

### 6. Other flags (required — free text)

Ask the user if they want to pass any additional flags to the script. These are appended as-is to the command. For example: `--pretty`, `--prompt "..."`, `--model openai/gpt-4o`, `--async`, etc. The user must confirm — "none" means no additional flags.

## Running the Script

Once all values are gathered, construct and run the command:

```bash
/home/yogibear54/.pi/agent/skills/pdf-extractor/scripts/extract.py <pdf_path> \
  --mode <mode> \
  [--output <format>] \
  [--image-max-long-edge <N>] \
  [--dpi <N>] \
  [--per-page] \
  [<additional flags>]
```

- Omit `--output` if the user chose the default (no flag).
- Omit `--image-max-long-edge` if the user didn't specify a value.
- Omit `--dpi` if the user didn't specify a value.
- Omit `--per-page` if the user chose no.
- Append any additional flags from question 6.

## Notes

- The script requires either `OPENROUTER_API_KEY` or `REPLICATE_API_TOKEN` to be set in the environment.
- The `structured` mode requires `--schema-import module:ClassName` — if the user selects structured mode, ask for the schema import path as a follow-up.
- The `prompt` mode requires `--prompt "..."` — if the user selects prompt mode, ask for the prompt text as a follow-up.
- Always use the absolute path to the PDF file(s).
