import { connect } from "./cdp.js";
const cdp = await connect(5000);
const pages = await cdp.getPages();
const target = pages.find(p => p.url.includes("pickachill.bulbulbuy.com"));
const sessionId = await cdp.attachToPage(target.targetId);
await cdp.send("Network.enable", {}, sessionId);

const requests = [];
cdp.on("Network.requestWillBeSent", (params, s) => {
  if (s !== sessionId) return;
  const u = params.request.url;
  if (params.request.method === "POST" || u.includes("graphql")) {
    requests.push({url: u.slice(0, 80), post: (params.request.postData || "").slice(0, 500)});
  }
});

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
  if (pos.x === undefined) return;
  for (const type of ["mousePressed", "mouseReleased"]) {
    await cdp.send("Input.dispatchMouseEvent", {type, x: pos.x, y: pos.y, button: "left", clickCount: 1}, sessionId);
  }
};
await click("6");
await new Promise(r => setTimeout(r, 1500));
requests.length = 0;
await click("5");
await new Promise(r => setTimeout(r, 3000));
console.log(JSON.stringify(requests, null, 1));
process.exit(0);
