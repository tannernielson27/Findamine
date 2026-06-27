/**
 * Study Enrollment Service (Workstream A / Task A2)
 *
 * Auto-enrolls a participant into the active study at first authenticated load:
 * - stratified block randomization via assignParticipant() (writes dimension_assignments)
 * - derives privacy_treatment (simple/moderate/complex) and writes it to users.metadata
 * - sets initial profile_visibility from the assigned default condition (only if empty —
 *   never clobbers a returning user's existing settings)
 * - creates a study_enrollments row and bumps the study sample size
 *
 * Idempotent: safe to call on every load; short-circuits once enrolled.
 * Never throws to callers — enrollment must not break registration or page render.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { assignParticipant } from "@/lib/services/randomization";
import { getDefaults, PROFILE_FIELDS, type VisibilityLevel } from "@/lib/utils/privacy";
import { trackEvent } from "@/lib/utils/track-event";

export type PrivacyDefaultCondition = "private" | "neutral" | "public";

const COMPLEXITY_DIMENSION = "privacy_control_complexity";
const DEFAULT_DIMENSION = "privacy_default";

export interface EnrollmentResult {
  enrolled: boolean;
  treatment?: string;
  defaultCondition?: PrivacyDefaultCondition;
}

/**
 * Map an assigned privacy_default condition to an initial visibility map.
 * Pure and deterministic — unit tested without a database.
 *
 * - private  → every field "nobody"
 * - public   → every field "everyone"
 * - neutral  → empty map (no pre-selection; user must choose on first use)
 * - absent   → age-band defaults (backward compatible)
 */
export function computeInitialVisibility(
  ageBand: string,
  defaultCondition?: PrivacyDefaultCondition | null
): Record<string, VisibilityLevel> {
  if (defaultCondition === "private") {
    return Object.fromEntries(
      PROFILE_FIELDS.map((f) => [f.key, "nobody" as VisibilityLevel])
    );
  }
  if (defaultCondition === "public") {
    return Object.fromEntries(
      PROFILE_FIELDS.map((f) => [f.key, "everyone" as VisibilityLevel])
    );
  }
  if (defaultCondition === "neutral") {
    return {};
  }
  return getDefaults(ageBand);
}

/**
 * Derive the privacy_treatment value from named dimension assignments. Pure.
 */
export function deriveTreatment(
  assignments: { dimensionName: string; level: string }[]
): string | null {
  return assignments.find((a) => a.dimensionName === COMPLEXITY_DIMENSION)?.level ?? null;
}

/**
 * Derive the privacy_default condition from named dimension assignments. Pure.
 */
export function deriveDefaultCondition(
  assignments: { dimensionName: string; level: string }[]
): PrivacyDefaultCondition | undefined {
  const level = assignments.find((a) => a.dimensionName === DEFAULT_DIMENSION)?.level;
  return level === "private" || level === "neutral" || level === "public"
    ? level
    : undefined;
}

/**
 * Auto-enroll a user into the active auto-enroll study. Idempotent + safe.
 */
export async function enrollParticipant(userId: string): Promise<EnrollmentResult> {
  try {
    const supabase = await createSupabaseServiceClient();

    // 1. Find the active auto-enroll study.
    const { data: study } = await supabase
      .from("treatment_studies")
      .select("id")
      .eq("auto_enroll", true)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (!study) return { enrolled: false };

    // 2. Already enrolled? Short-circuit (keeps this cheap to call on every load).
    const { data: existing } = await supabase
      .from("study_enrollments")
      .select("id")
      .eq("study_id", study.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) return { enrolled: false };

    // 3. Study dimensions (id → name).
    const { data: studyDims } = await supabase
      .from("treatment_study_dimensions")
      .select("dimension_id, treatment_dimensions(name)")
      .eq("study_id", study.id);
    if (!studyDims || studyDims.length === 0) return { enrolled: false };

    // 4. Stratified block randomization → writes dimension_assignments.
    const result = await assignParticipant(userId, {
      studyId: study.id,
      dimensionIds: studyDims.map((d) => d.dimension_id),
      stratifyBy: ["age_band"],
      blockSize: 6,
    });

    // 5. Name the assignments, derive treatment + default condition.
    const idToName = new Map<string, string>(
      studyDims.map((d) => [
        d.dimension_id,
        (d.treatment_dimensions as unknown as { name: string })?.name ?? "",
      ])
    );
    const named = result.assignments.map((a) => ({
      dimensionName: idToName.get(a.dimensionId) ?? "",
      level: a.level,
    }));
    const treatment = deriveTreatment(named);
    const defaultCondition = deriveDefaultCondition(named);

    // 6. Current user state (age band + whether visibility already set).
    const { data: userRow } = await supabase
      .from("users")
      .select("age_band, metadata, profile_visibility")
      .eq("id", userId)
      .maybeSingle();

    const ageBand = userRow?.age_band || "intermediate";
    const existingVisibility = (userRow?.profile_visibility || {}) as Record<string, unknown>;
    const hasVisibility = Object.keys(existingVisibility).length > 0;

    // 7. Merge metadata (never overwrite other keys); set initial visibility only if empty.
    const updates: Record<string, unknown> = {
      metadata: { ...(userRow?.metadata || {}), privacy_treatment: treatment },
    };
    if (!hasVisibility) {
      updates.profile_visibility = computeInitialVisibility(ageBand, defaultCondition);
    }
    await supabase.from("users").update(updates).eq("id", userId);

    // 8. Enroll + refresh sample size.
    await supabase
      .from("study_enrollments")
      .upsert({ study_id: study.id, user_id: userId }, { onConflict: "study_id,user_id" });

    const { count } = await supabase
      .from("study_enrollments")
      .select("*", { count: "exact", head: true })
      .eq("study_id", study.id)
      .is("withdrawn_at", null);
    await supabase
      .from("treatment_studies")
      .update({ current_sample_size: count || 0 })
      .eq("id", study.id);

    // 9. Log the enrollment event (t0 of the participant timeline).
    await trackEvent({
      userId,
      eventType: "study_enrolled",
      payload: { study_id: study.id, treatment, default_condition: defaultCondition },
    });

    return { enrolled: true, treatment: treatment ?? undefined, defaultCondition };
  } catch {
    // Enrollment must never break registration or render.
    return { enrolled: false };
  }
}
