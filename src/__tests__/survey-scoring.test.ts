import { describe, it, expect } from "vitest";
import { scoreAnswers, type ScorableQuestion } from "@/lib/services/survey-scoring";

const q = (over: Partial<ScorableQuestion>): ScorableQuestion => ({
  item_code: "i1",
  question_type: "likert_5",
  scale_config: null,
  reverse_coded: false,
  subscale: "concern",
  ...over,
});

describe("scoreAnswers", () => {
  it("averages a subscale of forward-coded items", () => {
    const questions = [
      q({ item_code: "a", subscale: "concern" }),
      q({ item_code: "b", subscale: "concern" }),
    ];
    const [res] = scoreAnswers(questions, { a: 4, b: 2 });
    expect(res.subscale).toBe("concern");
    expect(res.score).toBe(3);
    expect(res.itemCount).toBe(2);
  });

  it("reverse-codes on a 5-point scale (default max)", () => {
    const [res] = scoreAnswers([q({ item_code: "a", reverse_coded: true })], { a: 5 });
    // 5 + 1 - 5 = 1
    expect(res.items[0].scoredValue).toBe(1);
    expect(res.items[0].rawValue).toBe(5);
  });

  it("reverse-codes on a 7-point scale via question_type", () => {
    const [res] = scoreAnswers(
      [q({ item_code: "a", reverse_coded: true, question_type: "likert_7" })],
      { a: 2 }
    );
    // 7 + 1 - 2 = 6
    expect(res.items[0].scoredValue).toBe(6);
  });

  it("honors an explicit scale_config.max over question_type", () => {
    const [res] = scoreAnswers(
      [q({ item_code: "a", reverse_coded: true, question_type: "likert_5", scale_config: { max: 7 } })],
      { a: 1 }
    );
    // 7 + 1 - 1 = 7
    expect(res.items[0].scoredValue).toBe(7);
  });

  it("splits items across subscales", () => {
    const questions = [
      q({ item_code: "a", subscale: "concern" }),
      q({ item_code: "b", subscale: "fatigue" }),
    ];
    const res = scoreAnswers(questions, { a: 5, b: 1 });
    expect(res).toHaveLength(2);
    expect(res.find((r) => r.subscale === "concern")?.score).toBe(5);
    expect(res.find((r) => r.subscale === "fatigue")?.score).toBe(1);
  });

  it("ignores missing and non-numeric answers", () => {
    const questions = [
      q({ item_code: "a" }),
      q({ item_code: "b" }),
      q({ item_code: "c" }),
    ];
    const [res] = scoreAnswers(questions, { a: 4, b: "not a number" });
    // only 'a' scored; b is NaN, c missing
    expect(res.itemCount).toBe(1);
    expect(res.score).toBe(4);
  });

  it("coerces numeric strings", () => {
    const [res] = scoreAnswers([q({ item_code: "a" })], { a: "3" });
    expect(res.items[0].rawValue).toBe(3);
  });

  it("drops a subscale with no scorable items", () => {
    const res = scoreAnswers([q({ item_code: "a", subscale: "empty" })], {});
    expect(res).toEqual([]);
  });

  it("rounds the subscale mean to 2 dp", () => {
    const questions = [q({ item_code: "a" }), q({ item_code: "b" }), q({ item_code: "c" })];
    const [res] = scoreAnswers(questions, { a: 1, b: 2, c: 2 });
    expect(res.score).toBe(1.67);
  });

  it("defaults an unlabeled subscale to 'general'", () => {
    const [res] = scoreAnswers([q({ item_code: "a", subscale: null })], { a: 3 });
    expect(res.subscale).toBe("general");
  });
});
