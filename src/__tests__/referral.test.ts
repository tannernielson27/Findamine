import { describe, it, expect } from "vitest";
import {
  computeReferralPoints,
  generateReferralCode,
  isDisclosureEligible,
  DISCLOSURE_GATED_FIELDS,
  REFERRAL_FRACTION,
  resolveReferralSwitches,
  REFERRAL_SWITCH_DEFAULTS,
} from "@/lib/services/referral";

describe("computeReferralPoints", () => {
  it("awards the configured fraction, rounded", () => {
    expect(computeReferralPoints(100)).toBe(Math.round(100 * REFERRAL_FRACTION));
    expect(computeReferralPoints(100, 0.2)).toBe(20);
    expect(computeReferralPoints(10, 0.15)).toBe(2); // 1.5 → 2
  });

  it("returns 0 for non-positive or invalid base points", () => {
    expect(computeReferralPoints(0)).toBe(0);
    expect(computeReferralPoints(-50)).toBe(0);
    expect(computeReferralPoints(Number.NaN)).toBe(0);
  });

  it("scales with base points", () => {
    expect(computeReferralPoints(200)).toBeGreaterThan(computeReferralPoints(100));
  });
});

describe("generateReferralCode", () => {
  it("is 8 chars from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateReferralCode();
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    }
  });

  it("is effectively unique across many draws", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateReferralCode()));
    expect(codes.size).toBeGreaterThan(190); // collisions extremely unlikely
  });
});

describe("isDisclosureEligible (referral disclosure gate)", () => {
  it("gates on display_name and total_score", () => {
    expect([...DISCLOSURE_GATED_FIELDS].sort()).toEqual(["display_name", "total_score"]);
  });

  it("is eligible with unset visibility (defaults to everyone)", () => {
    expect(isDisclosureEligible(undefined)).toBe(true);
    expect(isDisclosureEligible({})).toBe(true);
  });

  it("is eligible at class or broader visibility", () => {
    expect(isDisclosureEligible({ display_name: "class", total_score: "class" })).toBe(true);
    expect(isDisclosureEligible({ display_name: "everyone", total_score: "class" })).toBe(true);
  });

  it("forfeits when a gated field is restricted below class", () => {
    expect(isDisclosureEligible({ display_name: "team", total_score: "everyone" })).toBe(false);
    expect(isDisclosureEligible({ display_name: "everyone", total_score: "nobody" })).toBe(false);
    expect(isDisclosureEligible({ display_name: "nobody", total_score: "nobody" })).toBe(false);
  });

  it("ignores non-gated fields", () => {
    expect(isDisclosureEligible({ real_name: "nobody", friends_list: "nobody" })).toBe(true);
  });
});

describe("resolveReferralSwitches (storyline S3, migration 059)", () => {
  it("defaults to today's behavior when nothing is assigned", () => {
    expect(resolveReferralSwitches(undefined)).toEqual(REFERRAL_SWITCH_DEFAULTS);
    expect(resolveReferralSwitches(null)).toEqual({ referral_gate: "gated", forfeit_notice: "shown" });
    expect(resolveReferralSwitches({})).toEqual({ referral_gate: "gated", forfeit_notice: "shown" });
  });

  it("reads assigned levels from dim_* metadata keys", () => {
    expect(
      resolveReferralSwitches({ dim_referral_gate: "ungated", dim_forfeit_notice: "silent" })
    ).toEqual({ referral_gate: "ungated", forfeit_notice: "silent" });
  });

  it("treats unknown or malformed levels as the default", () => {
    expect(
      resolveReferralSwitches({ dim_referral_gate: "open", dim_forfeit_notice: 42 })
    ).toEqual({ referral_gate: "gated", forfeit_notice: "shown" });
  });

  it("is independent per switch", () => {
    expect(resolveReferralSwitches({ dim_referral_gate: "ungated" })).toEqual({
      referral_gate: "ungated",
      forfeit_notice: "shown",
    });
    expect(resolveReferralSwitches({ dim_forfeit_notice: "silent" })).toEqual({
      referral_gate: "gated",
      forfeit_notice: "silent",
    });
  });
});
