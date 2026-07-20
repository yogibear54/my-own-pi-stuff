#!/usr/bin/env node

/**
 * Sequential batch search helper for the web-search skill.
 *
 * Runs multiple queries ONE AT A TIME against the same shared Chrome tab,
 * which is the only safe way to use the web-search skill for multi-query
 * workloads. Concurrent execution would cross-contaminate results.
 *
 * Usage:
 *   batch-search.js "query one" "query two" "query three"     # duckduckgo x3
 *   batch-search.js -n 10 "query one" "query two"             # 10 results each
 *   batch-search.js --brave "query one" "query two"           # brave for all
 *
 * Each query's output is wrapped in clear begin/end delimiters so the
 * downstream consumer can split results cleanly.
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const queries = [];
let numResults = null;
let useBrave = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "-n" && args[i + 1]) {
    numResults = args[i + 1];
    i++;
  } else if (a === "--brave") {
    useBrave = true;
  } else if (!a.startsWith("-")) {
    queries.push(a);
  }
}

if (queries.length === 0) {
  console.log('Usage: batch-search.js [-n <num>] [--brave] "query 1" "query 2" ...');
  console.log("");
  console.log("Runs each query SEQUENTIALLY through search.js. Do NOT parallelise.");
  process.exit(1);
}

const searchScript = join(__dirname, "search.js");
let hadError = false;

for (let i = 0; i < queries.length; i++) {
  const q = queries[i];
  const childArgs = [searchScript, q];
  if (numResults !== null) childArgs.push("-n", String(numResults));
  if (useBrave) childArgs.push("--brave");

  console.log(`\n========== BEGIN QUERY ${i + 1}/${queries.length} ==========`);
  console.log(`Query: ${q}`);
  console.log(`=============================================\n`);

  const res = spawnSync(process.execPath, childArgs, {
    stdio: "inherit",
    env: process.env,
  });

  if (res.status !== 0) {
    hadError = true;
    console.error(`\n✗ Query ${i + 1} failed (exit ${res.status}). Aborting batch.`);
    break;
  }

  console.log(`\n========== END QUERY ${i + 1}/${queries.length} ==========\n`);
}

process.exit(hadError ? 1 : 0);
