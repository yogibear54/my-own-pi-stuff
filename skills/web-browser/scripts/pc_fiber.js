import { connect } from "./cdp.js";
const cdp = await connect(5000);
const pages = await cdp.getPages();
const target = pages.find(p => p.url.includes("pickachill.bulbulbuy.com"));
const sessionId = await cdp.attachToPage(target.targetId);
const { result: r } = await cdp.send("Runtime.evaluate", {
  expression: `
    (function(){
      const out = {};
      for (const want of ["19:00", "21:00", "18:00"]) {
        const el = Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === want);
        if (!el) { out[want] = "not found"; continue; }
        const fk = Object.keys(el).find(k => k.startsWith("__reactFiber$"));
        if (!fk) { out[want] = "no fiber"; continue; }
        let f = el[fk];
        const trail = [];
        for (let i = 0; i < 8 && f; i++) {
          if (f.memoizedProps && typeof f.memoizedProps === "object") {
            const keys = Object.keys(f.memoizedProps);
            trail.push({depth: i, propKeys: keys.slice(0, 12)});
            // look for a prop that looks like slot data
            for (const k of keys) {
              const v = f.memoizedProps[k];
              if (v && typeof v === "object" && (k.toLowerCase().includes("slot") || k.toLowerCase().includes("experience") || k.toLowerCase().includes("instance") || k.toLowerCase().includes("item"))) {
                out[want + ":" + k] = JSON.stringify(v).slice(0, 700);
              }
            }
          }
          f = f.return;
        }
        out[want + "_trail"] = trail;
      }
      return JSON.stringify(out);
    })()
  `,
  returnByValue: true,
}, sessionId);
console.log(r.value);
process.exit(0);
