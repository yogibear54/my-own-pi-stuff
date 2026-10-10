import { connect } from "./cdp.js";
const code = process.argv.slice(2).join(" ");
if (!code) { console.log("usage: eval-uktr.js '<code>'"); process.exit(1); }
const cdp = await connect(5000);
const pages = await cdp.getPages();
const target = pages.find(p => p.url.includes("jobstoday.co.uk"));
if (!target) { console.error("no uktherapyrooms tab found"); process.exit(1); }
console.error(`# targeting ${target.url.slice(0, 70)} (${target.targetId.slice(0,8)})`);
const sessionId = await cdp.attachToPage(target.targetId);
const expr = `(async () => { return ${code}; })()`;
const r = await cdp.evaluate(sessionId, expr);
if (typeof r === 'object' && r !== null) console.log(JSON.stringify(r, null, 2));
else console.log(r);
process.exit(0);
