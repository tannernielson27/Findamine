import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { socialLimiter } from "@/lib/utils/rate-limit";
import { getOrCreateReferralCode, redeemReferral, isDisclosureEligible } from "@/lib/services/referral";
import { filterProfileForViewer } from "@/lib/utils/privacy";
import { getViewerRelationships } from "@/lib/utils/viewer";

type EmbeddedUser = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_visibility?: Record<string, string>;
};

// Supabase types an embedded FK join as an array even for to-one relations.
// Normalize to a single object (or null) to match the runtime shape.
function asUser(embed: unknown): EmbeddedUser | null {
  const v = Array.isArray(embed) ? embed[0] : embed;
  return (v ?? null) as EmbeddedUser | null;
}

// GET: my referral code, my minions, my recruiter, points earned, and a recent
// earnings feed. Read-only surfacing of the A6 economy — no mechanics changed.
// Embedded counterpart names are run through filterProfileForViewer so A5
// profile-field enforcement stays intact.
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();
    const code = await getOrCreateReferralCode(user.id);

    const { data: minionRows } = await supabase
      .from("minion_links")
      .select("minion_id, created_at, users:minion_id(id, display_name, avatar_url, profile_visibility)")
      .eq("recruiter_id", user.id)
      .order("created_at", { ascending: false });

    const { data: recruiterRow } = await supabase
      .from("minion_links")
      .select("recruiter_id, created_at, users:recruiter_id(id, display_name, avatar_url, profile_visibility)")
      .eq("minion_id", user.id)
      .maybeSingle();

    // Privacy-enforce all embedded counterparts using the real relationship.
    const counterpartIds = [
      ...(minionRows || []).map((r) => asUser(r.users)?.id),
      asUser(recruiterRow?.users)?.id,
    ].filter((id): id is string => Boolean(id));
    const rels = await getViewerRelationships(user.id, counterpartIds);

    const present = (u: EmbeddedUser | null) => {
      if (!u?.id) return null;
      const rel = rels.get(u.id) ?? "public";
      return { id: u.id, ...filterProfileForViewer(u, rel) };
    };

    const minions = (minionRows || []).map((r) => ({
      created_at: r.created_at,
      user: present(asUser(r.users)),
    }));

    const recruiter = recruiterRow
      ? { created_at: recruiterRow.created_at, user: present(asUser(recruiterRow.users)) }
      : null;

    const { data: ledger } = await supabase
      .from("points_ledger")
      .select("amount, created_at, description")
      .eq("user_id", user.id)
      .eq("source_type", "referral")
      .order("created_at", { ascending: false });

    const referralPoints = (ledger || []).reduce((sum, r) => sum + (r.amount || 0), 0);
    const recentEarnings = (ledger || []).slice(0, 8);

    // Disclosure gate status + what hiding has cost so far (forfeited bonuses
    // are tracked as behavioral events, not paid) — the felt cost of privacy.
    const { data: me } = await supabase
      .from("users")
      .select("profile_visibility")
      .eq("id", user.id)
      .maybeSingle();
    const disclosureEligible = isDisclosureEligible(
      me?.profile_visibility as Record<string, string> | undefined
    );

    const { data: forfeits } = await supabase
      .from("behavioral_events")
      .select("payload")
      .eq("user_id", user.id)
      .eq("event_type", "referral_bonus_forfeited");
    const forfeitedPoints = (forfeits || []).reduce((sum, r) => {
      const amount = (r.payload as { amount?: number } | null)?.amount;
      return sum + (typeof amount === "number" ? amount : 0);
    }, 0);

    return Response.json({
      code,
      minions,
      minion_count: minions.length,
      recruiter,
      referral_points: referralPoints,
      recent_earnings: recentEarnings,
      disclosure_eligible: disclosureEligible,
      forfeited_points: forfeitedPoints,
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
