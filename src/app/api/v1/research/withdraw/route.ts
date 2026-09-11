import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { trackEvent } from "@/lib/utils/track-event";
import { WITHDRAWN_META_KEY } from "@/lib/utils/conditions";

/**
 * Participant withdrawal from the research study (honors the consent promise
 * "you may withdraw at any time").
 *
 * - Marks every active enrollment `withdrawn_at` = now. This excludes the user
 *   from the snapshot/survey/reengagement crons and from the research export
 *   (all filter `withdrawn_at IS NULL`), and prevents re-enrollment (the
 *   enrollment service short-circuits on an existing enrollment row).
 * - Tears down referral links involving the user so ongoing minion payouts stop
 *   (awardReferralPoints finds no link → no further credit either direction).
 *
 * The user keeps using Findamine normally; only study data collection stops.
 */
type Db = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

/**
 * Stamp `research_withdrawn_at`, confirming it survived. `users.metadata` is a
 * read-modify-write column, so a concurrent writer (a profile save, a scheme
 * choice) can clobber the key; re-reading and retrying closes that window.
 * Returns whether the key is in place.
 */
async function stampWithdrawal(supabase: Db, userId: string, now: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data } = await supabase.from("users").select("metadata").eq("id", userId).maybeSingle();
    const meta = (data?.metadata || {}) as Record<string, unknown>;
    if (typeof meta[WITHDRAWN_META_KEY] === "string") return true;
    await supabase
      .from("users")
      .update({ metadata: { ...meta, [WITHDRAWN_META_KEY]: now } })
      .eq("id", userId);
  }
  const { data } = await supabase.from("users").select("metadata").eq("id", userId).maybeSingle();
  return typeof ((data?.metadata || {}) as Record<string, unknown>)[WITHDRAWN_META_KEY] === "string";
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();
    const now = new Date().toISOString();

    // Order matters. Turning the manipulations off comes first: every storyline
    // switch reads this key (levelFromMetadata falls back once it is set), so if
    // anything below fails the participant is at worst still counted as
    // enrolled — never still manipulated. The assignment stays on record.
    const stopped = await stampWithdrawal(supabase, user.id, now);

    const { data: withdrawn } = await supabase
      .from("study_enrollments")
      .update({ withdrawn_at: now })
      .eq("user_id", user.id)
      .is("withdrawn_at", null)
      .select("id");

    // Stop referral payouts in both directions (recruiter or minion).
    await supabase.from("minion_links").delete().eq("recruiter_id", user.id);
    await supabase.from("minion_links").delete().eq("minion_id", user.id);

    await trackEvent({
      userId: user.id,
      eventType: "study_withdrawn",
      payload: { enrollments_withdrawn: (withdrawn || []).length, manipulations_stopped: stopped },
    });

    return Response.json({ ok: true, withdrawn: (withdrawn || []).length });
  } catch (error) {
    return errorResponse(error);
  }
}
