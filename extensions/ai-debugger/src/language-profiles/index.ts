/**
 * Language profiles public API.
 */

export { TypeScriptProfile } from "./typescript.js";
export { getProfileForFile, getProfileByName, listProfiles, detectProfiles } from "./registry.js";
export type { LanguageProfile, InstrumentationEnvelope } from "./types.js";
