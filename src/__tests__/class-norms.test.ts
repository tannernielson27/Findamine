import { describe, it, expect } from "vitest";
import {
  computeClassNormStats,
  isHiddenFromEveryone,
  normLineFor,
  normMessage,
  pickNormStat,
} from "@/lib/utils/class-norms";

describe("isHiddenFromEveryone", () => {
  it("treats unset and everyone as visible, anything narrower as hidden", () => {
    expect(isHiddenFromEveryone(undefined)).toBe(false);
    expect(isHiddenFromEveryone({})).toBe(false);
    expect(isHiddenFromEveryone({ total_score: "everyone" })).toBe(false);
    for (const level of ["class", "team", "nobody"]) {
      expect(isHiddenFromEveryone({ total_score: level })).toBe(true);
    }
  });
});

describe("computeClassNormStats", () => {
  const vis = new Map<string, Record<string, string> | undefined>([
    ["a", { total_score: "nobody" }],
    ["b", { total_score: "class" }],
    ["c", { total_score: "everyone" }],
    ["d", {}],
    ["e", undefined],
    ["f", { total_score: "team" }],
  ]);

  it("computes the hidden share per class, deduping repeated entries", () => {
    const entries = ["a", "b", "c", "d", "e", "a"].map((s) => ({ roster_id: "r1", student_id: s }));
    expect(computeClassNormStats(entries, vis)).toEqual([
      { roster_id: "r1", field: "total_score", n_players: 5, n_hidden: 2, share_hidden: 0.4 },
    ]);
  });

  it("skips classes below the minimum size and sorts by roster", () => {
    const entries = [
      ...["a", "b", "c", "d", "e", "f"].map((s) => ({ roster_id: "r2", student_id: s })),
      ...["a", "b", "c"].map((s) => ({ roster_id: "r1", student_id: s })),
      ...["a", "b", "c", "d", "f"].map((s) => ({ roster_id: "r0", student_id: s })),
    ];
    const stats = computeClassNormStats(entries, vis);
    expect(stats.map((s) => s.roster_id)).toEqual(["r0", "r2"]);
    expect(stats[1]).toMatchObject({ n_players: 6, n_hidden: 3, share_hidden: 0.5 });
  });

  it("rounds the share to four decimals", () => {
    const entries = ["a", "c", "d", "e", "x", "y"].map((s) => ({ roster_id: "r", student_id: s }));
    expect(computeClassNormStats(entries, vis)[0].share_hidden).toBe(0.1667);
  });
});

describe("normMessage", () => {
  it("rounds to a whole percent and clamps", () => {
    expect(normMessage(0.6249)).toBe("62% of players in your class hide their score from Everyone.");
    expect(normMessage(1.2)).toMatch(/^100%/);
    expect(normMessage(-1)).toMatch(/^0%/);
  });
});

describe("pickNormStat", () => {
  it("prefers the latest day, then the largest class, then the lowest roster id", () => {
    const stats = [
      { roster_id: "b", computed_on: "2026-09-10", n_players: 30 },
      { roster_id: "c", computed_on: "2026-09-11", n_players: 12 },
      { roster_id: "a", computed_on: "2026-09-11", n_players: 12 },
      { roster_id: "d", computed_on: "2026-09-11", n_players: 8 },
    ];
    expect(pickNormStat(stats)?.roster_id).toBe("a");
    expect(pickNormStat([])).toBeNull();
  });
});

describe("normLineFor", () => {
  it("reads dim_norm_line and defaults to none", () => {
    expect(normLineFor({ dim_norm_line: "descriptive" })).toBe("descriptive");
    expect(normLineFor({ dim_norm_line: "injunctive" })).toBe("none");
    expect(normLineFor(undefined)).toBe("none");
  });
});
