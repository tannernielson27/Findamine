import { describe, it, expect } from "vitest";
import {
  isCreatorRole,
  onboardingDestination,
  finalCtaLabel,
  stepsForRole,
  ONBOARDING_MILESTONE,
} from "@/lib/onboarding/steps";

describe("onboarding role routing", () => {
  it("classifies creator roles", () => {
    expect(isCreatorRole("teacher")).toBe(true);
    expect(isCreatorRole("hunt_creator")).toBe(true);
    expect(isCreatorRole("admin")).toBe(true);
  });

  it("classifies player roles", () => {
    expect(isCreatorRole("teen")).toBe(false);
    expect(isCreatorRole("parent")).toBe(false);
    expect(isCreatorRole("child")).toBe(false);
    expect(isCreatorRole("student")).toBe(false);
  });

  it("treats missing/unknown roles as players (safe default)", () => {
    expect(isCreatorRole(undefined)).toBe(false);
    expect(isCreatorRole(null)).toBe(false);
    expect(isCreatorRole("")).toBe(false);
    expect(isCreatorRole("banana")).toBe(false);
  });

  it("sends players to browse and creators to hunt management", () => {
    expect(onboardingDestination("teen")).toBe("/browse");
    expect(onboardingDestination("teacher")).toBe("/dashboard/hunts");
  });

  it("labels the final CTA per role", () => {
    expect(finalCtaLabel("teen")).toContain("explor");
    expect(finalCtaLabel("teacher")).toContain("Build");
  });
});

describe("onboarding steps", () => {
  it("returns a non-empty, well-formed step list for both audiences", () => {
    for (const role of ["teen", "teacher"]) {
      const steps = stepsForRole(role);
      expect(steps.length).toBeGreaterThanOrEqual(3);
      for (const s of steps) {
        expect(s.title.length).toBeGreaterThan(0);
        expect(s.body.length).toBeGreaterThan(0);
        expect(s.icon.length).toBeGreaterThan(0);
      }
    }
  });

  it("gives creators different content than players", () => {
    expect(stepsForRole("teacher")).not.toEqual(stepsForRole("teen"));
  });

  it("does not leak privacy/condition language into onboarding copy", () => {
    // Onboarding must be condition-uniform — never reference the privacy manipulation.
    const text = [...stepsForRole("teen"), ...stepsForRole("teacher")]
      .flatMap((s) => [s.title, s.body])
      .join(" ")
      .toLowerCase();
    expect(text).not.toMatch(/privacy|visibility|treatment|condition/);
  });

  it("uses the milestone name the API reads", () => {
    expect(ONBOARDING_MILESTONE).toBe("onboarding_completed");
  });
});
