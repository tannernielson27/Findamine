/**
 * Privacy-index snapshot service (Workstream A / Task A4).
 *
 * Records a point on a participant's restrictiveness trajectory. Used at enrollment
 * (t0), on each settings change, and by the daily cron. Fire-and-forget — never
 * throws to callers.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { computePrivacyIndex } from "@/lib/utils/privacy-index";

export type SnapshotSource = "change" | "scheduled" | "enrollment";

/** The participant's assigned condition, denormalized onto the snapshot. */
export interface SnapshotCondition {
  /** Legacy column: privacy_control_complexity level. */
  treatment?: string | null;
  /** Legacy column: privacy_default level. */
  privacyDefault?: string | null;
  /**
   * Generic `{ dimensionName: level }` map (migration 053). Build it with
   * conditionsFromMetadata(users.metadata). Defaults to whatever the two legacy
   * fields carry so a caller that only knows those still writes a usable map.
   */
  conditions?: Record<string, string>;
  /** Per-person override pairs in force (migration 057). Defaults to 0. */
  overrideCount?: number;
}

/**
 * A visibility map with no keys is "unset" — the participant has not made any
 * privacy choice yet. This is the NEUTRAL default's t0 state, and must be
 * distinguished from a PUBLIC default (all fields "everyone"): both score index
 * 0, but only the latter is an actual choice. Pure.
 */
export function isUnset(visibility: Record<string, string> | undefined): boolean {
  return !visibility || Object.keys(visibility).length === 0;
}

/**
 * Build the row written to privacy_index_snapshots. Pure — exported so the
 * cron (which bulk-inserts) and the single-row path share one shape.
 */
export function buildSnapshotRow(
  userId: string,
  visibility: Record<string, string> | undefined,
  source: SnapshotSource,
  condition?: SnapshotCondition
) {
  const treatment = condition?.treatment ?? null;
  const privacyDefault = condition?.privacyDefault ?? null;
  return {
    user_id: userId,
    index_value: computePrivacyIndex(visibility),
    source,
    visibility: visibility || {},
    treatment,
    privacy_default: privacyDefault,
    conditions: condition?.conditions ?? legacyConditions(treatment, privacyDefault),
    unset: isUnset(visibility),
    override_count: Math.max(0, Math.floor(condition?.overrideCount ?? 0)),
  };
}

/** `{ dimension: level }` from the two legacy fields, omitting nulls. Pure. */
export function legacyConditions(
  treatment: string | null | undefined,
  privacyDefault: string | null | undefined
): Record<string, string> {
  return {
    ...(treatment ? { privacy_control_complexity: treatment } : {}),
    ...(privacyDefault ? { privacy_default: privacyDefault } : {}),
  };
}

export async function recordPrivacyIndexSnapshot(
  userId: string,
  visibility: Record<string, string> | undefined,
  source: SnapshotSource,
  condition?: SnapshotCondition
): Promise<void> {
  try {
    const supabase = await createSupabaseServiceClient();
    await supabase
      .from("privacy_index_snapshots")
      .insert(buildSnapshotRow(userId, visibility, source, condition));
  } catch {
    // telemetry must never block the caller
  }
}
