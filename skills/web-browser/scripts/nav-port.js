#!/usr/bin/env node
// Port-aware nav.js - uses CHROME_PORT env var (default 9222)
import { setTimeout as wait } from "node:timers/promises";
import { connect } from "./cdp-port-aware.js";

const PORT = parseInt(process.env.CHROME_PORT || "9222");
const URL = process.argv[2];
const NEW_TAB = process.argv.includes("--new");

if (!URL) {
  console.log("Usage: nav-port.js <url> [--new]");
  console.log("Set CHROME_PORT env var to choose Chrome instance (default 9222)");
  process.exit(1);
}

async function main() {
  const cdp = await connect(PORT);

  // List existing tabs
  const { targetInfos } = await cdp.send("Target.getTargets");
  let target = targetInfos.find((t) => t.type === "page");

  if (!target || NEW_TAB) {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { targetInfos: ti2 } = await cdp.send("Target.getTargets");
    target = ti2.find((t) => t.targetId === targetId);
  }

  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  });

  await cdp.send("Page.enable", {}, sessionId);
  const navP = cdp.send("Page.navigate", { url: URL }, sessionId);
  await navP;
  await wait(1500);
  console.log(`Navigated to: ${URL} (port ${PORT})`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
