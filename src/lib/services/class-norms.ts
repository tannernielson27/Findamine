/**
 * Class descriptive norms for storyline S5 (build plan D3, migration 062).
 *
 * - computeAndStoreClassNorms: nightly, one class_norm_stats row per class
 *   with enough players (see MIN_CLASS_SIZE).
 * - serveNormExposure: the privacy page asks for the line; descriptive-arm
 *   participants in a class with a statistic get it, and the rendering is
 *   logged as a norm_exposures row whose id the next save carries.
 * - ownsNormExposure: validates that stamped exposure ids are the caller's.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { conditionsFromMetadata } from "@/lib/utils/conditions";
import { trackEvent } from "@/lib/utils/track-event";
import {
  computeClassNormStats,
  normLineFor,
  normMessage,
  pickNormStat,
  NORM_FIELD,
  type NormLine,
  type RosterEntry,
} from "@/lib/utils/class-norms";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_CHUNK = 500;

export interface ClassNormRunResult {
  rosters: number;
  written: number;
  skipped_small: number;
}

/** Compute today's per-class share and upsert it. Throws on a failed write. */
export async function computeAndStoreClassNorms(computedOn: string): Promise<ClassNormRunResult> {
  const supabase = await createSupabaseServiceClient();

  const { data: rosters } = await supabase.from("rosters").select("id").is("deleted_at", null);
  const rosterIds = (rosters || []).map((r) => r.id as string);
  if (rosterIds.length === 0) return { rosters: 0, written: 0, skipped_small: 0 };

  const { data: entryRows } = await supabase
    .from("roster_entries")
    .select("roster_id, student_id")
    .in("roster_id", rosterIds);
  const entries = (entryRows || []) as RosterEntry[];
  const rostersWithPlayers = new Set(entries.map((e) => e.roster_id)).size;

  const studentIds = [...new Set(entries.map((e) => e.student_id))];
  const visibilityByUser = new Map<string, Record<string, string> | undefined>();
  for (let i = 0; i < studentIds.length; i += USER_CHUNK) {
    const { data: users } = await supabase
      .from("users")
      .select("id, profile_visibility")
      .in("id", studentIds.slice(i, i + USER_CHUNK));
    for (const u of users || []) {
      visibilityByUser.set(u.id as string, (u.profile_visibility ?? undefined) as Record<string, string> | undefined);
    }
  }

  const rows = computeClassNormStats(entries, visibilityByUser).map((s) => ({ ...s, computed_on: computedOn }));
  if (rows.length > 0) {
    const { error } = await supabase
      .from("class_norm_stats")
      .upsert(rows, { onConflict: "roster_id,computed_on,field" });
    if (error) throw new Error(`class_norm_stats upsert failed: ${error.message}`);
  }
  return { rosters: rostersWithPlayers, written: rows.length, skipped_small: rostersWithPlayers - rows.length };
}

export interface NormExposureResult {
  type: NormLine;
  norm: { message: string; share: number } | null;
  exposure_id: string | null;
  /** Why a descriptive-arm participant saw no line. */
  reason?: "no_class" | "no_class_stat";
}

/**
 * The norm line for one participant, logging the exposure when one is shown.
 * A descriptive-arm participant with no class statistic gets no line and a
 * `norm_unavailable` research event, so non-exposure is visible in the data.
 */
export async function serveNormExposure(userId: string, context: string): Promise<NormExposureResult> {
  const supabase = await createSupabaseServiceClient();

  const { data: user } = await supabase.from("users").select("metadata").eq("id", userId).maybeSingle();
  const meta = (user?.metadata || {}) as Record<string, unknown>;
  const type = normLineFor(meta);
  if (type === "none") return { type, norm: null, exposure_id: null };

  const unavailable = async (reason: "no_class" | "no_class_stat"): Promise<NormExposureResult> => {
    await trackEvent({ userId, eventType: "research", eventName: "norm_unavailable", payload: { reason, context } });
    return { type, norm: null, exposure_id: null, reason };
  };

  const { data: mine } = await supabase.from("roster_entries").select("roster_id").eq("student_id", userId);
  const rosterIds = [...new Set((mine || []).map((r) => r.roster_id as string))];
  if (rosterIds.length === 0) return unavailable("no_class");

  const { data: stats } = await supabase
    .from("class_norm_stats")
    .select("id, roster_id, computed_on, n_players, share_hidden")
    .in("roster_id", rosterIds)
    .eq("field", NORM_FIELD)
    .order("computed_on", { ascending: false })
    .limit(50);
  const stat = pickNormStat(
    (stats || []) as { id: string; roster_id: string; computed_on: string; n_players: number; share_hidden: number }[]
  );
  if (!stat) return unavailable("no_class_stat");

  const share = Number(stat.share_hidden);
  const message = normMessage(share);
  const { data: exposure, error } = await supabase
    .from("norm_exposures")
    .insert({
      user_id: userId,
      norm_type: "descriptive",
      content_shown: message,
      context,
      roster_id: stat.roster_id,
      norm_stat_id: stat.id,
      share_shown: share,
      conditions: conditionsFromMetadata(meta),
    })
    .select("id")
    .single();
  if (error || !exposure) throw new Error(`norm_exposures insert failed: ${error?.message ?? "no row"}`);

  return { type, norm: { message, share }, exposure_id: exposure.id as string };
}

/** Whether `exposureId` is a norm_exposures row belonging to `userId`. Never throws. */
export async function ownsNormExposure(userId: string, exposureId: unknown): Promise<boolean> {
  if (typeof exposureId !== "string" || !UUID_RE.test(exposureId)) return false;
  try {
    const supabase = await createSupabaseServiceClient();
    const { data } = await supabase
      .from("norm_exposures")
      .select("id")
      .eq("id", exposureId)
      .eq("user_id", userId)
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}
