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
  treatment?: string | null;
  privacyDefault?: string | null;
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

export async function recordPrivacyIndexSnapshot(
  userId: string,
  visibility: Record<string, string> | undefined,
  source: SnapshotSource,
  condition?: SnapshotCondition
): Promise<void> {
  try {
    const supabase = await createSupabaseServiceClient();
    await supabase.from("privacy_index_snapshots").insert({
      user_id: userId,
      index_value: computePrivacyIndex(visibility),
      source,
      visibility: visibility || {},
      treatment: condition?.treatment ?? null,
      privacy_default: condition?.privacyDefault ?? null,
      unset: isUnset(visibility),
    });
  } catch {
    // telemetry must never block the caller
  }
}
