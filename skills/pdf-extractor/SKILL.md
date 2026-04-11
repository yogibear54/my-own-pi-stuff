---
name: pdf-extractor
description: Extract and analyze text from PDF files using vision AI. Supports full text extraction, summarization, structured data extraction with Pydantic schemas, Markdown conversion, and custom prompt extraction. Use when you need to extract, summarize, or analyze content from PDF documents.
---

# PDF Extractor Skill

Image-first PDF extraction and analysis using vision AI models via `scripts/extract.py`.

## When This Skill Is Used

When the user wants to extract, analyze, summarize, or convert content from PDF documents, you **MUST** gather the following flag values before running the script. **Do not proceed to the extraction step until all required questions have been answered.**

---

## MANDATORY: Gather All Required Questions First

**You MUST ask the user for answers to ALL 6 questions below. Do NOT skip any question. Do NOT proceed to extraction until you have an answer for each question.**

If the user provides partial answers, **STOP immediately** and ask only for the remaining unanswered questions. Continue this loop until all 6 questions have been answered.

---

### Question 1: `--mode` (required — select one)

The extraction mode to use:

| Option | Description |
|--------|-------------|
| `full_text` | Transcribes all text with layout preservation |
| `structured` | Extracts data matching a Pydantic schema |
| `markdown` | Converts pages to Markdown with proper formatting |
| `html` | Converts pages to HTML with styling |
| `prompt` | Custom prompt for flexible extraction |

### Question 2: `--output` (required — select one)

The output format:

| Option | Description |
|--------|-------------|
| *(omit flag)* | Default JSON output to stdout |
| `markdown` | Save as `.md` file(s) |
| `html` | Save as `.html` file(s) |

### Question 3: `--image-max-long-edge` (required)

Maximum pixel size for the longest edge of rendered page images. Default: `1024`. Increase for higher quality (e.g. `2048`), decrease for speed (e.g. `512`). The user must provide a value — suggest `1024` as the default.

### Question 4: `--dpi` (required)

DPI for rendered page images. Typical values: `150`, `300`. The user must provide a value — suggest `300` as the default.

### Question 5: `--per-page` (required — yes/no)

Whether to write per-page output files. Only relevant for `markdown` and `html` output modes. The user must choose yes or no — suggest no as the default.

### Question 6: Other flags (required — free text, can be empty)

Ask the user if they want to pass any additional flags to the script. These are appended as-is to the command. For example: `--pretty`, `--prompt "..."`, `--model openai/gpt-4o`, `--async`, etc.

**This question MUST be presented to the user, but the answer can be empty/null.** An empty response means no additional flags.

---

## Gathering Answers: Loop Until Complete

Use the `questionnaire` tool to gather answers. If the user gives partial answers:

1. Note which questions are answered
2. Present a new questionnaire with ONLY the unanswered questions
3. Repeat until all 6 questions have answers

**Do not proceed to extraction until all 6 questions are answered.** If the user tries to skip or redirect before all questions are answered, firmly but politely repeat your request for the missing answers.

---

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
- Append any additional flags from question 6 (even if empty).

---

## Notes

- The script requires either `OPENROUTER_API_KEY` or `REPLICATE_API_TOKEN` to be set in the environment.
- The `structured` mode requires `--schema-import module:ClassName` — if the user selects structured mode, ask for the schema import path as a follow-up.
- The `prompt` mode requires `--prompt "..."` — if the user selects prompt mode, ask for the prompt text as a follow-up.
- Always use the absolute path to the PDF file(s).
