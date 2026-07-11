#!/usr/bin/env bash
# render-pdf.sh — Render one or more HTML files to PDF via Chrome headless --print-to-pdf.
#
# Standalone: no pre-running Chrome or CDP required. Uses a throwaway
# --user-data-dir per file so it never collides with the user's running browser.
#
# Usage:
#   ./render-pdf.sh <file.html> [more.html ...]
#   ./render-pdf.sh --out <out.pdf> <file.html>
#   ./render-pdf.sh --header-footer <file.html>   # keep Chrome's header/footer
#   ./render-pdf.sh --no-margins <file.html>      # use the HTML's own @page CSS
#
# Output: alongside each HTML file, same basename, .pdf extension (unless --out).
# By default forces A4 + 10mm page margins + body margin 0 (override with --no-margins).
# Exit code 0 iff all files succeed.

set -uo pipefail

CHROME_TIMEOUT=60

# --- locate a Chrome/Chromium binary ---
find_chrome() {
  for c in google-chrome google-chrome-stable chromium-browser chromium; do
    if command -v "$c" >/dev/null 2>&1; then
      command -v "$c"
      return 0
    fi
  done
  return 1
}

CHROME="$(find_chrome)" || {
  echo "Fatal: no Chrome/Chromium binary found in PATH." >&2
  exit 1
}

# --- parse args ---
OUT=""
HEADER_FOOTER=0
INJECT_MARGINS=1
HTML_FILES=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)
      [[ $# -lt 2 ]] && { echo "Fatal: --out requires a value." >&2; exit 2; }
      OUT="$2"; shift 2 ;;
    --header-footer)
      HEADER_FOOTER=1; shift ;;
    --no-margins)
      INJECT_MARGINS=0; shift ;;
    -h|--help)
      sed -n '2,15p' "$0"; exit 0 ;;
    --)
      shift; while [[ $# -gt 0 ]]; do HTML_FILES+=("$1"); shift; done ;;
    -*)
      echo "Fatal: unknown option: $1" >&2; exit 2 ;;
    *)
      HTML_FILES+=("$1"); shift ;;
  esac
done

if [[ ${#HTML_FILES[@]} -eq 0 ]]; then
  echo "Usage: render-pdf.sh [--out <out.pdf>] [--header-footer] [--no-margins] <file.html> [more.html ...]" >&2
  exit 2
fi

if [[ -n "$OUT" && ${#HTML_FILES[@]} -gt 1 ]]; then
  echo "Fatal: --out can only be used with a single HTML file." >&2
  exit 2
fi

# Header/footer flag: omit by default (ATS-safe), opt in with --header-footer.
HF_FLAG="--no-pdf-header-footer"
[[ "$HEADER_FOOTER" -eq 1 ]] && HF_FLAG=""

# --- inject render-time page setup (A4, 10mm margins, body margin 0) ---
# Copies src -> dst with a <style> override injected right after the opening
# <head> tag (appended at end of file if there is no <head>). Injecting after
# <head> keeps it outside any existing <style> block. Source file is never
# modified.
inject_page_margins() {
  local src="$1" dst="$2"
  local sf="$dst.style"
  cat > "$sf" <<'CSS'
<style data-render-pdf="override">
@page { size: A4 !important; margin: 10mm !important; }
body { margin: 0 !important; }
</style>
CSS
  awk -v sf="$sf" '
    BEGIN { while ((getline l < sf) > 0) s = s l ORS }
    !ins && tolower($0) ~ /<head[[:space:]>]/ { print; printf "%s", s; ins=1; next }
    { print }
    END { if (!ins) printf "%s", s }
  ' "$src" > "$dst"
  rm -f "$sf"
}

# --- render one html -> pdf ---
render_one() {
  local html="$1" out="$2"
  [[ -f "$html" ]] || { echo "  ✗ $html (not found)" >&2; return 1; }

  local html_abs out_abs
  html_abs="$(cd "$(dirname "$html")" && pwd)/$(basename "$html")"
  out_abs="$(cd "$(dirname "$out")" 2>/dev/null && pwd)/$(basename "$out")" \
    || { echo "  ✗ $html (output dir does not exist: $(dirname "$out"))" >&2; return 1; }

  local udd
  udd="$(mktemp -d "${TMPDIR:-/tmp}/html-to-pdf.XXXXXX")"
  trap 'rm -rf "$udd"' RETURN

  # Default: force A4 + 10mm page margins + body margin 0 via an injected
  # <style> in a temp copy (source untouched). --no-margins skips this.
  local render_src="$html_abs"
  if [[ "$INJECT_MARGINS" -eq 1 ]]; then
    render_src="$udd/source.html"
    inject_page_margins "$html_abs" "$render_src"
  fi

  local url="file://${render_src}"
  local chrome_out rc
  chrome_out="$(timeout "$CHROME_TIMEOUT" "$CHROME" \
    --headless=new \
    $HF_FLAG \
    --user-data-dir="$udd" \
    --print-to-pdf="$out_abs" \
    "$url" 2>&1)"
  rc=$?

  if [[ $rc -ne 0 ]]; then
    echo "  ✗ $html (chrome exit $rc)" >&2
    [[ -n "$chrome_out" ]] && printf '%s\n' "$chrome_out" | sed 's/^/    /' >&2
    return 1
  fi

  if [[ ! -f "$out_abs" ]] || [[ "$(head -c 5 "$out_abs" 2>/dev/null)" != "%PDF-" ]]; then
    echo "  ✗ $html (output is not a valid PDF: $out_abs)" >&2
    [[ -n "$chrome_out" ]] && printf '%s\n' "$chrome_out" | sed 's/^/    /' >&2
    return 1
  fi

  local size
  size="$(stat -c %s "$out_abs" 2>/dev/null || stat -f %z "$out_abs" 2>/dev/null)"
  echo "  ✓ $out_abs  ($size bytes)"
  return 0
}

# --- main ---
ok=0; fail=0
for html in "${HTML_FILES[@]}"; do
  if [[ -n "$OUT" ]]; then
    out="$OUT"
  else
    out="${html%.html}"; out="${out%.htm}"; out="${out}.pdf"
  fi
  echo "→ $html"
  if render_one "$html" "$out"; then ok=$((ok+1)); else fail=$((fail+1)); fi
done

echo
echo "=== Summary ==="
echo "  ✓ $ok succeeded"
[[ $fail -gt 0 ]] && echo "  ✗ $fail failed"

[[ $fail -eq 0 ]]
