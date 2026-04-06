/**
 * Tutorial Extension — Entry Point
 *
 * Provides namespaced commands for creating and updating interactive
 * codebase tutorials:
 *
 * Commands:
 *   /tutorial:create <tutorial-dir> [source-code-dir]     - Create a skeleton tutorial (Pass 1)
 *   /tutorial:create                                        - Interactive mode
 *   /tutorial:deep-dive <tutorial-dir> [chapter-id]        - Deep-dive expand chapters (Pass 2)
 *   /tutorial:update <tutorial-dir>                         - Detect drift & update outdated chapters
 *
 * Tools:
 *   configure_tutorial    - Structured requirement gathering for creation
 *   check_tutorial_drift  - Detect which chapters are outdated
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execSync } from "node:child_process";
import { getActiveDeepDiveSession } from "./constants.js";

// Commands
import { registerTutorialCreateCommand } from "./commands/create.js";
import { registerTutorialDeepDiveCommand } from "./commands/deep-dive.js";
import { registerTutorialUpdateCommand } from "./commands/update.js";

// Tools
import { registerConfigureTutorialTool } from "./tools/configure.js";
import { registerCheckTutorialDriftTool } from "./tools/check-drift.js";

export default function createTutorialExtension(pi: ExtensionAPI) {
	// Register commands
	registerTutorialCreateCommand(pi);
	registerTutorialDeepDiveCommand(pi);
	registerTutorialUpdateCommand(pi);

	// Register tools
	registerConfigureTutorialTool(pi);
	registerCheckTutorialDriftTool(pi);

	// Clean up tmux deep-dive sessions on shutdown
	pi.on("session_shutdown", async () => {
		const session = getActiveDeepDiveSession();
		if (session) {
			try {
				execSync(`tmux kill-session -t ${session.sessionName} 2>/dev/null`, {
					stdio: ["pipe", "pipe", "pipe"],
				});
			} catch {
				// Session may already be gone
			}
		}
	});
}
