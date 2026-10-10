import { connect } from "./cdp.js";
const cdp = await connect(5000);
const pages = await cdp.getPages();
const target = pages.find(p => p.url.includes("pickachill.bulbulbuy.com"));
const sessionId = await cdp.attachToPage(target.targetId);
await cdp.send("Network.enable", {}, sessionId);
await cdp.send("Page.enable", {}, sessionId);

const reqs = [];
cdp.on("Network.requestWillBeSent", (p, s) => {
  if (s !== sessionId) return;
  if (/\.(css|js|png|svg|woff2?|ico)(\?|$)/.test(p.request.url)) return;
  if (p.request.url.includes("google-analytics") || p.request.url.includes("apis.google")) return;
  reqs.push({m: p.request.method, u: p.request.url.slice(0, 90), post: (p.request.postData || "").slice(0, 600)});
});

// wait for load to settle, then click Oct 5
await new Promise(r => setTimeout(r, 2000));
const click = async (day) => {
  const { result: r } = await cdp.send("Runtime.evaluate", {
    expression: `
      (function(){
        const el = Array.from(document.querySelectorAll("text")).find(t => t.textContent.trim() === "${day}");
        if (!el) return "{}";
        el.scrollIntoView({block: "center"});
        const b = el.getBoundingClientRect();
        return JSON.stringify({x: b.x + b.width/2, y: b.y + b.height/2});
      })()
    `,
    returnByValue: true,
  }, sessionId);
  const pos = JSON.parse(r.value);
  if (pos.x === undefined) { console.log("click failed for", day); return; }
  for (const type of ["mousePressed", "mouseReleased"]) {
    await cdp.send("Input.dispatchMouseEvent", {type, x: pos.x, y: pos.y, button: "left", clickCount: 1}, sessionId);
  }
};
await click("5");
await new Promise(r => setTimeout(r, 3500));
console.log(`captured ${reqs.length} request(s) after clicking Oct 5:`);
for (const r of reqs) {
  console.log(`\n${r.m} ${r.u}`);
  if (r.post) console.log("  POST:", r.post.slice(0, 500));
}
process.exit(0);
