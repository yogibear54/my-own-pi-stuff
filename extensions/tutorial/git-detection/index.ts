/**
 * Git Detection Types
 */

export type { GitChange, ChangedFile, OutdatedChapter, UpToDateChapter, DriftResult } from "../types";
export { expandTildePath, getGitCommit, getGitChanges } from "./git-commits";
export { detectDriftViaGit } from "../chapters/drift-check";