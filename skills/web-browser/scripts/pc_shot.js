import { connect } from "./cdp.js";
import { writeFileSync } from "fs";
const cdp = await connect(5000);
const pages = await cdp.getPages();
const target = pages.find(p => p.url.includes("pickachill.bulbulbuy.com"));
const sessionId = await cdp.attachToPage(target.targetId);
const resp = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
console.log("keys:", Object.keys(resp || {}));
const data = resp?.data || resp?.result?.data;
if (!data) { console.log("no data; resp:", JSON.stringify(resp).slice(0, 200)); process.exit(1); }
writeFileSync("/tmp/pickachill.png", Buffer.from(data, "base64"));
console.log("saved /tmp/pickachill.png");
process.exit(0);
