/**
 * Settings error: how far a participant's ACTUAL privacy settings sit from the
 * audience they say they WANT (storyline S7, migration 058), after Madejski,
 * Johnson & Bellovin (2012).
 *
 * Audience levels are ranked by restrictiveness (everyone 0 … nobody 3). The
 * error is the mean absolute rank distance over the fields present in both
 * maps, divided by the maximum distance (3), so 0 = perfect match and
 * 1 = every field maximally wrong. Pure; no I/O.
 */

export const AUDIENCE_RANK: Record<string, number> = {
  everyone: 0,
  class: 1,
  team: 2,
  nobody: 3,
};

const MAX_DISTANCE = 3;

/** Prefix of the survey item codes that carry the ideal audience per field. */
export const IDEAL_ITEM_PREFIX = "ideal_";
export const IDEAL_AUDIENCE_SUBSCALE = "ideal_audience";

export interface SettingsErrorResult {
  /** Normalized mean distance, or null when no field could be compared. */
  error: number | null;
  fields_compared: number;
  /** Fields whose actual audience is MORE public than the ideal. */
  over_shared: number;
  /** Fields whose actual audience is MORE private than the ideal. */
  under_shared: number;
}

function rankOf(level: unknown): number | undefined {
  return typeof level === "string" ? AUDIENCE_RANK[level] : undefined;
}

/** Pull `{ field: level }` out of a survey answers map from `ideal_<field>` items. */
export function idealFromAnswers(
  answers: Record<string, unknown> | null | undefined
): Record<string, string> {
  const ideal: Record<string, string> = {};
  if (!answers) return ideal;
  for (const [code, value] of Object.entries(answers)) {
    if (!code.startsWith(IDEAL_ITEM_PREFIX)) continue;
    if (rankOf(value) === undefined) continue;
    ideal[code.slice(IDEAL_ITEM_PREFIX.length)] = value as string;
  }
  return ideal;
}

export function settingsError(
  ideal: Record<string, string> | null | undefined,
  actual: Record<string, string> | null | undefined
): SettingsErrorResult {
  let sum = 0;
  let compared = 0;
  let over = 0;
  let under = 0;
  for (const [field, wanted] of Object.entries(ideal || {})) {
    const ri = rankOf(wanted);
    const ra = rankOf(actual?.[field]);
    if (ri === undefined || ra === undefined) continue;
    compared += 1;
    sum += Math.abs(ri - ra);
    if (ra < ri) over += 1;
    else if (ra > ri) under += 1;
  }
  return {
    error: compared === 0 ? null : Math.round((sum / compared / MAX_DISTANCE) * 10000) / 10000,
    fields_compared: compared,
    over_shared: over,
    under_shared: under,
  };
}

export interface TimedVisibility {
  created_at: string;
  visibility: Record<string, string> | null | undefined;
}

/**
 * The settings in force when a survey was submitted: the latest snapshot at or
 * before `at`, else the earliest one after it, else null.
 */
export function pickSnapshotAt<T extends TimedVisibility>(
  snapshots: readonly T[],
  at: string
): T | null {
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return null;
  let before: T | null = null;
  let after: T | null = null;
  for (const s of snapshots) {
    const st = new Date(s.created_at).getTime();
    if (!Number.isFinite(st)) continue;
    if (st <= t) {
      if (!before || st >= new Date(before.created_at).getTime()) before = s;
    } else if (!after || st < new Date(after.created_at).getTime()) {
      after = s;
    }
  }
  return before ?? after;
}
