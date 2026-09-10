import { describe, it, expect } from "vitest";
import {
  computeInitialVisibility,
  deriveTreatment,
  deriveDefaultCondition,
  deriveFrictionCondition,
} from "@/lib/services/enrollment";
import { PROFILE_FIELDS, getDefaults } from "@/lib/utils/privacy";

describe("computeInitialVisibility", () => {
  it("private → every field 'nobody'", () => {
    const v = computeInitialVisibility("adult", "private");
    expect(Object.keys(v).length).toBe(PROFILE_FIELDS.length);
    expect(Object.values(v).every((x) => x === "nobody")).toBe(true);
  });

  it("public → every field 'everyone'", () => {
    const v = computeInitialVisibility("adult", "public");
    expect(Object.keys(v).length).toBe(PROFILE_FIELDS.length);
    expect(Object.values(v).every((x) => x === "everyone")).toBe(true);
  });

  it("neutral → empty map (no pre-selection)", () => {
    expect(computeInitialVisibility("adult", "neutral")).toEqual({});
  });

  it("absent condition → age-band defaults (non-empty, backward compatible)", () => {
    const v = computeInitialVisibility("adult");
    expect(Object.keys(v).length).toBe(PROFILE_FIELDS.length);
  });

  it("age band changes the fallback defaults", () => {
    const kids = computeInitialVisibility("primary");
    const adults = computeInitialVisibility("adult");
    // real_name default differs between kids (nobody) and adults (class)
    expect(kids["real_name"]).toBe("nobody");
    expect(adults["real_name"]).toBe("class");
  });
});

describe("getDefaults with condition (A10)", () => {
  it("private/public/neutral conditions match computeInitialVisibility", () => {
    expect(getDefaults("adult", "private")).toEqual(computeInitialVisibility("adult", "private"));
    expect(getDefaults("adult", "public")).toEqual(computeInitialVisibility("adult", "public"));
    expect(getDefaults("adult", "neutral")).toEqual({});
  });

  it("age_band / absent falls back to age-band defaults", () => {
    expect(getDefaults("adult", "age_band")).toEqual(getDefaults("adult"));
    expect(Object.keys(getDefaults("adult")).length).toBe(PROFILE_FIELDS.length);
  });
});

describe("deriveTreatment", () => {
  it("returns the privacy_control_complexity level", () => {
    expect(
      deriveTreatment([
        { dimensionName: "privacy_control_complexity", level: "moderate" },
        { dimensionName: "privacy_default", level: "public" },
      ])
    ).toBe("moderate");
  });

  it("returns null when the complexity dimension is absent", () => {
    expect(deriveTreatment([{ dimensionName: "privacy_default", level: "public" }])).toBeNull();
  });
});

describe("deriveDefaultCondition", () => {
  it("returns a valid privacy_default level", () => {
    expect(
      deriveDefaultCondition([{ dimensionName: "privacy_default", level: "private" }])
    ).toBe("private");
  });

  it("returns undefined for an unknown/absent level", () => {
    expect(deriveDefaultCondition([])).toBeUndefined();
    expect(
      deriveDefaultCondition([{ dimensionName: "privacy_default", level: "bogus" }])
    ).toBeUndefined();
  });
});

describe("deriveFrictionCondition (prospectus Factor B)", () => {
  it("returns the assigned low/high level", () => {
    expect(
      deriveFrictionCondition([{ dimensionName: "privacy_friction", level: "low" }])
    ).toBe("low");
    expect(
      deriveFrictionCondition([
        { dimensionName: "privacy_default", level: "public" },
        { dimensionName: "privacy_friction", level: "high" },
      ])
    ).toBe("high");
  });

  it("returns undefined when absent or invalid", () => {
    expect(deriveFrictionCondition([])).toBeUndefined();
    expect(
      deriveFrictionCondition([{ dimensionName: "privacy_friction", level: "medium" }])
    ).toBeUndefined();
  });
});
