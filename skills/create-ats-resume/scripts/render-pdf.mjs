#!/usr/bin/env node
// Render one or more ATS HTML files to PDF via the connected Chrome (CDP Page.printToPDF).
//
// Usage:
//   node render-pdf.mjs <file.html> [more.html ...]
//
// Reuses the same CDP client as the web-browser skill (ws on :9222).
// Each PDF is written next to its HTML source (same basename, .pdf extension).

import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { connect } from "/home/yogibear54/.pi/agent/skills/web-browser/scripts/cdp.js";

const LOAD_WAIT_MS = 2000;
const PRINT_TIMEOUT_MS = 30000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function convert(cdp, htmlPath) {
  const url = "file://" + htmlPath;
  const outPath = htmlPath.replace(/\.html$/, ".pdf");

  console.log(`\n→ ${htmlPath}`);

  const { targetId } = await cdp.send("Target.createTarget", {
    url,
    background: true,
  });

  const sessionId = await cdp.attachToPage(targetId);

  // Give the page time to fully render (fonts, layout)
  await sleep(LOAD_WAIT_MS);

  const { data } = await cdp.send(
    "Page.printToPDF",
    {
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      scale: 1,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
    },
    sessionId,
    PRINT_TIMEOUT_MS,
  );

  const buf = Buffer.from(data, "base64");

  const head = buf.subarray(0, 5).toString();
  if (head !== "%PDF-") {
    throw new Error(`Output doesn't look like a PDF (header: ${JSON.stringify(head)})`);
  }

  writeFileSync(outPath, buf);
  console.log(`  ✓ ${outPath}  (${buf.length.toLocaleString()} bytes)`);

  await cdp.send("Target.closeTarget", { targetId });
  return { out: outPath, bytes: buf.length };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node render-pdf.mjs <file.html> [more.html ...]");
    process.exit(2);
  }

  console.log("Connecting to Chrome on :9222 ...");
  const cdp = await connect(5000);

  const results = [];
  for (const f of args) {
    try {
      const r = await convert(cdp, f);
      results.push({ file: f, ok: true, ...r });
    } catch (e) {
      console.error(`  ✗ Failed: ${e.message}`);
      results.push({ file: f, ok: false, error: e.message });
    }
  }

  cdp.close();

  console.log("\n=== Summary ===");
  for (const r of results) {
    if (r.ok) console.log(`  ✓ ${r.file}  →  ${r.out}  (${r.bytes.toLocaleString()} bytes)`);
    else console.log(`  ✗ ${r.file}  (${r.error})`);
  }

  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
