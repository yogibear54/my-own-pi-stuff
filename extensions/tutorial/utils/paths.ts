/**
 * Path & Glob Utilities
 *
 * General-purpose path manipulation and glob-to-regex conversion.
 */

/**
 * Expand a leading `~` to the user's home directory.
 */
export function expandTildePath(filePath: string): string {
	if (filePath.startsWith("~/")) {
		return filePath.replace("~", process.env.HOME || require("os").homedir());
	}
	return filePath;
}

/**
 * Infer a human-readable project name from a directory path.
 * Strips common suffixes like `-tutorial`, `-docs`, etc.
 */
export function inferProjectName(dir: string): string {
	const parts = dir.replace(/\/$/, "").split("/");
	const name = parts[parts.length - 1] || "project";
	return (
		name
			.replace(/-tutorial$|-walkthrough$|-docs$/, "")
			.replace(/_tutorial$|_walkthrough$|_docs$/, "") || "project"
	);
}

/**
 * Convert a simple glob pattern to a RegExp.
 *
 * - `*`  matches any characters except `/`
 * - `**` matches any characters including `/`
 */
export function globToRegex(pattern: string): RegExp {
	const escaped = pattern
		.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*/g, ".*")
		.replace(/\*/g, "[^/]*");
	return new RegExp(`^${escaped}$`);
}
