/**
 * Privacy restrictiveness index (Workstream A / Tasks A3–A4).
 *
 * Mean restrictiveness across the 8 profile fields:
 *   0 = fully public (every field "everyone")
 *   1 = fully private (every field "nobody")
 *
 * Unset fields are treated as "everyone" (0), matching the enforcement default in
 * privacy.ts (canView treats an unset field as visible to everyone). This keeps the
 * measured index consistent with the visibility a viewer actually experiences.
 *
 * Pure + deterministic — unit tested without a database.
 */

import { PROFILE_FIELD_KEYS, type VisibilityLevel } from "@/lib/utils/privacy";

const RESTRICTIVENESS: Record<VisibilityLevel, number> = {
  everyone: 0,
  class: 1 / 3,
  team: 2 / 3,
  nobody: 1,
};

export function computePrivacyIndex(visibility: Record<string, string> | undefined): number {
  const vis = visibility || {};
  let sum = 0;
  for (const key of PROFILE_FIELD_KEYS) {
    sum += RESTRICTIVENESS[vis[key] as VisibilityLevel] ?? 0;
  }
  return sum / PROFILE_FIELD_KEYS.length;
}
