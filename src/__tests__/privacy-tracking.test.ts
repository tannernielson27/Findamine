import { describe, it, expect } from "vitest";
import { diffVisibility, classifyChange } from "@/lib/utils/privacy-tracking";
import { computePrivacyIndex } from "@/lib/utils/privacy-index";
import { PROFILE_FIELD_KEYS } from "@/lib/utils/privacy";

describe("diffVisibility", () => {
  it("returns only changed fields", () => {
    const a = { display_name: "everyone", real_name: "nobody" };
    const b = { display_name: "team", real_name: "nobody" };
    expect(diffVisibility(a, b)).toEqual([{ field: "display_name", from: "everyone", to: "team" }]);
  });

  it("captures added/removed keys", () => {
    expect(diffVisibility({}, { badges: "team" })).toEqual([{ field: "badges", from: null, to: "team" }]);
    expect(diffVisibility({ badges: "team" }, {})).toEqual([{ field: "badges", from: "team", to: null }]);
  });

  it("empty when identical", () => {
    expect(diffVisibility({ a: "team" }, { a: "team" })).toEqual([]);
  });
});

describe("classifyChange", () => {
  it("tighten: everyone → nobody", () => {
    expect(classifyChange([{ field: "x", from: "everyone", to: "nobody" }])).toBe("tighten");
  });

  it("loosen: nobody → everyone", () => {
    expect(classifyChange([{ field: "x", from: "nobody", to: "everyone" }])).toBe("loosen");
  });

  it("mixed: one tighten + one loosen", () => {
    expect(
      classifyChange([
        { field: "x", from: "everyone", to: "team" },
        { field: "y", from: "team", to: "everyone" },
      ])
    ).toBe("mixed");
  });

  it("none: no deltas", () => {
    expect(classifyChange([])).toBe("none");
  });

  it("treats unset (null) as everyone for ranking", () => {
    // null(→everyone,0) → team(2) is tightening
    expect(classifyChange([{ field: "x", from: null, to: "team" }])).toBe("tighten");
    // team(2) → null(→everyone,0) is loosening
    expect(classifyChange([{ field: "x", from: "team", to: null }])).toBe("loosen");
  });
});

describe("computePrivacyIndex", () => {
  it("all everyone = 0 (fully public)", () => {
    const vis = Object.fromEntries(PROFILE_FIELD_KEYS.map((k) => [k, "everyone"]));
    expect(computePrivacyIndex(vis)).toBe(0);
  });

  it("all nobody = 1 (fully private)", () => {
    const vis = Object.fromEntries(PROFILE_FIELD_KEYS.map((k) => [k, "nobody"]));
    expect(computePrivacyIndex(vis)).toBe(1);
  });

  it("empty/unset = 0 (treated as everyone)", () => {
    expect(computePrivacyIndex({})).toBe(0);
    expect(computePrivacyIndex(undefined)).toBe(0);
  });

  it("tightening raises the index (monotonic)", () => {
    const base = Object.fromEntries(PROFILE_FIELD_KEYS.map((k) => [k, "everyone"]));
    const tighter = { ...base, [PROFILE_FIELD_KEYS[0]]: "nobody" };
    expect(computePrivacyIndex(tighter)).toBeGreaterThan(computePrivacyIndex(base));
  });

  it("class is less restrictive than team", () => {
    const allClass = Object.fromEntries(PROFILE_FIELD_KEYS.map((k) => [k, "class"]));
    const allTeam = Object.fromEntries(PROFILE_FIELD_KEYS.map((k) => [k, "team"]));
    expect(computePrivacyIndex(allClass)).toBeLessThan(computePrivacyIndex(allTeam));
  });
});
