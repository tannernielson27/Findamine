import { describe, it, expect } from "vitest";
import {
  computeInitialVisibility,
  deriveTreatment,
  deriveDefaultCondition,
  deriveFrictionCondition,
  describeEnrollmentFailure,
  dimensionMetadataKeys,
  ENROLLMENT_FAILED_EVENT,
} from "@/lib/services/enrollment";
import { conditionsFromMetadata } from "@/lib/utils/conditions";
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

describe("describeEnrollmentFailure (B7)", () => {
  it("captures an Error's message, the stage reached, and the study", () => {
    expect(describeEnrollmentFailure(new Error("boom"), "randomize", "s1")).toEqual({
      message: "boom",
      stage: "randomize",
      study_id: "s1",
    });
  });

  it("omits study_id when the failure happened before the study was resolved", () => {
    expect(describeEnrollmentFailure(new Error("db down"), "find_study", null)).toEqual({
      message: "db down",
      stage: "find_study",
    });
  });

  it("handles non-Error throwables", () => {
    expect(describeEnrollmentFailure("plain string", "write_user").message).toBe("plain string");
    expect(describeEnrollmentFailure({ code: "42P01" }, "write_user").message).toBe('{"code":"42P01"}');
    expect(describeEnrollmentFailure(undefined, "init").message).toBe("Unknown enrollment error");
  });

  it("uses the research/study_enrollment_failed event identity", () => {
    expect(ENROLLMENT_FAILED_EVENT).toEqual({
      eventType: "research",
      eventName: "study_enrollment_failed",
    });
  });
});

describe("dimensionMetadataKeys → conditionsFromMetadata round trip", () => {
  it("writes dim_<name> keys that read back as conditions", () => {
    const named = [
      { dimensionName: "privacy_default", level: "private" },
      { dimensionName: "privacy_friction", level: "high" },
      { dimensionName: "", level: "ignored" },
    ];
    const keys = dimensionMetadataKeys(named);
    expect(keys).toEqual({ dim_privacy_default: "private", dim_privacy_friction: "high" });
    expect(conditionsFromMetadata({ ...keys, privacy_treatment: "moderate" })).toEqual({
      privacy_control_complexity: "moderate",
      privacy_default: "private",
      privacy_friction: "high",
    });
  });
});
