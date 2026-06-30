#!/usr/bin/env node
// serve-tagged.mjs — zero-dependency dev server for static HTML.
//
// Serves a directory and rewrites every served HTML page so that each element
// carries `data-pi-file` (project-relative path) and `data-pi-line` (1-based
// line of the element's opening tag in that file). The Pi Browser Picker reads
// these on click, so Pi knows exactly which file/line the clicked element came
// from.
//
// Usage:
//   node serve-tagged.mjs --root ./public --project-root . --port 4040
//
// Scope: static HTML files. It does NOT instrument dynamic server-rendered
// templates (PHP/Jinja/EJS/Blade) — those need an engine-specific instrumenter.
//
// Limitations (acceptable for a dev tool):
//   - `>` inside *unquoted* attribute values can confuse the tag matcher.
//     Quoted values ("..." or '...') are handled correctly.
//   - Elements inside <script> / <style> / <!-- comments --> are intentionally
//     left alone so JS/CSS is never corrupted.

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, relative, resolve, sep } from "node:path";

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith("--")) {
      const next = argv[i + 1];
      const v = next && !next.startsWith("--") ? argv[++i] : "";
      a[k.slice(2)] = v;
    }
  }
  return a;
}

const args = parseArgs(process.argv);
const ROOT = resolve(process.cwd(), args.root || ".");
const PROJECT_ROOT = resolve(process.cwd(), args["project-root"] || args.root || ".");
const PORT = parseInt(args.port || "4040", 10);
const HOST = args.host || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// Precompute the char offset where each line begins, so a char offset maps to a
// 1-based line number in O(log n).
function buildLineStarts(s) {
  const starts = [0];
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}
function lineOf(starts, offset) {
  let lo = 0, hi = starts.length - 1, res = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= offset) { res = mid + 1; lo = mid + 1; } else hi = mid - 1;
  }
  return res;
}

// Char ranges to skip: <script>, <style>, HTML comments. We never tag inside
// these so we don't corrupt JS/CSS or match tag-like text in comments.
function maskRanges(html) {
  const re = /<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->/gi;
  const ranges = [];
  let m;
  while ((m = re.exec(html))) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}
function inRanges(ranges, offset) {
  for (const [s, e] of ranges) if (offset >= s && offset < e) return true;
  return false;
}

function tagHtml(html, relPath) {
  const starts = buildLineStarts(html);
  const ranges = maskRanges(html);
  const fileAttr = escapeAttr(relPath);
  // Opening tag: name + attributes. The attribute group correctly skips '>'
  // characters that appear inside quoted ("..." or '...') attribute values.
  const startTag = /<([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  return html.replace(startTag, (match, name, attrs, offset) => {
    if (inRanges(ranges, offset)) return match;
    const line = lineOf(starts, offset);
    const selfClose = /\/\s*$/.test(attrs);
    const cleanAttrs = selfClose ? attrs.replace(/\/\s*$/, "") : attrs;
    const slash = selfClose ? "/" : "";
    return `<${name}${cleanAttrs} data-pi-file="${fileAttr}" data-pi-line="${line}"${slash}>`;
  });
}

async function serve(req, res) {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const fsPath = normalize(join(ROOT, urlPath));
  // Path traversal guard.
  if (fsPath !== ROOT && !fsPath.startsWith(ROOT + sep)) {
    res.writeHead(403); res.end("Forbidden"); return;
  }
  try {
    let s = await stat(fsPath);
    let filePath = fsPath;
    if (s.isDirectory()) { filePath = join(fsPath, "index.html"); await stat(filePath); }
    const isHtml = /\.html?$/i.test(filePath);
    if (isHtml) {
      const html = await readFile(filePath, "utf8");
      const rel = relative(PROJECT_ROOT, filePath).split(sep).join("/");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(tagHtml(html, rel || filePath));
    } else {
      const data = await readFile(filePath);
      const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      res.end(data);
    }
  } catch (e) {
    res.writeHead(404); res.end("Not found: " + urlPath);
  }
}

const server = http.createServer(serve);
server.listen(PORT, HOST, () => {
  console.log(`[pi-tagged] serving ${ROOT}`);
  console.log(`[pi-tagged] project root: ${PROJECT_ROOT}`);
  console.log(`[pi-tagged] http://${HOST}:${PORT}/  — elements tagged with data-pi-file / data-pi-line`);
});
