import os from "node:os";
import path from "node:path";

/**
 * Normalize directory path references passed by users.
 * Supports "@dir", "~/dir", absolute, and relative paths.
 */
export function resolveDirectoryReference(input: string, cwd: string = process.cwd()): string {
	let resolved = input.trim();

	// Support IDE-style path references like "@tutorial/my-dir"
	if (resolved.startsWith("@")) {
		resolved = resolved.slice(1);
	}

	// Strip wrapping quotes from copied paths
	if (
		(resolved.startsWith("\"") && resolved.endsWith("\"")) ||
		(resolved.startsWith("'") && resolved.endsWith("'"))
	) {
		resolved = resolved.slice(1, -1);
	}

	if (resolved === "~") {
		return os.homedir();
	}

	if (resolved.startsWith("~/")) {
		return path.resolve(path.join(os.homedir(), resolved.slice(2)));
	}

	if (!path.isAbsolute(resolved)) {
		return path.resolve(cwd, resolved);
	}

	return path.resolve(resolved);
}
