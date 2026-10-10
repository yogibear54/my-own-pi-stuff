import { connect } from "./cdp.js";
import { writeFileSync } from "fs";
const cdp = await connect(5000);
const pages = await cdp.getPages();
const target = pages.find(p => p.url.includes("pickachill.bulbulbuy.com"));
const sessionId = await cdp.attachToPage(target.targetId);

// collect every HH:MM element + disabled signals, evening focus
const { result: r1 } = await cdp.send("Runtime.evaluate", {
  expression: `
    (function(){
      const els = Array.from(document.querySelectorAll("button, [role=button]")).filter(function(b){
        return /^([01]\\d|2[0-3]):[03]0$/.test(b.textContent.trim());
      });
      return JSON.stringify(els.map(function(b){
        const cs = getComputedStyle(b);
        return {
          t: b.textContent.trim(),
          disabled: b.disabled || b.getAttribute("aria-disabled") === "true",
          opacity: cs.opacity,
          pointerEvents: cs.pointerEvents,
          clsHasDis: (b.className||"").toString().indexOf("disabled") >= 0
        };
      }));
    })()
  `,
  returnByValue: true,
}, sessionId);
const slots = JSON.parse(r1.value);
console.log(JSON.stringify(slots.filter(s => parseInt(s.t) >= 18), null, 0));

// scroll evening into view + screenshot
await cdp.send("Runtime.evaluate", {
  expression: `
    (function(){
      const el = Array.from(document.querySelectorAll("button")).find(function(b){ return b.textContent.trim() === "18:00"; });
      if (el) el.scrollIntoView({block: "center"});
      return "ok";
    })()
  `,
}, sessionId);
await new Promise(r => setTimeout(r, 400));
const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
writeFileSync("/tmp/pickachill_slots.png", Buffer.from(shot.data, "base64"));
console.log("screenshot saved");
process.exit(0);
