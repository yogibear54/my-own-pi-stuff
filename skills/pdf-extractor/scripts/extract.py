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
    ./extract.py document.pdf                    # Full text extraction
    ./extract.py document.pdf summary            # Summary mode
    ./extract.py document.pdf markdown --pretty  # Markdown with pretty output
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
        choices=["full_text", "summary", "structured", "markdown", "prompt"],
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

    return run_extractor(args)


if __name__ == "__main__":
    sys.exit(main())
