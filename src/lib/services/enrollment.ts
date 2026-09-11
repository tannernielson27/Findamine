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
 * A failure is NOT silent, though (B7): it is console.error'd, written to
 * behavioral_events as research/study_enrollment_failed with the stage reached,
 * and surfaced on the research dashboard as `enrollment_failures_7d`.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { assignParticipant } from "@/lib/services/randomization";
import { getDefaults, type VisibilityLevel } from "@/lib/utils/privacy";
import { trackEvent } from "@/lib/utils/track-event";
import { recordPrivacyIndexSnapshot } from "@/lib/services/privacy-snapshots";
import { createDueDeliveriesForUser } from "@/lib/services/survey-delivery";
import { conditionsFromMetadata } from "@/lib/utils/conditions";

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
  /** Set when enrollment threw; the error message (never rethrown to callers). */
  error?: string;
}

/** Ordered steps of enrollParticipant, recorded on failure as the stage reached. */
export type EnrollmentStage =
  | "init"
  | "find_study"
  | "check_existing"
  | "check_consent"
  | "load_dimensions"
  | "randomize"
  | "derive_conditions"
  | "load_user"
  | "write_user"
  | "snapshot_t0"
  | "write_enrollment"
  | "update_sample_size"
  | "schedule_surveys"
  | "track_event";

/** Event written to behavioral_events when enrollment throws. */
export const ENROLLMENT_FAILED_EVENT = {
  eventType: "research",
  eventName: "study_enrollment_failed",
} as const;

export interface EnrollmentFailure {
  message: string;
  stage: EnrollmentStage;
  study_id?: string;
}

/**
 * Normalize a thrown value + the stage reached into the failure payload that is
 * logged and persisted. Pure.
 */
export function describeEnrollmentFailure(
  err: unknown,
  stage: EnrollmentStage,
  studyId?: string | null
): EnrollmentFailure {
  const message = errorMessage(err) || "Unknown enrollment error";
  return { message, stage, ...(studyId ? { study_id: studyId } : {}) };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err) ?? "";
  } catch {
    return String(err);
  }
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
  // Last step reached, reported on failure so a researcher can tell a
  // randomization bug from a survey-scheduling bug without a stack trace.
  let stage: EnrollmentStage = "init";
  let studyId: string | null = null;
  try {
    const supabase = await createSupabaseServiceClient();

    // 1. Find the active auto-enroll study.
    stage = "find_study";
    const { data: study } = await supabase
      .from("treatment_studies")
      .select("id")
      .eq("auto_enroll", true)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (!study) return { enrolled: false };
    studyId = study.id;

    // 2. Already enrolled? Short-circuit (keeps this cheap to call on every load).
    stage = "check_existing";
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
    stage = "check_consent";
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

    // 3. Study dimensions (id → name) + per-study level subsets (migration 052).
    stage = "load_dimensions";
    const { data: studyDims } = await supabase
      .from("treatment_study_dimensions")
      .select("dimension_id, active_levels, treatment_dimensions(name)")
      .eq("study_id", study.id);
    if (!studyDims || studyDims.length === 0) return { enrolled: false };

    // 4. Stratified block randomization → writes dimension_assignments.
    stage = "randomize";
    const result = await assignParticipant(userId, {
      studyId: study.id,
      dimensionIds: studyDims.map((d) => d.dimension_id),
      activeLevels: Object.fromEntries(
        studyDims.map((d) => [d.dimension_id, (d.active_levels as string[] | null) ?? null])
      ),
      stratifyBy: ["age_band"],
      blockSize: 6,
    });

    // 5. Name the assignments, derive treatment + default condition.
    stage = "derive_conditions";
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
    stage = "load_user";
    const { data: userRow } = await supabase
      .from("users")
      .select("metadata, profile_visibility")
      .eq("id", userId)
      .maybeSingle();
    // The age band lives on user_profiles.effective_band; `users` has no such
    // column. Selecting one there fails the whole query in PostgREST, which
    // this code would have read as "no user" — silently discarding the
    // participant's existing metadata on the merge below.
    const { data: profileRow } = await supabase
      .from("user_profiles")
      .select("effective_band")
      .eq("user_id", userId)
      .maybeSingle();

    const ageBand = profileRow?.effective_band || "intermediate";
    const existingVisibility = (userRow?.profile_visibility || {}) as Record<string, unknown>;
    const hasVisibility = Object.keys(existingVisibility).length > 0;

    // 7. Merge metadata (never overwrite other keys); set initial visibility only if empty.
    const initialVisibility = hasVisibility
      ? (existingVisibility as Record<string, string>)
      : computeInitialVisibility(ageBand, defaultCondition);

    // Every assigned dimension is also written generically as `dim_<name>` so a
    // newly crossed factor reaches the `conditions` map (migration 053) with no
    // code change; the three legacy keys stay for existing readers.
    const metadata: Record<string, unknown> = {
      ...(userRow?.metadata || {}),
      ...dimensionMetadataKeys(named),
      privacy_treatment: treatment,
      privacy_default: defaultCondition ?? null,
      privacy_friction: frictionCondition ?? null,
    };
    const updates: Record<string, unknown> = { metadata };
    if (!hasVisibility) {
      updates.profile_visibility = initialVisibility;
    }
    stage = "write_user";
    await supabase.from("users").update(updates).eq("id", userId);

    // t0 of the privacy-index trajectory, stamped with the assigned condition. A
    // neutral default yields an empty visibility map → recorded as unset (vs a
    // public default, which is a real "everyone" choice at the same index 0).
    stage = "snapshot_t0";
    await recordPrivacyIndexSnapshot(userId, initialVisibility, "enrollment", {
      treatment,
      privacyDefault: defaultCondition ?? null,
      conditions: conditionsFromMetadata(metadata),
    });

    // 8. Enroll + refresh sample size.
    stage = "write_enrollment";
    await supabase
      .from("study_enrollments")
      .upsert({ study_id: study.id, user_id: userId }, { onConflict: "study_id,user_id" });

    stage = "update_sample_size";
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
    stage = "schedule_surveys";
    await createDueDeliveriesForUser(userId, new Date().toISOString());

    // 10. Log the enrollment event (t0 of the participant timeline).
    stage = "track_event";
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
  } catch (err) {
    // Enrollment must never break registration or render — but it must never
    // fail silently either (B7): log it, persist it, and surface it on the
    // research dashboard.
    const failure = describeEnrollmentFailure(err, stage, studyId);
    console.error(
      `[enrollment] study enrollment failed for user ${userId} at stage "${failure.stage}": ${failure.message}`
    );
    await trackEvent({
      userId,
      eventType: ENROLLMENT_FAILED_EVENT.eventType,
      eventName: ENROLLMENT_FAILED_EVENT.eventName,
      payload: { ...failure },
    });
    return { enrolled: false, error: failure.message };
  }
}

/**
 * `dim_<dimension name>` → level for every named assignment. Pure. This is the
 * generic metadata convention conditionsFromMetadata() reads back.
 */
export function dimensionMetadataKeys(
  assignments: { dimensionName: string; level: string }[]
): Record<string, string> {
  return Object.fromEntries(
    assignments.filter((a) => a.dimensionName).map((a) => [`dim_${a.dimensionName}`, a.level])
  );
}
