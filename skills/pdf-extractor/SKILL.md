---
name: pdf-extractor
description: Extract and analyze text from PDF files using vision AI. Supports full text extraction, summarization, structured data extraction with Pydantic schemas, Markdown conversion, and custom prompt extraction. Use when you need to extract, summarize, or analyze content from PDF documents.
---

# PDF Extractor Analyzer

Image-first PDF extraction and analysis using vision AI models via `scripts/extract.py`.

## Quick Start

```bash
# Full text extraction (default mode)
./scripts/extract.py ./document.pdf --pretty

# Summary extraction
./scripts/extract.py ./document.pdf summary --pretty

# Markdown conversion
./scripts/extract.py ./document.pdf markdown --pretty
```

## Extraction Modes

| Mode | Description |
|------|-------------|
| `full_text` | Transcribes all text with layout preservation |
| `summary` | 3-5 sentence summary with key details |
| `structured` | Extracts data matching a Pydantic schema |
| `markdown` | Converts pages to Markdown with proper formatting |
| `html` | Converts pages to HTML with styling |
| `prompt` | Custom prompt for flexible extraction |

## CLI Usage

```bash
# Basic extraction (default: full_text mode)
./scripts/extract.py ./document.pdf --pretty

# Different modes
./scripts/extract.py ./document.pdf summary --pretty
./scripts/extract.py ./document.pdf markdown --pretty
./scripts/extract.py ./document.pdf html --per-page

# Structured extraction (requires Pydantic schema import)
./scripts/extract.py ./document.pdf structured --schema my_module:MySchema --pretty

# Custom prompt extraction
./scripts/extract.py ./document.pdf prompt --prompt "Extract all dates and amounts"

# Batch processing
./scripts/extract.py ./file1.pdf ./file2.pdf --mode summary --max-workers 4 --pretty

# Async processing (faster for multi-page PDFs)
./scripts/extract.py ./document.pdf --mode summary --async --pretty

# Async with rate limiting
./scripts/extract.py ./document.pdf --mode summary --async --async-rps 10 --pretty

# Control image quality
./scripts/extract.py ./document.pdf --dpi 150 --image-max-long-edge 2048 --pretty

# Disable caching
./scripts/extract.py ./document.pdf --cache-mode disabled --mode summary --pretty

# Stop on first error (batch processing)
./scripts/extract.py ./file1.pdf ./file2.pdf --mode summary --stop-on-error

# Specify model
./scripts/extract.py ./document.pdf --model openai/gpt-4o --mode summary --pretty

# Pass API key directly
./scripts/extract.py ./document.pdf --openrouter-api-key sk-... --mode summary --pretty

# Output to file
./scripts/extract.py ./document.pdf summary --output result.json --pretty

# Per-page output (for markdown/html modes)
./scripts/extract.py ./document.pdf markdown --per-page
```

## CLI Arguments

| Argument | Description |
|----------|-------------|
| `pdf_path` | Path to the PDF file (required) |
| `mode` | Extraction mode: `full_text`, `summary`, `structured`, `markdown`, `html`, `prompt` (default: `full_text`) |
| `--dir` | Override installation directory |
| `--pretty` | Pretty-print JSON output |
| `--output FILE` | Output file path |
| `--prompt TEXT` | Custom prompt for prompt mode |
| `--schema IMPORT` | Schema import path for structured mode (`module:ClassName`) |
| `--provider` | LLM provider: `openrouter` (default), `replicate` |
| `--cache-mode` | Cache mode: `persistent` (default), `ephemeral`, `disabled` |
| `--per-page` | Write per-page output files (markdown/html modes) |
| `--dpi N` | DPI for rendered page images |
| `--image-max-long-edge N` | Maximum pixel size for longest edge |
| `--async` | Use async processing |
| `--max-workers N` | Max parallel PDFs (default: 4) |
| `--max-concurrent-pages N` | Max concurrent pages per PDF |
| `--async-rps N` | Async requests per second (default: 8.0) |
| `--stop-on-error` | Stop batch on first error |
| `--model NAME` | Model to use (e.g., `openai/gpt-4o`) |
| `--openrouter-api-key KEY` | OpenRouter API key |
| `--replicate-api-token TOKEN` | Replicate API token |
| `--replicate-max-concurrent-calls N` | Max Replicate API calls |

## Installation

Run the setup script to install the PDF Extractor Analyzer:

```bash
./scripts/setup.sh
```

### Setup Options

```bash
# Interactive setup (prompts for directory if not found)
./scripts/setup.sh

# Use a specific installation directory
./scripts/setup.sh --dir ~/path/to/pdf-extractor-analyzer

# Install in the skill directory itself
./scripts/setup.sh --install-here

# Create config file only (don't install)
./scripts/setup.sh --create-config
```

## Configuration

The installation directory is determined in this order:

| Priority | Source | Example |
|----------|--------|---------|
| 1 | `--dir` CLI argument | `./extract.py --dir ~/my-pdfs ...` |
| 2 | `PDF_EXTRACTOR_DIR` env var | `export PDF_EXTRACTOR_DIR=~/my-pdfs` |
| 3 | Config file | `~/.config/pdf-extractor-skill/config.env` |
| 4 | Skill directory `.venv` | Auto-detected from skill location |
| 5 | System module | Falls back to `pdf_extractor_analyzer` |

Create a config file:

```bash
mkdir -p ~/.config/pdf-extractor-skill
echo 'PDF_EXTRACTOR_DIR=/path/to/installation' > ~/.config/pdf-extractor-skill/config.env
```

Or use the setup script:

```bash
./scripts/setup.sh --create-config  # Creates default config
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PDF_EXTRACTOR_DIR` | Installation directory for pdf-extractor-analyzer |
| `REPLICATE_API_TOKEN` | Replicate API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `XDG_CONFIG_HOME` | Config directory base (default: `~/.config`) |

## Provider Configuration

### OpenRouter (default)

```bash
export OPENROUTER_API_KEY=your_key
```

### Replicate

```bash
export REPLICATE_API_TOKEN=your_token
```

## Output Format

```json
{
  "extraction_mode": "summary",
  "content": "Extracted text content...",
  "metadata": {
    "source_hash": "abc123...",
    "page_count": 5,
    "model": "openai/gpt-4o",
    "cache_mode": "persistent",
    "generated_at": "2024-01-01T00:00:00Z"
  }
}
```

## Caching

- `persistent` (default): Saves to `./cache/` directory
- `ephemeral`: Temporary per-run cache
- `disabled`: No caching

Cache files are stored under `cache/<source_hash[:32]>/`:
- `content.json` - Extraction result
- `content.md` - Markdown (markdown mode only)
- `page_*.png` - Rendered page images

## Tips

- Use `--pretty` flag for readable JSON output in CLI
- Use `--cache-mode disabled` when you need fresh results every time
- Use `--async` flag for faster processing of multi-page documents
- Use `--async-rps` to control rate limiting for async requests
- Use `--stop-on-error` to stop batch processing on first error
- Use `--per-page` with markdown/html modes for individual page files
- Use `--output` to save results to a specific file
- Structured mode requires a Pydantic BaseModel schema class
- Prompt mode allows custom extraction instructions to the LLM
- Use `--model` to specify a different model (e.g., `openai/gpt-4o`)
