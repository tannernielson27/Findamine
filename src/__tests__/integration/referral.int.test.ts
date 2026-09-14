import { describe, it, expect, vi, beforeEach } from "vitest";
import { installDouble, type SupabaseDouble } from "@/__tests__/support/supabase-double";

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return {
    createSupabaseServiceClient: async () => m.current().client,
    createSupabaseServerClient: async () => m.current().client,
  };
});

import { redeemReferral, awardReferralPoints, REFERRAL_FRACTION } from "@/lib/services/referral";

const VISIBLE = { display_name: "everyone", total_score: "class" };

describe("referral economy against the Supabase double", () => {
  let db: SupabaseDouble;
  beforeEach(() => {
    db = installDouble({
      users: [
        { id: "rec", profile_visibility: { ...VISIBLE }, metadata: {} },
        { id: "rec2", profile_visibility: { ...VISIBLE }, metadata: {} },
        { id: "min", profile_visibility: {}, metadata: {} },
      ],
      referral_codes: [
        { user_id: "rec", code: "ABCD2345" },
        { user_id: "rec2", code: "WXYZ6789" },
      ],
      minion_links: [],
    });
  });

  it("links a minion to the recruiter once, case-insensitively, and never to themselves", async () => {
    expect(await redeemReferral("rec", "ABCD2345")).toEqual({ ok: false, reason: "self_referral" });
    expect(await redeemReferral("min", "nope")).toEqual({ ok: false, reason: "invalid_code" });

    const first = await redeemReferral("min", " abcd2345 ");
    expect(first).toEqual({ ok: true, recruiterId: "rec" });
    expect(db.table("minion_links")).toHaveLength(1);
    expect(db.where("behavioral_events", (e) => e.event_type === "referral_redeemed")).toHaveLength(1);

    // One recruiter per minion — a second code is refused.
    expect(await redeemReferral("min", "WXYZ6789")).toEqual({ ok: false, reason: "already_recruited" });
    expect(db.table("minion_links")).toHaveLength(1);
  });

  it("pays the recruiter the fraction while their gated fields are visible", async () => {
    await redeemReferral("min", "ABCD2345");
    await awardReferralPoints("min", 100, "find-1", "hunt-1");

    const ledger = db.where("points_ledger", (r) => r.user_id === "rec");
    expect(ledger).toHaveLength(1);
    expect(ledger[0].amount).toBe(Math.round(100 * REFERRAL_FRACTION));
    expect(ledger[0].source_type).toBe("referral");
    expect(ledger[0].hunt_id).toBe("hunt-1");

    const paid = db.where("behavioral_events", (e) => e.event_type === "referral_bonus_paid");
    expect(paid).toHaveLength(1);
    expect(paid[0].payload).toMatchObject({
      amount: 15, minion_id: "min", eligible: true, referral_gate: "gated", forfeit_notice: "shown",
      would_have_forfeited: false,
    });
  });

  it("forfeits (logs, does not pay) when the recruiter hides a gated field", async () => {
    await redeemReferral("min", "ABCD2345");
    const rec = db.table("users").find((u) => u.id === "rec")!;
    rec.profile_visibility = { display_name: "everyone", total_score: "nobody" };

    await awardReferralPoints("min", 100, "find-2", "hunt-1");
    expect(db.where("points_ledger", (r) => r.user_id === "rec")).toHaveLength(0);
    const forfeits = db.where("behavioral_events", (e) => e.event_type === "referral_bonus_forfeited");
    expect(forfeits).toHaveLength(1);
    expect(forfeits[0].user_id).toBe("rec");
    expect(forfeits[0].payload).toMatchObject({ amount: 15, eligible: false, referral_gate: "gated" });
  });

  it("under the ungated switch it pays anyway and records what the gate would have done", async () => {
    await redeemReferral("min", "ABCD2345");
    const rec = db.table("users").find((u) => u.id === "rec")!;
    rec.profile_visibility = { display_name: "nobody", total_score: "nobody" };
    rec.metadata = { dim_referral_gate: "ungated", dim_forfeit_notice: "silent" };

    await awardReferralPoints("min", 40, "find-3", "hunt-1");
    expect(db.where("points_ledger", (r) => r.user_id === "rec")).toHaveLength(1);
    expect(db.where("behavioral_events", (e) => e.event_type === "referral_bonus_forfeited")).toHaveLength(0);
    const paid = db.where("behavioral_events", (e) => e.event_type === "referral_bonus_paid");
    expect(paid[0].payload).toMatchObject({
      eligible: false, would_have_forfeited: true, referral_gate: "ungated", forfeit_notice: "silent",
    });
  });

  it("does nothing for a minion nobody recruited, or for zero points", async () => {
    await awardReferralPoints("min", 100, "find-1", "hunt-1");
    await redeemReferral("min", "ABCD2345");
    await awardReferralPoints("min", 0, "find-1", "hunt-1");
    expect(db.table("points_ledger")).toHaveLength(0);
    expect(db.where("behavioral_events", (e) => String(e.event_type).startsWith("referral_bonus"))).toHaveLength(0);
  });
});
