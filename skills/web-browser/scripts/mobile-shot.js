#!/usr/bin/env node
/* One-off: mobile viewport + screenshot of the landing page. */
import { connect } from "./cdp.js";
import { writeFileSync } from "fs";

const cdp = await connect(5000);
const pages = await cdp.getPages();
const page = pages.at(-1);
const sid = await cdp.attachToPage(page.targetId);

await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
}, sid);
await new Promise(r => setTimeout(r, 2500)); // let reveals settle

const shot = await cdp.screenshot(sid);
writeFileSync("/tmp/landing-mobile.png", shot);
console.log("screenshot: /tmp/landing-mobile.png");
process.exit(0);
