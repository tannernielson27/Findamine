import { describe, it, expect } from "vitest";
import { conditionsFromMetadata, levelFromMetadata, hasDimension } from "@/lib/utils/conditions";

describe("levelFromMetadata", () => {
  const LEVELS = ["none", "weekly"] as const;

  it("returns the assigned level when it is a known level", () => {
    expect(levelFromMetadata({ dim_privacy_checkin: "weekly" }, "privacy_checkin", LEVELS, "none")).toBe("weekly");
  });

  it("falls back when unlinked, unknown, or non-string", () => {
    expect(levelFromMetadata({}, "privacy_checkin", LEVELS, "none")).toBe("none");
    expect(levelFromMetadata(null, "privacy_checkin", LEVELS, "none")).toBe("none");
    expect(levelFromMetadata({ dim_privacy_checkin: "daily" }, "privacy_checkin", LEVELS, "none")).toBe("none");
    expect(levelFromMetadata({ dim_privacy_checkin: 7 }, "privacy_checkin", LEVELS, "none")).toBe("none");
  });

  it("falls back for a withdrawn participant, and hasDimension turns off", () => {
    const meta = { dim_privacy_checkin: "weekly", research_withdrawn_at: "2026-09-11T00:00:00Z" };
    expect(levelFromMetadata(meta, "privacy_checkin", LEVELS, "none")).toBe("none");
    expect(hasDimension(meta, "privacy_checkin")).toBe(false);
  });

  it("ignores the legacy alias keys", () => {
    expect(levelFromMetadata({ privacy_checkin: "weekly" }, "privacy_checkin", LEVELS, "none")).toBe("none");
  });
});

describe("hasDimension", () => {
  it("is true only for a non-empty assigned level", () => {
    expect(hasDimension({ dim_scheme_selection: "chosen" }, "scheme_selection")).toBe(true);
    expect(hasDimension({ dim_scheme_selection: "" }, "scheme_selection")).toBe(false);
    expect(hasDimension({}, "scheme_selection")).toBe(false);
    expect(hasDimension(undefined, "scheme_selection")).toBe(false);
  });
});

describe("conditionsFromMetadata", () => {
  it("maps the three legacy keys to dimension names", () => {
    expect(
      conditionsFromMetadata({
        privacy_treatment: "moderate",
        privacy_default: "private",
        privacy_friction: "high",
      })
    ).toEqual({
      privacy_control_complexity: "moderate",
      privacy_default: "private",
      privacy_friction: "high",
    });
  });

  it("drops null / missing / non-string levels", () => {
    expect(
      conditionsFromMetadata({
        privacy_treatment: "moderate",
        privacy_default: null,
        privacy_friction: undefined,
        dim_bogus: 42,
        dim_empty: "",
      })
    ).toEqual({ privacy_control_complexity: "moderate" });
  });

  it("passes through dim_-prefixed keys with the prefix stripped", () => {
    expect(
      conditionsFromMetadata({
        dim_incentive_framing: "loss",
        dim_nudge_timing: "delayed",
      })
    ).toEqual({ incentive_framing: "loss", nudge_timing: "delayed" });
  });

  it("ignores unrelated metadata keys", () => {
    expect(
      conditionsFromMetadata({
        real_name: "Ada",
        privacy_first_choice_at: "2026-01-01T00:00:00Z",
        onboarding_step: 3,
      })
    ).toEqual({});
  });

  it("lets an explicit dim_ key override the legacy alias for the same dimension", () => {
    expect(
      conditionsFromMetadata({
        privacy_default: "private",
        dim_privacy_default: "public",
      })
    ).toEqual({ privacy_default: "public" });
  });

  it("returns an empty object for null / undefined metadata", () => {
    expect(conditionsFromMetadata(null)).toEqual({});
    expect(conditionsFromMetadata(undefined)).toEqual({});
  });

  it("does not mutate its input", () => {
    const meta = { privacy_treatment: "simple", dim_x: "y" };
    const copy = { ...meta };
    conditionsFromMetadata(meta);
    expect(meta).toEqual(copy);
  });
});
