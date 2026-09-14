/**
 * Descriptive class norm for storyline S5 (build plan D3, migration 062).
 *
 * The norm is the share of players in a class (roster) whose total score is
 * hidden from Everyone. Pure helpers only; the nightly computation and the
 * exposure logging live in src/lib/services/class-norms.ts.
 */

import { canViewField } from "@/lib/utils/privacy";
import { levelFromMetadata } from "@/lib/utils/conditions";

export const NORM_LINE_DIMENSION = "norm_line";
export const NORM_LINE_LEVELS = ["none", "descriptive"] as const;
export type NormLine = (typeof NORM_LINE_LEVELS)[number];

/** The profile field the norm describes. */
export const NORM_FIELD = "total_score";

/** Classes smaller than this get no statistic, so no line is shown. */
export const MIN_CLASS_SIZE = 5;

export function normLineFor(meta: Record<string, unknown> | null | undefined): NormLine {
  return levelFromMetadata(meta, NORM_LINE_DIMENSION, NORM_LINE_LEVELS, "none");
}

/** Hidden from Everyone = a stranger cannot see the field. Unset counts as visible. */
export function isHiddenFromEveryone(
  visibility: Record<string, string> | undefined,
  field: string = NORM_FIELD
): boolean {
  return !canViewField(visibility, "public", field);
}

export interface RosterEntry {
  roster_id: string;
  student_id: string;
}

export interface ClassNormStat {
  roster_id: string;
  field: string;
  n_players: number;
  n_hidden: number;
  share_hidden: number;
}

/**
 * One statistic per roster with at least `minSize` distinct players, sorted by
 * roster id. share_hidden is rounded to 4 decimals (the column's precision). Pure.
 */
export function computeClassNormStats(
  entries: readonly RosterEntry[],
  visibilityByUser: ReadonlyMap<string, Record<string, string> | undefined>,
  minSize: number = MIN_CLASS_SIZE,
  field: string = NORM_FIELD
): ClassNormStat[] {
  const byRoster = new Map<string, Set<string>>();
  for (const e of entries) {
    const set = byRoster.get(e.roster_id) ?? new Set<string>();
    set.add(e.student_id);
    byRoster.set(e.roster_id, set);
  }
  return [...byRoster.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([roster_id, students]) => {
      if (students.size < minSize) return [];
      const n_hidden = [...students].filter((id) => isHiddenFromEveryone(visibilityByUser.get(id), field)).length;
      const share_hidden = Math.round((n_hidden / students.size) * 10_000) / 10_000;
      return [{ roster_id, field, n_players: students.size, n_hidden, share_hidden }];
    });
}

/** "62% of players in your class hide their score from Everyone." Pure. */
export function normMessage(share: number): string {
  const pct = Math.round(Math.min(1, Math.max(0, share)) * 100);
  return `${pct}% of players in your class hide their score from Everyone.`;
}

/**
 * The statistic to show a participant in several classes: the most recent
 * day, then the largest class, then the lowest roster id. Pure.
 */
export function pickNormStat<T extends { roster_id: string; computed_on: string; n_players: number }>(
  stats: readonly T[]
): T | null {
  if (stats.length === 0) return null;
  return [...stats].sort(
    (a, b) =>
      b.computed_on.localeCompare(a.computed_on) ||
      b.n_players - a.n_players ||
      a.roster_id.localeCompare(b.roster_id)
  )[0];
}
