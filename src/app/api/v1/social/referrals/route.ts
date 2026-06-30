import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { socialLimiter } from "@/lib/utils/rate-limit";
import { getOrCreateReferralCode, redeemReferral } from "@/lib/services/referral";

// GET: my referral code, my minions, and referral points earned.
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();
    const code = await getOrCreateReferralCode(user.id);

    const { data: minions } = await supabase
      .from("minion_links")
      .select("minion_id, created_at, users:minion_id(id, display_name, avatar_url)")
      .eq("recruiter_id", user.id)
      .order("created_at", { ascending: false });

    const { data: earned } = await supabase
      .from("points_ledger")
      .select("amount")
      .eq("user_id", user.id)
      .eq("source_type", "referral");

    const referralPoints = (earned || []).reduce((sum, r) => sum + (r.amount || 0), 0);

    return Response.json({
      code,
      minions: minions || [],
      minion_count: (minions || []).length,
      referral_points: referralPoints,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// POST: redeem a referral code (become someone's minion).
export async function POST(request: NextRequest) {
  try {
    await socialLimiter.check(request);
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body = await request.json();
    if (!body.code || typeof body.code !== "string") {
      throw new ApiError(400, "code required");
    }

    const result = await redeemReferral(user.id, body.code);
    if (!result.ok) {
      const status = result.reason === "invalid_code" ? 404 : 409;
      throw new ApiError(status, result.reason || "Could not redeem code");
    }

    return Response.json({ ok: true, recruiter_id: result.recruiterId }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
