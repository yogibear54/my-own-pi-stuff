import { connect } from "./cdp.js";
import { writeFileSync } from "fs";

const cdp = await connect(5000);
const pages = await cdp.getPages();
const target = pages.find(p => p.url.includes("employers.indeed.com"));
if (!target) { console.error("no indeed tab"); process.exit(1); }
const sessionId = await cdp.attachToPage(target.targetId);

const TEXT = `SELF-EMPLOYED HAIR STYLISTS - A NEW OPPORTUNITY TO EARN MORE

Are you an experienced, ambitious hair stylist looking for freedom, flexibility and the opportunity to increase your income?

Join Rainbow Connection Professional Unisex Hair Salon, an established salon with a reputation for specialist hair services.

As a self-employed stylist, you can enjoy the flexibility to choose your own working days and hours, while building your own clientele.

But we can offer you more than just a chair...

LEARN SPECIALIST SKILLS & OPEN UP NEW INCOME STREAMS
We can provide opportunities to learn and develop specialist services that are not offered by every salon, including:

- Japanese Thermal Permanent Hair Straightening
- Specialist Hair Loss Solutions
- Advanced Chemical Hair Services & Treatments

These specialist skills can help you attract new clients, higher-value appointments and additional income - all while continuing to work on a self-employed basis and around the hours that suit you.

YOUR SKILLS. YOUR CLIENTS. YOUR EARNING POTENTIAL.
Whether you want to increase your existing income or develop a new specialist area within hairdressing, this could be an exciting opportunity to take your career further.

If you are professional, motivated and keen to learn, we would love to hear from you.

Rainbow Connection Professional Unisex Hair Salon
129 Hereford Road, Shrewsbury SY3 7QZ
WhatsApp 07968065525
www.rainbowconnectionsalon.co.uk

Message us today to find out more about joining us.`;

async function key(keyName, code, vk, mods = {}) {
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown", key: keyName, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...mods,
  }, sessionId, 15000);
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp", key: keyName, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
  }, sessionId, 15000);
}

// 1. focus the editor
await cdp.evaluate(sessionId, `(() => { var ce = document.querySelector("[contenteditable=true]"); ce.focus(); var r = document.createRange(); r.selectNodeContents(ce); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); return document.activeElement === ce; })()`);

// 2. Ctrl+A then Delete
await key("a", "KeyA", 65, { control: true, modifiers: 2 });
await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Delete", code: "Delete", windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 }, sessionId, 15000);
await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Delete", code: "Delete", windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 }, sessionId, 15000);
await new Promise(r => setTimeout(r, 300));

// 3. type the text: insertText per line, Enter between lines
const lines = TEXT.split("\n");
let i = 0;
for (const line of lines) {
  if (line.length > 0) {
    await cdp.send("Input.insertText", { text: line }, sessionId, 15000);
  }
  i++;
  if (i < lines.length) {
    await key("Enter", "Enter", 13);
    await new Promise(r => setTimeout(r, 25));
  }
  if (i % 8 === 0) console.error(`  ...${i}/${lines.length} lines`);
}
console.error(`typed ${lines.length} lines`);

// 4. verify
const len = await cdp.evaluate(sessionId, `(() => { var ce = document.querySelector("[contenteditable=true]"); return ce.textContent.length; })()`);
console.error("editor length now: " + len);

const buf = await cdp.screenshot(sessionId);
const file = "/tmp/indeed-desc-" + Date.now() + ".png";
writeFileSync(file, buf);
console.log(file);
process.exit(0);
