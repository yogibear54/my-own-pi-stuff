/**
 * Tutorial Extension
 *
 * Provides namespaced commands for creating and updating interactive
 * codebase tutorials:
 *
 * Commands:
 *   /tutorial:create <tutorial-dir> [source-code-dir]   # Create a skeleton tutorial (Pass 1)
 *   /tutorial:create                              # Interactive mode
 *   /tutorial:deep-dive <tutorial-dir> [chapter-id]  # Deep-dive expand chapters (Pass 2)
 *   /tutorial:update <tutorial-dir>                 # Detect drift & update outdated chapters
 *
 * The extension also registers tools:
 *   - configure_tutorial: Structured requirement gathering for creation
 *   - check_tutorial_drift: Detect which chapters are outdated
 *
 * Drift Detection:
 *   A chapters.json is created alongside the tutorial, recording which source files
 *   each chapter references. Drift detection uses git to compare the "Based On Commit"
 *   in README.md against the current git HEAD to detect changes.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { registerTutorialCreateCommand } from "./commands/create";
import { registerTutorialDeepDiveCommand } from "./commands/deep-dive";
import { registerTutorialUpdateCommand } from "./commands/update";
import { registerConfigureTutorialTool } from "./tools/configure";
import { registerCheckTutorialDriftTool } from "./tools/drift-check";

/**
 * Create and register the tutorial extension
 */
export default function createTutorialExtension(pi: ExtensionAPI) {
	registerTutorialCreateCommand(pi);
	registerTutorialDeepDiveCommand(pi);
	registerTutorialUpdateCommand(pi);
	registerConfigureTutorialTool(pi);
	registerCheckTutorialDriftTool(pi);
}