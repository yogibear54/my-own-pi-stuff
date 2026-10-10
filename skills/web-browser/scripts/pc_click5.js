import { connect } from "./cdp.js";
const cdp = await connect(5000);
const pages = await cdp.getPages();
const target = pages.find(p => p.url.includes("pickachill.bulbulbuy.com"));
const sessionId = await cdp.attachToPage(target.targetId);
const expr = `
(async () => {
  const el = Array.from(document.querySelectorAll("text")).find(t => t.textContent.trim() === "5");
  if (!el) return "no svg text 5";
  let node = el;
  const chain = [];
  for (let i = 0; i < 6 && node; i++) {
    chain.push(node.tagName + (node.getAttribute && node.getAttribute("class") ? "." + String(node.getAttribute("class")).slice(0, 40) : ""));
    node = node.parentElement;
  }
  // dispatch a real click on the nearest <g> or <svg> ancestor (calendar cells are usually <g>)
  let clickTarget = el.closest("g") || el.closest("svg") || el;
  ["pointerdown","mousedown","pointerup","mouseup","click"].forEach(type => {
    clickTarget.dispatchEvent(new MouseEvent(type, {bubbles: true, cancelable: true, view: window}));
  });
  return JSON.stringify({chain, clicked: clickTarget.tagName});
})()
`;
const r = await cdp.evaluate(sessionId, expr);
console.log(r);
process.exit(0);
