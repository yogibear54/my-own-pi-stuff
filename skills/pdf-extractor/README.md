# PDF Extractor Analyzer Skill for pi

This skill integrates the [PDF Extractor Analyzer](https://github.com/your-repo/pdf-extractor-analyzer) into pi coding agents, enabling AI-powered PDF text extraction, summarization, and structured data extraction.

## Overview

The PDF Extractor Analyzer is an image-first PDF processing pipeline that:
- Converts PDF pages to images using PyMuPDF
- Analyzes images using vision-capable LLM providers (Replicate, OpenRouter)
- Supports multiple extraction modes (full text, summary, structured, markdown, custom prompts)
- Includes caching, batch processing, and async support

## Setup Instructions

### 1. Install the Skill

The skill is already installed at `~/.pi/agent/skills/pdf-extractor/`. To use it in a pi session:

```bash
pi
```

The agent will automatically discover and load the skill based on its description.

### 2. Install the PDF Extractor Application

Use the setup script to install the PDF Extractor Analyzer:

```bash
cd ~/.pi/agent/skills/pdf-extractor
./scripts/setup.sh
```

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
| 1 | `--dir` CLI argument | `./extract.py --dir ~/my-pdfs ...` |
| 2 | `PDF_EXTRACTOR_DIR` env var | `export PDF_EXTRACTOR_DIR=~/my-pdfs` |
| 3 | Config file | `~/.config/pdf-extractor-skill/config.env` |
| 4 | Default location | `~/Projects/.../pdf-extractor-analyzer` |

To set a persistent configuration:

```bash
mkdir -p ~/.config/pdf-extractor-skill
echo 'PDF_EXTRACTOR_DIR=/path/to/installation' > ~/.config/pdf-extractor-skill/config.env
```

Or use the setup script:

```bash
./scripts/setup.sh --create-config
```

### 3. Configure API Credentials

Choose your preferred LLM provider:

#### Option A: Replicate (Default)
1. Get an API token from [replicate.com](https://replicate.com)
2. Add to your shell profile:
   ```bash
   export REPLICATE_API_TOKEN="your_token_here"
   ```

#### Option B: OpenRouter
1. Get an API key from [openrouter.ai](https://openrouter.ai)
2. Add to your shell profile:
   ```bash
   export OPENROUTER_API_KEY="your_key_here"
   ```

### 4. Reload pi (if running)

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
Use the skill command:

```
/skill:pdf-extractor extract ./document.pdf --mode summary --pretty
```

## Extraction Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `full_text` | Complete text transcription with layout | Archiving, full content extraction |
| `summary` | 3-5 sentence summary | Quick overview, key points |
| `structured` | Data matching a Pydantic schema | Invoice data, forms, tables |
| `markdown` | Markdown-formatted output | Documentation, conversion |
| `prompt` | Custom extraction instructions | Flexible, user-defined extraction |

## Examples

### Extract Full Text
```bash
pdf-extractor ./document.pdf --mode full_text --pretty
```

### Summarize Document
```bash
pdf-extractor ./report.pdf --mode summary --pretty
```

### Structured Extraction
```bash
pdf-extractor ./invoice.pdf --mode structured --schema-import myschemas:InvoiceSchema --pretty
```

### Convert to Markdown
```bash
pdf-extractor ./document.pdf --mode markdown --pretty
```

### Custom Prompt Extraction
```bash
pdf-extractor ./contract.pdf --mode prompt --prompt "Extract all parties, dates, and monetary amounts"
```

### Batch Processing
```bash
pdf-extractor ./docs/*.pdf --mode summary --max-workers 4 --pretty
```

## Integration with Other Skills

This skill can be combined with other pi skills:

- **File Operations**: Use `read` and `bash` tools to locate PDFs and save extractions
- **Code Generation**: Generate Pydantic schemas for structured extraction
- **Web Search**: Find API keys or documentation for LLM providers
- **Documentation**: Create markdown documentation from PDF content

## Troubleshooting

### "Command not found: pdf-extractor"
The PDF Extractor is not in your PATH. Run the setup script:
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
export REPLICATE_API_TOKEN="your_token"  # for Replicate
export OPENROUTER_API_KEY="your_key"     # for OpenRouter
```

### Slow extraction
Use async mode for faster processing:
```bash
pdf-extractor ./large.pdf --mode summary --async --pretty
```

### Cached results
Disable caching for fresh extractions:
```bash
pdf-extractor ./document.pdf --cache-mode disabled --mode summary --pretty
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

## Configuration Options

### CLI Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--mode` | Extraction mode | `full_text` |
| `--provider` | LLM provider | `replicate` |
| `--model` | Model to use | Provider default |
| `--dpi` | PDF image DPI | `150` |
| `--cache-mode` | Caching behavior | `persistent` |
| `--max-workers` | Parallel PDF workers | `4` |
| `--async` | Use async pipeline | `false` |
| `--pretty` | Pretty-print JSON | `false` |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PDF_EXTRACTOR_DIR` | Installation directory for pdf-extractor-analyzer |
| `REPLICATE_API_TOKEN` | Replicate API authentication |
| `OPENROUTER_API_KEY` | OpenRouter API authentication |

## For Skill Developers

To create similar skills for other tools:

1. Create a directory under `~/.pi/agent/skills/`
2. Add `SKILL.md` with frontmatter (`name`, `description`)
3. Include setup instructions and usage examples
4. Use `{baseDir}` placeholder for the skill's directory path
5. Test that the skill loads correctly in pi

## License

This skill wraps the PDF Extractor Analyzer application. See the application's LICENSE for details.
