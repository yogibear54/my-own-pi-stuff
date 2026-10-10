import { connect } from "./cdp.js";
const code = process.argv.slice(2).join(" ");
if (!code) { console.log("usage: eval-pickachill.js '<code>'"); process.exit(1); }
const cdp = await connect(5000);
const pages = await cdp.getPages();
const target = pages.find(p => p.url.includes("pickachill.bulbulbuy.com")) || pages.at(-1);
console.error(`# targeting ${target.url.slice(0, 70)}`);
const sessionId = await cdp.attachToPage(target.targetId);
const expr = `(async () => { return ${code}; })()`;
const r = await cdp.evaluate(sessionId, expr);
if (typeof r === 'object' && r !== null) console.log(JSON.stringify(r, null, 2));
else console.log(r);
process.exit(0);
