import { describe, it, expect } from "vitest";
import { cartesianProduct, stratumKeyFor } from "@/lib/services/randomization";
import { isUnset } from "@/lib/services/privacy-snapshots";

describe("cartesianProduct", () => {
  it("crosses two dimensions into all joint cells", () => {
    expect(cartesianProduct([["a", "b"], ["x", "y"]])).toEqual([
      ["a", "x"],
      ["a", "y"],
      ["b", "x"],
      ["b", "y"],
    ]);
  });

  it("handles a single dimension", () => {
    expect(cartesianProduct([["a", "b", "c"]])).toEqual([["a"], ["b"], ["c"]]);
  });

  it("produces one empty cell for no dimensions", () => {
    expect(cartesianProduct([])).toEqual([[]]);
  });

  it("produces 9 cells for a 3x3 design", () => {
    const cells = cartesianProduct([
      ["simple", "moderate", "complex"],
      ["private", "neutral", "public"],
    ]);
    expect(cells).toHaveLength(9);
    // Every cell is unique.
    expect(new Set(cells.map((c) => c.join("|"))).size).toBe(9);
  });
});

describe("stratumKeyFor", () => {
  it("returns 'all' when no stratification is configured", () => {
    expect(stratumKeyFor(undefined, "adult", "s1")).toBe("all");
    expect(stratumKeyFor([], "adult", "s1")).toBe("all");
  });

  it("stratifies by age band", () => {
    expect(stratumKeyFor(["age_band"], "adult", "s1")).toBe("band:adult");
  });

  it("falls back to 'unknown' for a missing band", () => {
    expect(stratumKeyFor(["age_band"], null, "s1")).toBe("band:unknown");
  });

  it("stratifies by school, defaulting to 'none'", () => {
    expect(stratumKeyFor(["school_id"], "adult", null)).toBe("school:none");
  });

  it("combines multiple strata deterministically", () => {
    expect(stratumKeyFor(["age_band", "school_id"], "adult", "s1")).toBe("band:adult|school:s1");
  });
});

describe("isUnset", () => {
  it("treats an empty or missing map as unset (neutral pre-choice)", () => {
    expect(isUnset(undefined)).toBe(true);
    expect(isUnset({})).toBe(true);
  });

  it("treats any populated map as a made choice", () => {
    expect(isUnset({ display_name: "everyone" })).toBe(false);
  });
});
