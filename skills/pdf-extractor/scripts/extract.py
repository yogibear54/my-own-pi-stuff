#!/usr/bin/env python3
"""
PDF Extractor - Python wrapper for convenient skill usage

This script provides a simple interface to the PDF Extractor Analyzer,
making it easy to use from within pi or other coding agents.

Configuration order (first found wins):
  1. --dir CLI argument
  2. PDF_EXTRACTOR_DIR environment variable
  3. ~/.config/pdf-extractor-skill/config.env
  4. Skill directory (.venv)
  5. System module (pdf_extractor_analyzer)

Usage:
    ./extract.py <pdf_path> [mode] [--pretty] [--output FILE]

Examples:
    ./extract.py document.pdf                           # Full text extraction
    ./extract.py document.pdf summary                   # Summary mode
    ./extract.py document.pdf markdown --pretty         # Markdown with pretty output
    ./extract.py document.pdf html --per-page           # HTML with per-page output
    ./extract.py document.pdf --mode full_text --async  # Async extraction
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path


def get_config_dir() -> Path:
    """Get the config directory path."""
    config_home = os.environ.get("XDG_CONFIG_HOME")
    if config_home:
        return Path(config_home) / "pdf-extractor-skill"
    return Path.home() / ".config" / "pdf-extractor-skill"


def find_install_dir(args_dir: str | None) -> Path | None:
    """
    Find the PDF Extractor installation directory.
    
    Search order:
    1. CLI argument
    2. PDF_EXTRACTOR_DIR env var
    3. Config file
    4. Skill directory
    5. None (fall back to system)
    """
    # 1. CLI argument
    if args_dir:
        path = Path(args_dir)
        if path.exists():
            return path.resolve()
        return None

    # 2. Environment variable
    env_dir = os.environ.get("PDF_EXTRACTOR_DIR")
    if env_dir:
        path = Path(env_dir)
        if path.exists():
            return path.resolve()

    # 3. Config file
    config_file = get_config_dir() / "config.env"
    if config_file.exists():
        try:
            # Simple config parser
            content = config_file.read_text()
            for line in content.splitlines():
                line = line.strip()
                if line.startswith("PDF_EXTRACTOR_DIR=") and not line.startswith("#"):
                    value = line.split("=", 1)[1].strip()
                    path = Path(value)
                    if path.exists():
                        return path.resolve()
        except Exception:
            pass

    # 4. Skill directory
    script_dir = Path(__file__).parent.resolve()
    skill_dir = script_dir.parent
    venv_dir = skill_dir / ".venv"
    if venv_dir.exists():
        return skill_dir

    # 5. None (use system)
    return None


def find_venv_binary(name: str, install_dir: Path | None) -> Path | None:
    """Find a binary in the virtual environment."""
    # Try skill directory first
    if install_dir:
        venv_bin = install_dir / ".venv" / "bin" / name
        if venv_bin.exists():
            return venv_bin

    # Try current script's directory (skill folder)
    script_dir = Path(__file__).parent.resolve()
    venv_bin = script_dir.parent / ".venv" / "bin" / name
    if venv_bin.exists():
        return venv_bin

    return None


def run_extractor(args: list[str]) -> int:
    """Run pdf-extractor with the given arguments."""
    # Parse just the --dir argument to find installation
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", dest="install_dir")
    parsed, _ = parser.parse_known_args(args)
    
    install_dir = find_install_dir(parsed.install_dir)
    pdf_extractor = find_venv_binary("pdf-extractor", install_dir)
    
    if pdf_extractor:
        cmd = [str(pdf_extractor)] + args
    else:
        # Fall back to system python -m module
        cmd = [sys.executable, "-m", "pdf_extractor_analyzer"] + args

    try:
        result = subprocess.run(cmd)
        return result.returncode
    except subprocess.CalledProcessError as e:
        print(f"Error: pdf-extractor failed with code {e.returncode}", file=sys.stderr)
        return e.returncode
    except FileNotFoundError:
        print(
            "Error: pdf-extractor not found. Please run setup.sh first:\n"
            f"  {Path(__file__).parent.parent}/scripts/setup.sh",
            file=sys.stderr
        )
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract and analyze PDFs with vision AI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument(
        "mode",
        nargs="?",
        default="full_text",
        choices=["full_text", "summary", "structured", "markdown", "html", "prompt"],
        help="Extraction mode (default: full_text)",
    )
    parser.add_argument("--dir", help="Override PDF Extractor installation directory")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output")
    parser.add_argument("--output", help="Output file path")
    parser.add_argument("--prompt", help="Custom prompt for PROMPT mode")
    parser.add_argument("--schema", help="Schema import path for structured mode (module:ClassName)")
    parser.add_argument("--provider", default="openrouter", help="LLM provider")
    parser.add_argument(
        "--cache-mode",
        default="persistent",
        choices=["persistent", "ephemeral", "disabled"],
        help="Cache mode",
    )
    parser.add_argument(
        "--per-page",
        action="store_true",
        help="Write per-page output files (for markdown/html modes)",
    )
    parser.add_argument(
        "--dpi",
        type=int,
        default=None,
        help="DPI for rendered page images (e.g., 150, 300)",
    )
    parser.add_argument(
        "--image-max-long-edge",
        type=int,
        default=None,
        help="Maximum pixel size for the longest edge of rendered images",
    )
    parser.add_argument(
        "--async",
        dest="use_async",
        action="store_true",
        help="Use async processing for faster concurrent page processing",
    )
    parser.add_argument(
        "--max-workers",
        type=int,
        default=None,
        help="Maximum number of PDFs to process in parallel (default: 4)",
    )
    parser.add_argument(
        "--max-concurrent-pages",
        type=int,
        default=None,
        help="Maximum number of pages to process concurrently per PDF (default: 4)",
    )
    parser.add_argument(
        "--async-rps",
        type=float,
        default=None,
        help="Async requests per second rate limit (default: 8.0)",
    )
    parser.add_argument(
        "--stop-on-error",
        action="store_true",
        help="Stop batch processing on first error (fail fast)",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="Model to use (e.g., openai/gpt-4o, openrouter/auto)",
    )
    parser.add_argument(
        "--openrouter-api-key",
        default=None,
        help="OpenRouter API key (or set OPENROUTER_API_KEY env var)",
    )
    parser.add_argument(
        "--replicate-api-token",
        default=None,
        help="Replicate API token (or set REPLICATE_API_TOKEN env var)",
    )
    parser.add_argument(
        "--replicate-max-concurrent-calls",
        type=int,
        default=None,
        help="Maximum concurrent Replicate API calls (default: 1)",
    )

    parsed = parser.parse_args()

    # Build arguments for pdf-extractor
    args = []
    
    if parsed.dir:
        args.extend(["--dir", parsed.dir])
    
    args.append(parsed.pdf_path)
    args.extend(["--mode", parsed.mode])
    args.extend(["--provider", parsed.provider])
    args.extend(["--cache-mode", parsed.cache_mode])

    if parsed.pretty:
        args.append("--pretty")

    if parsed.output:
        args.extend(["--output", parsed.output])

    if parsed.prompt:
        args.extend(["--prompt", parsed.prompt])

    if parsed.schema:
        args.extend(["--schema-import", parsed.schema])

    if parsed.per_page:
        args.append("--per-page")

    if parsed.dpi is not None:
        args.extend(["--dpi", str(parsed.dpi)])

    if parsed.image_max_long_edge is not None:
        args.extend(["--image-max-long-edge", str(parsed.image_max_long_edge)])

    if parsed.use_async:
        args.append("--async")

    if parsed.max_workers is not None:
        args.extend(["--max-workers", str(parsed.max_workers)])

    if parsed.max_concurrent_pages is not None:
        args.extend(["--max-concurrent-pages", str(parsed.max_concurrent_pages)])

    if parsed.async_rps is not None:
        args.extend(["--async-rps", str(parsed.async_rps)])

    if parsed.stop_on_error:
        args.append("--stop-on-error")

    if parsed.model:
        args.extend(["--model", parsed.model])

    if parsed.openrouter_api_key:
        args.extend(["--openrouter-api-key", parsed.openrouter_api_key])

    if parsed.replicate_api_token:
        args.extend(["--replicate-api-token", parsed.replicate_api_token])

    if parsed.replicate_max_concurrent_calls is not None:
        args.extend(["--replicate-max-concurrent-calls", str(parsed.replicate_max_concurrent_calls)])

    return run_extractor(args)


if __name__ == "__main__":
    sys.exit(main())
