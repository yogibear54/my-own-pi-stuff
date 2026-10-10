import { connect } from "./cdp.js";
import { writeFileSync } from "fs";
const day = process.argv[2] || "5";
const cdp = await connect(5000);
const pages = await cdp.getPages();
const target = pages.find(p => p.url.includes("pickachill.bulbulbuy.com"));
const sessionId = await cdp.attachToPage(target.targetId);

// scroll the day-`day` svg text into view and click it with real mouse events
const { result: r1 } = await cdp.send("Runtime.evaluate", {
  expression: `
    (function(){
      const el = Array.from(document.querySelectorAll("text")).find(t => t.textContent.trim() === "${day}");
      if (!el) return JSON.stringify({err: "no svg text"});
      el.scrollIntoView({block: "center"});
      const r = el.getBoundingClientRect();
      return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2});
    })()
  `,
  returnByValue: true,
}, sessionId);
const pos = JSON.parse(r1.value);
if (pos.err) { console.log(pos.err); process.exit(1); }
await new Promise(res => setTimeout(res, 300));
for (const type of ["mousePressed", "mouseReleased"]) {
  await cdp.send("Input.dispatchMouseEvent", {
    type, x: pos.x, y: pos.y, button: "left", clickCount: 1,
  }, sessionId);
}
await new Promise(res => setTimeout(res, 800));
const r2 = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
writeFileSync("/tmp/pickachill2.png", Buffer.from(r2.data, "base64"));
console.log(`clicked ${day} at ${Math.round(pos.x)},${Math.round(pos.y)}; screenshot saved`);
process.exit(0);
