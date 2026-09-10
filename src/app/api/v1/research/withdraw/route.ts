import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { trackEvent } from "@/lib/utils/track-event";

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
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();
    const now = new Date().toISOString();

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
      payload: { enrollments_withdrawn: (withdrawn || []).length },
    });

    return Response.json({ ok: true, withdrawn: (withdrawn || []).length });
  } catch (error) {
    return errorResponse(error);
  }
}
