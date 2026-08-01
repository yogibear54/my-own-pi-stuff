#!/usr/bin/env node
// Port-aware eval.js
import { connect } from "./cdp-port-aware.js";

const PORT = parseInt(process.env.CHROME_PORT || "9222");
const CODE = process.argv[2];

if (!CODE) {
  console.log("Usage: eval-port.js '<code>'");
  console.log("Set CHROME_PORT env var to choose Chrome instance (default 9222)");
  process.exit(1);
}

async function main() {
  const cdp = await connect(PORT);
  const { targetInfos } = await cdp.send("Target.getTargets");
  const target = targetInfos.find((t) => t.type === "page");
  if (!target) {
    console.error("No page target");
    process.exit(1);
  }
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  });
  await cdp.send("Runtime.enable", {}, sessionId);
  const { result, exceptionDetails } = await cdp.send(
    "Runtime.evaluate",
    {
      expression: CODE,
      returnByValue: true,
      awaitPromise: true,
    },
    sessionId,
  );
  if (exceptionDetails) {
    console.error("JS Error:", exceptionDetails.text || exceptionDetails.exception?.description);
    process.exit(1);
  }
  if (result.value === undefined) {
    console.log("(undefined)");
  } else if (typeof result.value === "string") {
    console.log(result.value);
  } else {
    console.log(JSON.stringify(result.value, null, 2));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
