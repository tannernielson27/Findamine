import { describe, it, expect } from "vitest";
import {
  celebrationForResult,
  arrivalCelebration,
  type AnswerResultLike,
} from "@/lib/play/celebration";

const base: AnswerResultLike = { feedbackType: "correct", score: 100, attempt: 1, breakdown: { hintPenalty: 0 } };

describe("celebrationForResult", () => {
  it("treats a first-try, no-hint correct answer as perfect/high", () => {
    const c = celebrationForResult(base);
    expect(c.tone).toBe("perfect");
    expect(c.intensity).toBe("high");
    expect(c.points).toBe(100);
  });

  it("downgrades to success/medium when hints were used", () => {
    const c = celebrationForResult({ ...base, breakdown: { hintPenalty: 4 } });
    expect(c.tone).toBe("success");
    expect(c.intensity).toBe("medium");
  });

  it("downgrades to success/medium when it took more than one attempt", () => {
    const c = celebrationForResult({ ...base, attempt: 2 });
    expect(c.tone).toBe("success");
    expect(c.intensity).toBe("medium");
  });

  it("maps partial credit to the partial tone", () => {
    const c = celebrationForResult({ ...base, feedbackType: "partial" });
    expect(c.tone).toBe("partial");
    expect(c.intensity).toBe("medium");
  });

  it("celebrates effort for a miss that still completes", () => {
    const c = celebrationForResult({ ...base, feedbackType: "incorrect", score: 5 });
    expect(c.tone).toBe("effort");
    expect(c.intensity).toBe("low");
  });

  it("hides points when scores are hidden (anxiety-sensitive hunts)", () => {
    const c = celebrationForResult(base, true);
    expect(c.points).toBeNull();
    // ...but still celebrates
    expect(c.headline.length).toBeGreaterThan(0);
  });

  it("is deterministic: same score → same headline", () => {
    expect(celebrationForResult(base).headline).toBe(celebrationForResult(base).headline);
  });

  it("defaults a missing attempt to first-try semantics", () => {
    const c = celebrationForResult({ feedbackType: "correct", score: 50 });
    expect(c.tone).toBe("perfect");
  });

  it("handles negative/odd scores without throwing in headline selection", () => {
    expect(() => celebrationForResult({ feedbackType: "correct", score: -7 })).not.toThrow();
  });
});

describe("arrivalCelebration", () => {
  it("announces the find with no points", () => {
    const c = arrivalCelebration();
    expect(c.headline).toMatch(/found it/i);
    expect(c.points).toBeNull();
    expect(c.intensity).toBe("medium");
  });
});
