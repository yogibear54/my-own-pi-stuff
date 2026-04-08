# PDF Extractor Skill for pi

This skill integrates PDF extraction and analysis into pi coding agents, enabling AI-powered PDF text extraction, summarization, and structured data extraction.

## Overview

This skill provides an image-first PDF processing pipeline that:
- Converts PDF pages to images using PyMuPDF
- Analyzes images using vision-capable LLM providers (OpenRouter, Replicate)
- Supports multiple extraction modes (full text, summary, structured, markdown, html, custom prompts)
- Includes caching, batch processing, and async support

## Setup Instructions

### 1. Install the Skill

The skill is already installed at `~/.pi/agent/skills/pdf-extractor/`. To use it in a pi session:

```bash
pi
```

The agent will automatically discover and load the skill based on its description.

### 2. Clone the PDF Extractor Application

If you don't already have the PDF Extractor Analyzer locally, clone it from GitHub:

```bash
git clone https://github.com/yogibear54/ai-pdf-extractor ~/path/where/you/want/it
```

> **Note:** Replace `~/path/where/you/want/it` with your desired installation directory. You'll point the setup script to this location in the next step.

### 3. Run the Setup Script

Use the setup script to install dependencies and configure the application:

```bash
cd ~/.pi/agent/skills/pdf-extractor
./scripts/setup.sh --dir ~/path/where/you/cloned/it
```

The `--dir` flag tells the setup script where to find the cloned repository. If you omit it, the script will check common locations or prompt you interactively.

#### Setup Options

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

#### Configuration

The installation directory is determined in this order:

| Priority | Source | Example |
|----------|--------|---------|
| 1 | `--dir` CLI argument | `./scripts/extract.py --dir ~/my-pdfs ...` |
| 2 | `PDF_EXTRACTOR_DIR` env var | `export PDF_EXTRACTOR_DIR=~/my-pdfs` |
| 3 | Config file | `~/.config/pdf-extractor-skill/config.env` |
| 4 | Skill directory `.venv` | Auto-detected from skill location |
| 5 | System module | Falls back to `pdf_extractor_analyzer` |

To set a persistent configuration:

```bash
mkdir -p ~/.config/pdf-extractor-skill
echo 'PDF_EXTRACTOR_DIR=/path/to/installation' > ~/.config/pdf-extractor-skill/config.env
```

Or use the setup script:

```bash
./scripts/setup.sh --create-config
```

### 4. Configure API Credentials

Choose your preferred LLM provider:

