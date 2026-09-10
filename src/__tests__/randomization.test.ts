import { describe, it, expect } from "vitest";
import {
  cartesianProduct,
  stratumKeyFor,
  resolveLevels,
  pickLeastFilledCell,
  cellKey,
} from "@/lib/services/randomization";
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

describe("resolveLevels (per-study level subsets, migration 052)", () => {
  const dim = { id: "d1", name: "privacy_default", levels: ["private", "neutral", "public"] };

  it("respects a non-empty active subset", () => {
    expect(resolveLevels(dim, ["private", "public"])).toEqual(["private", "public"]);
  });

  it("preserves the dimension's ordering and collapses duplicates", () => {
    expect(resolveLevels(dim, ["public", "private", "public"])).toEqual(["private", "public"]);
  });

  it("falls back to every level when active_levels is null, undefined, or empty", () => {
    expect(resolveLevels(dim, null)).toEqual(dim.levels);
    expect(resolveLevels(dim, undefined)).toEqual(dim.levels);
    expect(resolveLevels(dim, [])).toEqual(dim.levels);
  });

  it("returns a copy, never the dimension's own array", () => {
    expect(resolveLevels(dim, null)).not.toBe(dim.levels);
  });

  it("throws a clear error for a level outside the dimension", () => {
    expect(() => resolveLevels(dim, ["private", "bogus"])).toThrow(
      /Invalid active_levels for privacy_default: \[bogus\]/
    );
  });

  it("narrows the joint design when combined with cartesianProduct", () => {
    const friction = { name: "privacy_friction", levels: ["low", "high"] };
    const cells = cartesianProduct([resolveLevels(dim, ["private", "public"]), resolveLevels(friction, null)]);
    expect(cells).toHaveLength(4);
  });
});

describe("pickLeastFilledCell", () => {
  const cells = [["a"], ["b"], ["c"]];

  it("returns the unique least-filled cell", () => {
    const counts = new Map([
      [cellKey(["a"]), 2],
      [cellKey(["b"]), 0],
      [cellKey(["c"]), 1],
    ]);
    expect(pickLeastFilledCell(cells, counts)).toEqual(["b"]);
  });

  it("treats cells missing from the count map as empty", () => {
    const counts = new Map([[cellKey(["a"]), 1], [cellKey(["b"]), 1]]);
    expect(pickLeastFilledCell(cells, counts)).toEqual(["c"]);
  });

  it("breaks ties with the injected random source", () => {
    const counts = new Map<string, number>();
    expect(pickLeastFilledCell(cells, counts, () => 0)).toEqual(["a"]);
    expect(pickLeastFilledCell(cells, counts, () => 0.99)).toEqual(["c"]);
  });

  it("ignores counts for cells outside the active set", () => {
    // A legacy "neutral" cell with many participants must not affect selection.
    const counts = new Map([[cellKey(["neutral"]), 50], [cellKey(["a"]), 1], [cellKey(["c"]), 1]]);
    expect(pickLeastFilledCell(cells, counts)).toEqual(["b"]);
  });

  it("throws when there are no cells", () => {
    expect(() => pickLeastFilledCell([], new Map())).toThrow(/No cells/);
  });
});
