import { connect } from "./cdp.js";
const day = process.argv[2] || "5";
const cdp = await connect(5000);
const pages = await cdp.getPages();
const target = pages.find(p => p.url.includes("pickachill.bulbulbuy.com"));
const sessionId = await cdp.attachToPage(target.targetId);
// 1. find the svg text for the day and get its screen rect
const { result: rect } = await cdp.send("Runtime.evaluate", {
  expression: `
    (function(){
      const el = Array.from(document.querySelectorAll("text")).find(t => t.textContent.trim() === "${day}");
      if (!el) return JSON.stringify({err: "no text ${day}"});
      const r = el.getBoundingClientRect();
      return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2});
    })()
  `,
  returnByValue: true,
}, sessionId);
const pos = JSON.parse(rect.value);
if (pos.err) { console.log(pos.err); process.exit(1); }
// 2. real mouse click sequence
for (const type of ["mousePressed", "mouseReleased"]) {
  await cdp.send("Input.dispatchMouseEvent", {
    type, x: pos.x, y: pos.y,
    button: "left", clickCount: 1,
  }, sessionId);
}
console.log(`clicked day ${day} at ${Math.round(pos.x)},${Math.round(pos.y)}`);
process.exit(0);