#### Option A: OpenRouter (Default)
1. Get an API key from [openrouter.ai](https://openrouter.ai)
2. Add to your shell profile:
   ```bash
   export OPENROUTER_API_KEY="your_key_here"
   ```

#### Option B: Replicate
1. Get an API token from [replicate.com](https://replicate.com)
2. Add to your shell profile:
   ```bash
   export REPLICATE_API_TOKEN="your_token_here"
   ```

### 5. Reload pi (if running)

If pi is already running, reload to discover the skill:

```
/reload
```

## Usage in pi

### Method 1: Natural Language
Simply describe what you need:

> "Extract all the text from this PDF document"
> "Summarize the key points in this PDF"
> "Extract the invoice data from this PDF into a structured format"

### Method 2: Direct Command
Use the skill script directly:

```
./scripts/extract.py ./document.pdf summary --pretty
```

## Extraction Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `full_text` | Complete text transcription with layout | Archiving, full content extraction |
| `summary` | 3-5 sentence summary | Quick overview, key points |
| `structured` | Data matching a Pydantic schema | Invoice data, forms, tables |
| `markdown` | Markdown-formatted output | Documentation, conversion |
| `html` | HTML-formatted output | Web-friendly conversion |
| `prompt` | Custom extraction instructions | Flexible, user-defined extraction |

## Examples

### Extract Full Text
```bash
./scripts/extract.py ./document.pdf --mode full_text --pretty
```

### Summarize Document
```bash
./scripts/extract.py ./report.pdf summary --pretty
```

### Structured Extraction
```bash
./scripts/extract.py ./invoice.pdf structured --schema myschemas:InvoiceSchema --pretty
```

### Convert to Markdown
```bash
./scripts/extract.py ./document.pdf markdown --pretty
```

### Convert to HTML (per-page output)
```bash
./scripts/extract.py ./document.pdf html --per-page
```

### Custom Prompt Extraction
```bash
./scripts/extract.py ./contract.pdf prompt --prompt "Extract all parties, dates, and monetary amounts"
```

### Batch Processing
```bash
./scripts/extract.py ./file1.pdf ./file2.pdf --mode summary --max-workers 4 --pretty
```

### Async Processing (faster for multi-page PDFs)
```bash
./scripts/extract.py ./large.pdf summary --async --pretty
```

### Async with Rate Limiting
```bash
./scripts/extract.py ./large.pdf summary --async --async-rps 10 --pretty
```

## Integration with Other Skills

This skill can be combined with other pi skills:

- **File Operations**: Use `read` and `bash` tools to locate PDFs and save extractions
- **Code Generation**: Generate Pydantic schemas for structured extraction
- **Web Search**: Find API keys or documentation for LLM providers
- **Documentation**: Create markdown documentation from PDF content

## Troubleshooting

### "pdf-extractor not found"
The application is not in your PATH. Run the setup script:
```bash
cd ~/.pi/agent/skills/pdf-extractor
./scripts/setup.sh
```

Or check your installation directory:
```bash
source ~/.pi/agent/skills/pdf-extractor/.venv/bin/activate
# or
source /path/to/your/installation/.venv/bin/activate
```

### Wrong installation directory detected
Update your config file:
```bash
echo 'PDF_EXTRACTOR_DIR=/correct/path' > ~/.config/pdf-extractor-skill/config.env
```

Or set the environment variable:
```bash
export PDF_EXTRACTOR_DIR=/correct/path
```

### "Provider requires API key"
Set the appropriate environment variable:
```bash
export OPENROUTER_API_KEY="your_key"     # for OpenRouter (default)
export REPLICATE_API_TOKEN="your_token"  # for Replicate
```

### Slow extraction
Use async mode for faster processing:
```bash
./scripts/extract.py ./large.pdf summary --async --pretty
```

### Cached results
Disable caching for fresh extractions:
```bash
./scripts/extract.py ./document.pdf --cache-mode disabled --mode summary --pretty
```

## File Structure

```
~/.pi/agent/skills/pdf-extractor/
├── SKILL.md           # Skill definition and usage instructions
├── README.md          # This file - setup guide
├── .venv/            # Python virtual environment (after --install-here)
└── scripts/
    ├── setup.sh       # Setup script with configuration options
    └── extract.py     # Python wrapper for the CLI
```

## CLI Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `pdf_path` | Path to the PDF file (required) | - |
| `mode` | Extraction mode | `full_text` |
| `--provider` | LLM provider (`openrouter`, `replicate`) | `openrouter` |
| `--model` | Model to use | Provider default |
| `--dpi` | PDF image DPI | `150` |
| `--cache-mode` | Caching behavior (`persistent`, `ephemeral`, `disabled`) | `persistent` |
| `--max-workers` | Parallel PDF workers | `4` |
| `--max-concurrent-pages` | Concurrent pages per PDF | `4` |
| `--async` | Use async pipeline | `false` |
| `--async-rps` | Async requests per second | `8.0` |
| `--pretty` | Pretty-print JSON | `false` |
| `--output FILE` | Output file path | stdout |
| `--per-page` | Per-page output files (markdown/html) | `false` |
| `--stop-on-error` | Stop batch on first error | `false` |

### Schema Argument

For structured extraction, use `--schema` with format `module:ClassName`:

```bash
./scripts/extract.py ./invoice.pdf structured --schema myschemas:InvoiceSchema --pretty
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PDF_EXTRACTOR_DIR` | Installation directory for pdf-extractor-analyzer |
| `OPENROUTER_API_KEY` | OpenRouter API authentication (default provider) |
| `REPLICATE_API_TOKEN` | Replicate API authentication |
| `XDG_CONFIG_HOME` | Config directory base (default: `~/.config`) |

## For Skill Developers

To create similar skills for other tools:

1. Create a directory under `~/.pi/agent/skills/`
2. Add `SKILL.md` with frontmatter (`name`, `description`)
3. Include setup instructions and usage examples
4. Use `scripts/extract.py` wrapper for command-line interface
5. Test that the skill loads correctly in pi
