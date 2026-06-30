/**
 * Referral / "minion" economy service (Workstream A / Task A6).
 *
 * Recruiters earn a fraction of points whenever their minions score, creating the
 * study's privacy<->reward tension. The fraction is the key incentive-calibration
 * knob (RESEARCH_READINESS_PLAN.md §6 — to confirm with the mentor/IRB).
 */

import { randomInt } from "crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { trackEvent } from "@/lib/utils/track-event";

/** Share of a minion's score awarded to their recruiter. Calibration knob. */
export const REFERRAL_FRACTION = 0.15;

/** Points a recruiter earns from a minion's score. Pure + testable. */
export function computeReferralPoints(
  basePoints: number,
  fraction: number = REFERRAL_FRACTION
): number {
  if (!Number.isFinite(basePoints) || basePoints <= 0) return 0;
  return Math.round(basePoints * fraction);
}

/** Generate a short, human-shareable referral code. */
export function generateReferralCode(): string {
  // 8 chars, unambiguous alphabet (no 0/O/1/I). Use the OS CSPRNG so codes
  // aren't predictable — guessable codes would let someone attach as another
  // user's minion without consent and game the incentive economy.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += alphabet[randomInt(0, alphabet.length)];
  }
  return code;
}

/** Get the user's referral code, creating one if needed. */
export async function getOrCreateReferralCode(userId: string): Promise<string | null> {
  try {
    const supabase = await createSupabaseServiceClient();

    const { data: existing } = await supabase
      .from("referral_codes")
      .select("code")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing?.code) return existing.code;

    // Try a few times in case of a rare code collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateReferralCode();
      const { data, error } = await supabase
        .from("referral_codes")
        .insert({ user_id: userId, code })
        .select("code")
        .single();
      if (!error && data) return data.code;
      // Unique violation on user_id means a concurrent insert won — re-read.
      if (error?.code === "23505") {
        const { data: again } = await supabase
          .from("referral_codes")
          .select("code")
          .eq("user_id", userId)
          .maybeSingle();
        if (again?.code) return again.code;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export interface RedeemResult {
  ok: boolean;
  reason?: string;
  recruiterId?: string;
}

/** Redeem a referral code, linking the minion to the recruiter. */
export async function redeemReferral(
  minionUserId: string,
  code: string
): Promise<RedeemResult> {
  try {
    const supabase = await createSupabaseServiceClient();

    const normalized = (code || "").trim().toUpperCase();
    if (!normalized) return { ok: false, reason: "missing_code" };

    const { data: codeRow } = await supabase
      .from("referral_codes")
      .select("user_id")
      .eq("code", normalized)
      .maybeSingle();
    if (!codeRow) return { ok: false, reason: "invalid_code" };

    const recruiterId = codeRow.user_id;
    if (recruiterId === minionUserId) return { ok: false, reason: "self_referral" };

    // One recruiter per minion.
    const { data: existing } = await supabase
      .from("minion_links")
      .select("id")
      .eq("minion_id", minionUserId)
      .maybeSingle();
    if (existing) return { ok: false, reason: "already_recruited" };

    const { error } = await supabase.from("minion_links").insert({
      recruiter_id: recruiterId,
      minion_id: minionUserId,
      referral_code: normalized,
    });
    if (error) {
      if (error.code === "23505") return { ok: false, reason: "already_recruited" };
      return { ok: false, reason: "insert_failed" };
    }

    await trackEvent({
      userId: minionUserId,
      eventType: "referral_redeemed",
      payload: { recruiter_id: recruiterId, code: normalized },
    });

    return { ok: true, recruiterId };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** Award a recruiter their share when a minion scores. Fire-and-forget. */
export async function awardReferralPoints(
  minionUserId: string,
  basePoints: number,
  sourceId: string | null,
  huntId: string | null
): Promise<void> {
  try {
    const amount = computeReferralPoints(basePoints);
    if (amount <= 0) return;

    const supabase = await createSupabaseServiceClient();

    const { data: link } = await supabase
      .from("minion_links")
      .select("recruiter_id")
      .eq("minion_id", minionUserId)
      .maybeSingle();
    if (!link) return;

    await supabase.from("points_ledger").insert({
      user_id: link.recruiter_id,
      amount,
      source_type: "referral",
      source_id: sourceId,
      hunt_id: huntId,
      description: `Referral bonus from a minion's score (+${amount})`,
    });
  } catch {
    // never block the minion's own scoring flow
  }
}
