import { describe, it, expect } from "vitest";
import { summarizeViewerStanding, standingCaption } from "@/lib/social/standing";

const entries = [
  { user_id: "a", score: 300 },
  { user_id: "b", score: 200 },
  { user_id: "c", score: 150 },
];

describe("summarizeViewerStanding", () => {
  it("derives rank + gap from the visible list when the viewer is on it", () => {
    const s = summarizeViewerStanding(entries, "b");
    expect(s.inList).toBe(true);
    expect(s.pinned).toBe(false);
    expect(s.standing).toEqual({ rank: 2, score: 200, gapToNext: 100 });
  });

  it("reports no gap for the leader", () => {
    const s = summarizeViewerStanding(entries, "a");
    expect(s.standing).toEqual({ rank: 1, score: 300, gapToNext: null });
  });

  it("prefers the precise server summary (viewer off the visible board)", () => {
    const s = summarizeViewerStanding(entries, "z", { rank: 34, score: 90, gap_to_next: 15 });
    expect(s.inList).toBe(false);
    expect(s.pinned).toBe(true);
    expect(s.standing).toEqual({ rank: 34, score: 90, gapToNext: 15 });
  });

  it("does not pin when the server summary matches a visible viewer", () => {
    const s = summarizeViewerStanding(entries, "c", { rank: 3, score: 150, gap_to_next: 50 });
    expect(s.inList).toBe(true);
    expect(s.pinned).toBe(false);
  });

  it("returns nothing when the viewer is unknown and absent", () => {
    const s = summarizeViewerStanding(entries, null);
    expect(s.standing).toBeNull();
    expect(s.pinned).toBe(false);
  });
});

describe("standingCaption", () => {
  it("celebrates the leader", () => {
    expect(standingCaption({ rank: 1, score: 9, gapToNext: null })).toMatch(/lead/i);
  });

  it("nudges toward the next rank with correct pluralization", () => {
    expect(standingCaption({ rank: 5, score: 9, gapToNext: 1 })).toBe("1 point to reach #4");
    expect(standingCaption({ rank: 5, score: 9, gapToNext: 20 })).toBe("20 points to reach #4");
  });

  it("handles ties", () => {
    expect(standingCaption({ rank: 4, score: 9, gapToNext: 0 })).toMatch(/tied/i);
  });

  it("returns empty for no standing", () => {
    expect(standingCaption(null)).toBe("");
  });
});
