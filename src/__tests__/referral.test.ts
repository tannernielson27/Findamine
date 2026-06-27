import { describe, it, expect } from "vitest";
import { computeReferralPoints, generateReferralCode, REFERRAL_FRACTION } from "@/lib/services/referral";

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
