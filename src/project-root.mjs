import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute directory containing the installed Skill repository. */
export const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function fromSkillRoot(...segments) {
  return resolve(SKILL_ROOT, ...segments);
}
