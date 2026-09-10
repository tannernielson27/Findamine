/**
 * A participant's own experimental conditions (Workstream B / Task B9).
 *
 * Reads the dimensions linked to the active study and the caller's assigned
 * level on each, so the debrief can disclose the manipulations actually in
 * force instead of hard-coded copy. Pure shaping helpers are exported for
 * tests; `getParticipantConditions` does the reads. Only ever returns the
 * given user's own assignments.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";

export interface StudySummary {
  code: string;
  name: string;
}

export interface ConditionDimension {
  name: string;
  label: string;
  description: string | null;
  levels: string[];
  assigned_level: string | null;
}

export interface ParticipantConditions {
  study: StudySummary | null;
  dimensions: ConditionDimension[];
}

/** "privacy_control_complexity" → "Privacy Control Complexity". Pure. */
export function humanizeDimensionName(name: string): string {
  return name
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export interface LinkedDimensionRow {
  dimension_id: string;
  sort_order?: number | null;
  treatment_dimensions:
    | { name: string; description: string | null; levels: string[] | null }
    | { name: string; description: string | null; levels: string[] | null }[]
    | null;
}

export interface AssignmentRow {
  dimension_id: string;
  level: string;
}

function unwrap<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/** Join linked dimensions with this user's assignments, in study sort order. Pure. */
export function buildConditionDimensions(
  linked: LinkedDimensionRow[],
  assignments: AssignmentRow[]
): ConditionDimension[] {
  const levelByDim = new Map(assignments.map((a) => [a.dimension_id, a.level]));
  return [...linked]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .flatMap((row) => {
      const dim = unwrap(row.treatment_dimensions);
      if (!dim?.name) return [];
      return [
        {
          name: dim.name,
          label: humanizeDimensionName(dim.name),
          description: dim.description ?? null,
          levels: dim.levels ?? [],
          assigned_level: levelByDim.get(row.dimension_id) ?? null,
        },
      ];
    });
}

/** Active auto-enroll study's dimensions + the user's own levels. Never throws. */
export async function getParticipantConditions(userId: string): Promise<ParticipantConditions> {
  const empty: ParticipantConditions = { study: null, dimensions: [] };
  try {
    const supabase = await createSupabaseServiceClient();

    const { data: study } = await supabase
      .from("treatment_studies")
      .select("id, study_code, name")
      .eq("auto_enroll", true)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (!study) return empty;

    const { data: linked } = await supabase
      .from("treatment_study_dimensions")
      .select("dimension_id, sort_order, treatment_dimensions(name, description, levels)")
      .eq("study_id", study.id);
    const linkedRows = (linked || []) as LinkedDimensionRow[];

    const dimensionIds = linkedRows.map((r) => r.dimension_id);
    const { data: assignments } = dimensionIds.length
      ? await supabase
          .from("dimension_assignments")
          .select("dimension_id, level")
          .eq("user_id", userId)
          .in("dimension_id", dimensionIds)
      : { data: [] as AssignmentRow[] };

    return {
      study: { code: study.study_code, name: study.name },
      dimensions: buildConditionDimensions(linkedRows, assignments || []),
    };
  } catch {
    return empty;
  }
}
