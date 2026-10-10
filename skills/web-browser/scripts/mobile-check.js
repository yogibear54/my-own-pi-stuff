#!/usr/bin/env node
/* One-off: verify landing mobile top margin + h1 reveal end-state. */
import { connect } from "./cdp.js";
import { writeFileSync } from "fs";

const cdp = await connect(5000);
const pages = await cdp.getPages();
const page = pages.at(-1);
const sid = await cdp.attachToPage(page.targetId);

await cdp.send("Page.enable", {}, sid);
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
}, sid);
await cdp.navigate(sid, "http://127.0.0.1:8899/");
await new Promise(r => setTimeout(r, 3000)); // let reveals finish

const m = await cdp.evaluate(sid, `(() => {
  const pill = document.querySelector(".nav-pill").getBoundingClientRect();
  const h1 = document.querySelector(".hero h1").getBoundingClientRect();
  const cs = getComputedStyle(document.querySelector(".hero h1"));
  return {
    pillBottom: pill.bottom,
    h1Top: h1.top,
    gap: h1.top - pill.bottom,
    h1Opacity: cs.opacity,
    h1Filter: cs.filter,
    h1Transform: cs.transform,
    h1InView: !!document.querySelector(".hero h1.reveal.in"),
  };
})()`, sid);
console.log(JSON.stringify(m, null, 2));

const shot = await cdp.screenshot(sid);
writeFileSync("/tmp/landing-mobile.png", shot);
console.log("screenshot: /tmp/landing-mobile.png");
process.exit(0);
