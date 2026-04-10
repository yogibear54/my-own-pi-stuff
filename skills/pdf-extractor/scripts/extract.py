#!/usr/bin/env python3
"""
PDF Extractor - Thin wrapper around pdf-extractor

Passes all arguments directly to pdf-extractor, providing native
access to all flags and help output.

The only intercepted flag is --dir, used to locate the pdf-extractor
installation. It is consumed here and not forwarded.

Configuration order (first found wins):
  1. --dir CLI argument
  2. PDF_EXTRACTOR_DIR environment variable
  3. ~/.config/pdf-extractor-skill/config.env
  4. Skill directory (.venv)
  5. System module (pdf_extractor_analyzer)

Usage:
    ./extract.py --help                           # Show pdf-extractor help
    ./extract.py document.pdf                     # Full text extraction
    ./extract.py document.pdf --mode summary      # Summary mode
    ./extract.py document.pdf --pretty            # Pretty-printed JSON
    ./extract.py --dir /path/to/install doc.pdf   # Override install dir
"""

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


def find_install_dir(dir_arg: str | None) -> Path | None:
    """
    Find the PDF Extractor installation directory.

    Search order:
    1. CLI --dir argument
    2. PDF_EXTRACTOR_DIR env var
    3. Config file
    4. Skill directory
    5. None (fall back to system)
    """
    # 1. CLI argument
    if dir_arg:
        path = Path(dir_arg)
        if path.exists():
            return path.resolve()
        print(f"Error: --dir path does not exist: {dir_arg}", file=sys.stderr)
        sys.exit(1)

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


def extract_dir_arg(argv: list[str]) -> tuple[str | None, list[str]]:
    """
    Extract --dir from argv, returning (dir_value, remaining_args).

    Supports: --dir VALUE, --dir=VALUE
    """
    remaining = []
    dir_value = None
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--dir":
            if i + 1 >= len(argv):
                print("Error: --dir requires a value", file=sys.stderr)
                sys.exit(1)
            dir_value = argv[i + 1]
            i += 2
        elif arg.startswith("--dir="):
            dir_value = arg.split("=", 1)[1]
            i += 1
        else:
            remaining.append(arg)
            i += 1
    return dir_value, remaining


def main() -> int:
    dir_value, passthrough_args = extract_dir_arg(sys.argv[1:])
    install_dir = find_install_dir(dir_value)
    pdf_extractor = find_venv_binary("pdf-extractor", install_dir)

    if pdf_extractor:
        cmd = [str(pdf_extractor)] + passthrough_args
    else:
        cmd = [sys.executable, "-m", "pdf_extractor_analyzer"] + passthrough_args

    try:
        result = subprocess.run(cmd)
        return result.returncode
    except FileNotFoundError:
        print(
            "Error: pdf-extractor not found. Please run setup.sh first:\n"
            f"  {Path(__file__).parent.parent}/scripts/setup.sh",
            file=sys.stderr
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
