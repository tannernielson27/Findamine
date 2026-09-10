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
import { getDefaults, type VisibilityLevel } from "@/lib/utils/privacy";
import { trackEvent } from "@/lib/utils/track-event";
import { recordPrivacyIndexSnapshot } from "@/lib/services/privacy-snapshots";
import { createDueDeliveriesForUser } from "@/lib/services/survey-delivery";

export type PrivacyDefaultCondition = "private" | "neutral" | "public";
export type PrivacyFrictionCondition = "low" | "high";

const COMPLEXITY_DIMENSION = "privacy_control_complexity";
const DEFAULT_DIMENSION = "privacy_default";
const FRICTION_DIMENSION = "privacy_friction";

export interface EnrollmentResult {
  enrolled: boolean;
  treatment?: string;
  defaultCondition?: PrivacyDefaultCondition;
  frictionCondition?: PrivacyFrictionCondition;
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
  return getDefaults(ageBand, defaultCondition);
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
 * Derive the privacy_friction condition (prospectus Factor B) from named
 * dimension assignments. Pure.
 */
export function deriveFrictionCondition(
  assignments: { dimensionName: string; level: string }[]
): PrivacyFrictionCondition | undefined {
  const level = assignments.find((a) => a.dimensionName === FRICTION_DIMENSION)?.level;
  return level === "low" || level === "high" ? level : undefined;
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

    // 2b. Research-consent gate (IRB). Never assign a condition, set defaults,
    // snapshot, or collect any study data until the participant has granted
    // informed research consent. Because children cannot self-grant a 'research'
    // consent (see the consent route), gating here also excludes them from the
    // adults-only study. Consent is captured by the ConsentGate UI; the (app)
    // layout re-runs this enrollment on the next load once consent exists.
    const { data: consent } = await supabase
      .from("consent_records")
      .select("id")
      .eq("user_id", userId)
      .eq("consent_type", "research")
      .eq("granted", true)
      .is("revoked_at", null)
      .limit(1)
      .maybeSingle();
    if (!consent) return { enrolled: false };

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
    // Complexity is held constant at "moderate" when it isn't a crossed factor
    // (migration 050); the friction dimension is the prospectus's Factor B.
    const treatment = deriveTreatment(named) ?? "moderate";
    const defaultCondition = deriveDefaultCondition(named);
    const frictionCondition = deriveFrictionCondition(named);

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
    const initialVisibility = hasVisibility
      ? (existingVisibility as Record<string, string>)
      : computeInitialVisibility(ageBand, defaultCondition);

    const updates: Record<string, unknown> = {
      metadata: {
        ...(userRow?.metadata || {}),
        privacy_treatment: treatment,
        privacy_default: defaultCondition ?? null,
        privacy_friction: frictionCondition ?? null,
      },
    };
    if (!hasVisibility) {
      updates.profile_visibility = initialVisibility;
    }
    await supabase.from("users").update(updates).eq("id", userId);

    // t0 of the privacy-index trajectory, stamped with the assigned condition. A
    // neutral default yields an empty visibility map → recorded as unset (vs a
    // public default, which is a real "everyone" choice at the same index 0).
    await recordPrivacyIndexSnapshot(userId, initialVisibility, "enrollment", {
      treatment,
      privacyDefault: defaultCondition ?? null,
    });

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

    // 9. Materialize any immediately-due surveys (e.g. T1 baseline at offset 0).
    await createDueDeliveriesForUser(userId, new Date().toISOString());

    // 10. Log the enrollment event (t0 of the participant timeline).
    await trackEvent({
      userId,
      eventType: "study_enrolled",
      payload: {
        study_id: study.id,
        treatment,
        default_condition: defaultCondition,
        friction_condition: frictionCondition,
      },
    });

    return { enrolled: true, treatment, defaultCondition, frictionCondition };
  } catch {
    // Enrollment must never break registration or render.
    return { enrolled: false };
  }
}
