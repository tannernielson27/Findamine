import { describe, expect, it } from "vitest";
import { sumLedger } from "@/lib/utils/points";

describe("sumLedger", () => {
  it("returns 0 for an empty array", () => {
    expect(sumLedger([])).toBe(0);
  });

  it("sums positive amounts", () => {
    expect(sumLedger([{ amount: 10 }, { amount: 25 }, { amount: 5 }])).toBe(40);
  });

  it("sums positive and negative amounts", () => {
    expect(sumLedger([{ amount: 100 }, { amount: -30 }, { amount: -10 }])).toBe(60);
  });

  it("treats null amounts as 0", () => {
    expect(sumLedger([{ amount: 10 }, { amount: null }, { amount: 5 }])).toBe(15);
  });

  it("returns 0 when every amount is null", () => {
    expect(sumLedger([{ amount: null }, { amount: null }])).toBe(0);
  });
});
