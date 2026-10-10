import { connect } from "./cdp.js";
const cdp = await connect(5000);
const pages = await cdp.getPages();
const target = pages.find(p => p.url.includes("pickachill.bulbulbuy.com"));
const sessionId = await cdp.attachToPage(target.targetId);
const seen = [];
cdp.on("Network.requestWillBeSent", (p, s) => {
  seen.push([s === sessionId ? "MINE" : "other", p.request.url.slice(0, 70)]);
});
const ok = await cdp.send("Network.enable", {}, sessionId);
console.log("enable resp:", JSON.stringify(ok).slice(0, 80));
// trigger a reload to generate traffic
await cdp.send("Page.enable", {}, sessionId);
await cdp.send("Page.reload", {}, sessionId);
await new Promise(r => setTimeout(r, 5000));
console.log("events seen:", seen.length);
for (const s of seen.slice(0, 15)) console.log(" ", s[0], s[1]);
process.exit(0);
