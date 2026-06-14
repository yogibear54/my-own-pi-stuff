import { defineConfig } from "vitest/config";
import { execSync } from "node:child_process";
import * as path from "node:path";

// typebox is provided by pi at runtime (not in local node_modules).
// Resolve it from the global pi installation for tests.
const globalRoot = execSync("npm root -g").toString().trim();
const piRoot = path.join(globalRoot, "@earendil-works/pi-coding-agent");

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
	},
	resolve: {
		alias: {
			typebox: path.join(piRoot, "node_modules", "typebox"),
		},
	},
});
