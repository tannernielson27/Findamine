import { describe, it, expect } from "vitest";
import {
  settingsError,
  idealFromAnswers,
  pickSnapshotAt,
  AUDIENCE_RANK,
} from "@/lib/utils/settings-error";

describe("settingsError", () => {
  it("is 0 when actual matches ideal on every field", () => {
    const map = { display_name: "class", total_score: "nobody", badges: "everyone" };
    expect(settingsError(map, map)).toEqual({
      error: 0,
      fields_compared: 3,
      over_shared: 0,
      under_shared: 0,
    });
  });

  it("is 1 when every field is maximally wrong", () => {
    const ideal = { a: "nobody", b: "everyone" };
    const actual = { a: "everyone", b: "nobody" };
    const r = settingsError(ideal, actual);
    expect(r.error).toBe(1);
    expect(r.over_shared).toBe(1); // a is more public than wanted
    expect(r.under_shared).toBe(1); // b is more private than wanted
  });

  it("averages rank distance over compared fields and normalizes by 3", () => {
    // distances: 1 (team→class), 2 (nobody→class), 0
    const r = settingsError(
      { a: "team", b: "nobody", c: "everyone" },
      { a: "class", b: "class", c: "everyone" }
    );
    expect(r.fields_compared).toBe(3);
    expect(r.error).toBeCloseTo((1 + 2 + 0) / 3 / 3, 4);
    expect(r.over_shared).toBe(2);
  });

  it("skips fields missing or invalid on either side", () => {
    const r = settingsError({ a: "team", b: "class", c: "bogus" }, { a: "team", z: "nobody" });
    expect(r.fields_compared).toBe(1);
    expect(r.error).toBe(0);
  });

  it("returns null error when nothing can be compared", () => {
    expect(settingsError({}, {})).toEqual({
      error: null,
      fields_compared: 0,
      over_shared: 0,
      under_shared: 0,
    });
    expect(settingsError(undefined, null).error).toBeNull();
  });

  it("ranks audiences from everyone (0) to nobody (3)", () => {
    expect(AUDIENCE_RANK).toEqual({ everyone: 0, class: 1, team: 2, nobody: 3 });
  });
});

describe("idealFromAnswers", () => {
  it("extracts ideal_<field> answers with valid levels only", () => {
    expect(
      idealFromAnswers({
        ideal_display_name: "class",
        ideal_total_score: "nobody",
        ideal_badges: "sometimes",
        fatigue_exh_1: 5,
        iuipc_ctrl_1: "7",
      })
    ).toEqual({ display_name: "class", total_score: "nobody" });
  });

  it("is empty for missing answers", () => {
    expect(idealFromAnswers(undefined)).toEqual({});
    expect(idealFromAnswers(null)).toEqual({});
  });
});

describe("pickSnapshotAt", () => {
  const snaps = [
    { created_at: "2026-06-01T00:00:00Z", visibility: { a: "everyone" } },
    { created_at: "2026-06-05T00:00:00Z", visibility: { a: "class" } },
    { created_at: "2026-06-09T00:00:00Z", visibility: { a: "nobody" } },
  ];

  it("returns the latest snapshot at or before the time", () => {
    expect(pickSnapshotAt(snaps, "2026-06-06T12:00:00Z")?.visibility).toEqual({ a: "class" });
    expect(pickSnapshotAt(snaps, "2026-06-05T00:00:00Z")?.visibility).toEqual({ a: "class" });
  });

  it("falls back to the earliest snapshot after the time", () => {
    expect(pickSnapshotAt(snaps, "2026-05-01T00:00:00Z")?.visibility).toEqual({ a: "everyone" });
  });

  it("is order-independent and null when empty or invalid", () => {
    expect(pickSnapshotAt([...snaps].reverse(), "2026-06-20T00:00:00Z")?.visibility).toEqual({
      a: "nobody",
    });
    expect(pickSnapshotAt([], "2026-06-01T00:00:00Z")).toBeNull();
    expect(pickSnapshotAt(snaps, "not a date")).toBeNull();
  });
});
