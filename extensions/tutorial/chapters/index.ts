/**
 * Chapters Module
 */

export type { ChaptersIndex, ChapterEntry } from "../types";
export { loadChaptersIndex, saveChaptersIndex } from "./loader";
export { detectDriftViaGit } from "./drift-check";