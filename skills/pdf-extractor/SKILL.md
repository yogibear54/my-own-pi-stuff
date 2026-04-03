---
name: pdf-extractor
description: Extract and analyze text from PDF files using vision AI. Supports full text extraction, summarization, structured data extraction with Pydantic schemas, Markdown conversion, and custom prompt extraction. Use when you need to extract, summarize, or analyze content from PDF documents.
---

# PDF Extractor Analyzer

Image-first PDF extraction and analysis using vision AI models.

## Quick Start

```bash
# Full text extraction (default mode)
pdf-extractor ./document.pdf --pretty

# Summary extraction
pdf-extractor ./document.pdf --mode summary --pretty

# Structured extraction with Pydantic schema
pdf-extractor ./document.pdf --mode structured --schema-import my_schemas:InvoiceSchema --pretty

# Markdown conversion
pdf-extractor ./document.pdf --mode markdown --pretty
```

## Installation

Run the setup script to install the PDF Extractor Analyzer:

```bash
cd ~/.pi/agent/skills/pdf-extractor
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

### Configuration

The installation directory can be configured via:

| Priority | Source | Example |
|----------|--------|---------|
| 1 | `--dir` CLI argument | `./extract.py --dir ~/my-pdfs ...` |
| 2 | `PDF_EXTRACTOR_DIR` env var | `export PDF_EXTRACTOR_DIR=~/my-pdfs` |
| 3 | Config file | `~/.config/pdf-extractor-skill/config.env` |
| 4 | Default location | `~/Projects/.../pdf-extractor-analyzer` |

Create a config file:

```bash
mkdir -p ~/.config/pdf-extractor-skill
echo 'PDF_EXTRACTOR_DIR=/path/to/installation' > ~/.config/pdf-extractor-skill/config.env
```

Or use the setup script:

```bash
./scripts/setup.sh --create-config  # Creates default config
```

Set your API token:

```bash
# For Replicate (default)
export REPLICATE_API_TOKEN=your_token

# For OpenRouter
export OPENROUTER_API_KEY=your_key
```

## Extraction Modes

| Mode | Description |
|------|-------------|
| `full_text` | Transcribes all text with layout preservation |
| `summary` | 3-5 sentence summary with key details |
| `structured` | Extracts data matching a Pydantic schema |
| `markdown` | Converts pages to Markdown with proper formatting |
| `prompt` | Custom prompt for flexible extraction |

## CLI Usage

```bash
# Basic extraction
pdf-extractor ./document.pdf --pretty

# Different modes
pdf-extractor ./document.pdf --mode summary --pretty
pdf-extractor ./document.pdf --mode markdown --pretty

# Structured extraction (requires Pydantic schema import)
pdf-extractor ./document.pdf --mode structured --schema-import my_module:MySchema --pretty

# Custom prompt extraction
pdf-extractor ./document.pdf --mode prompt --prompt "Extract all dates and amounts"

# Batch processing
pdf-extractor ./file1.pdf ./file2.pdf --mode summary --max-workers 4 --pretty

# Async processing (faster for multi-page PDFs)
pdf-extractor ./document.pdf --mode summary --async --pretty

# Control image quality
pdf-extractor ./document.pdf --dpi 150 --image-max-long-edge 2048 --pretty

# Disable caching
pdf-extractor ./document.pdf --cache-mode disabled --mode summary --pretty
```

## Python API

```python
from pydantic import BaseModel
from pdf_extractor_analyzer import (
    CacheMode, ExtractionMode, ExtractorConfig, PDFExtractor,
    ReplicateProviderConfig, OpenRouterProviderConfig,
)

# Basic usage
config = ExtractorConfig(provider="replicate")
extractor = PDFExtractor(config)

result = extractor.extract("document.pdf", mode=ExtractionMode.SUMMARY)
print(result.content)

# Structured extraction
class InvoiceSchema(BaseModel):
    vendor_name: str | None = None
    invoice_number: str | None = None
    total_amount: float | None = None

result = extractor.extract(
    "invoice.pdf",
    mode=ExtractionMode.STRUCTURED,
    schema=InvoiceSchema,
)
print(result.model_dump())

# Batch processing
results = extractor.extract_many(
    ["doc1.pdf", "doc2.pdf"],
    mode=ExtractionMode.SUMMARY,
    max_workers=4,
)

# Async extraction
import asyncio
async def extract_async():
    result = await extractor.extract_async("document.pdf", mode=ExtractionMode.SUMMARY)
    print(result.content)

asyncio.run(extract_async())
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

## Concurrency Settings

```bash
# Multiple PDFs processed in parallel
pdf-extractor ./*.pdf --max-workers 4 --mode summary

# Pages within a document processed concurrently
pdf-extractor ./large.pdf --max-concurrent-pages 8 --mode full_text

# Replicate-specific concurrency control
pdf-extractor ./doc.pdf --replicate-max-concurrent-calls 3 --mode summary
```

## Provider Configuration

### Replicate (default)
```bash
export REPLICATE_API_TOKEN=your_token
```

Or in Python:
```python
config = ExtractorConfig(
    provider="replicate",
    replicate=ReplicateProviderConfig(api_token="your_token"),
)
```

### OpenRouter
```bash
export OPENROUTER_API_KEY=your_key
```

Or in Python:
```python
config = ExtractorConfig(
    provider="openrouter",
    openrouter=OpenRouterProviderConfig(api_key="your_key"),
)
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PDF_EXTRACTOR_DIR` | Installation directory for pdf-extractor-analyzer |
| `REPLICATE_API_TOKEN` | Replicate API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |

## Tips

- Use `--pretty` flag for readable JSON output in CLI
- Use `--cache-mode disabled` when you need fresh results every time
- Use `--max-pages` to limit processing to first N pages
- Use `--async` flag for faster processing of multi-page documents
- Structured mode requires a Pydantic BaseModel schema class
- Prompt mode allows custom extraction instructions to the LLM
