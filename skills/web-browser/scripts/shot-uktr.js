import { connect } from "./cdp.js";
import { writeFileSync } from "fs";
const cdp = await connect(5000);
const pages = await cdp.getPages();
const target = pages.find(p => p.url.includes("uktherapyrooms.co.uk"));
if (!target) { console.error("no uktherapyrooms tab"); process.exit(1); }
const sessionId = await cdp.attachToPage(target.targetId);
const buf = await cdp.screenshot(sessionId);
const file = "/tmp/uktr-" + Date.now() + ".png";
writeFileSync(file, buf);
console.log(file);
process.exit(0);
