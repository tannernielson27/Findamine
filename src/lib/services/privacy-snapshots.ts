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

export async function recordPrivacyIndexSnapshot(
  userId: string,
  visibility: Record<string, string> | undefined,
  source: SnapshotSource
): Promise<void> {
  try {
    const supabase = await createSupabaseServiceClient();
    await supabase.from("privacy_index_snapshots").insert({
      user_id: userId,
      index_value: computePrivacyIndex(visibility),
      source,
      visibility: visibility || {},
    });
  } catch {
    // telemetry must never block the caller
  }
}
