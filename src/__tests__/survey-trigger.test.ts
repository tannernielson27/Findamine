import { describe, it, expect } from "vitest";
import {
  DAY_MS,
  isAllowedTriggerEvent,
  normalizeSchedules,
  matchEventSchedules,
  matchDueTimeSchedules,
  dedupeBySurvey,
  buildDeliveryRows,
  timepointForSurvey,
  selectPendingDeliveries,
  type ScheduleRow,
} from "@/lib/services/survey-triggers";

const T1 = "survey-t1";
const T2 = "survey-t2";

/** The post-054 schedule set: T1 event + T1 day-3 fallback + T2 time. */
const ROWS: ScheduleRow[] = [
  {
    survey_id: T1,
    trigger_type: "event",
    trigger_config: { timepoint: "T1", event: "privacy_view", expires_days: 7 },
    surveys: { status: "active" },
  },
  {
    survey_id: T1,
    trigger_type: "time",
    trigger_config: { timepoint: "T1", offset_days: 3, expires_days: 7, fallback: true },
    surveys: { status: "active" },
  },
  {
    survey_id: T2,
    trigger_type: "time",
    trigger_config: { timepoint: "T2", offset_days: 21, expires_days: 7 },
    surveys: { status: "active" },
  },
];

describe("isAllowedTriggerEvent", () => {
  it("allows privacy_view only", () => {
    expect(isAllowedTriggerEvent("privacy_view")).toBe(true);
    expect(isAllowedTriggerEvent("enrollment")).toBe(false);
    expect(isAllowedTriggerEvent("")).toBe(false);
    expect(isAllowedTriggerEvent(undefined)).toBe(false);
    expect(isAllowedTriggerEvent({ event: "privacy_view" })).toBe(false);
  });
});

describe("normalizeSchedules", () => {
  it("drops schedules whose survey is not active (draft never reaches participants)", () => {
    const rows: ScheduleRow[] = [
      { ...ROWS[0], surveys: { status: "draft" } },
      { ...ROWS[2], surveys: null },
    ];
    expect(normalizeSchedules(rows)).toEqual([]);
  });

  it("accepts the joined survey as an array (PostgREST shape)", () => {
    const rows: ScheduleRow[] = [{ ...ROWS[0], surveys: [{ status: "active" }] }];
    expect(normalizeSchedules(rows)).toHaveLength(1);
  });

  it("parses event and time configs with defaults for missing fields", () => {
    const [ev, fb, t2] = normalizeSchedules(ROWS);
    expect(ev).toMatchObject({ trigger_type: "event", event: "privacy_view", timepoint: "T1", expires_days: 7, fallback: false });
    expect(fb).toMatchObject({ trigger_type: "time", offset_days: 3, fallback: true, event: null });
    expect(t2).toMatchObject({ trigger_type: "time", offset_days: 21, timepoint: "T2" });

    const bare = normalizeSchedules([
      { survey_id: "x", trigger_type: "time", trigger_config: null, surveys: { status: "active" } },
    ]);
    expect(bare[0]).toMatchObject({ offset_days: 0, expires_days: 7, timepoint: null, event: null });
  });

  it("ignores unknown trigger types", () => {
    const rows: ScheduleRow[] = [
      { survey_id: "x", trigger_type: "bogus", trigger_config: {}, surveys: { status: "active" } },
    ];
    expect(normalizeSchedules(rows)).toEqual([]);
  });
});

describe("matchEventSchedules", () => {
  it("returns only event schedules for the named event", () => {
    const m = matchEventSchedules(normalizeSchedules(ROWS), "privacy_view");
    expect(m).toHaveLength(1);
    expect(m[0].survey_id).toBe(T1);
    expect(m[0].trigger_type).toBe("event");
  });

  it("returns nothing for an unscheduled event", () => {
    expect(matchEventSchedules(normalizeSchedules(ROWS), "something_else")).toEqual([]);
  });

  it("never matches a time schedule even with the same timepoint", () => {
    const onlyTime = normalizeSchedules([ROWS[1]]);
    expect(matchEventSchedules(onlyTime, "privacy_view")).toEqual([]);
  });
});

describe("matchDueTimeSchedules", () => {
  it("excludes the event schedule and respects offset_days", () => {
    const s = normalizeSchedules(ROWS);
    expect(matchDueTimeSchedules(s, 0)).toEqual([]);
    expect(matchDueTimeSchedules(s, 3).map((x) => x.survey_id)).toEqual([T1]); // fallback fires day 3
    expect(matchDueTimeSchedules(s, 21).map((x) => x.survey_id)).toEqual([T1, T2]);
  });
});

describe("dedupeBySurvey (at most one T1 per user across event + fallback)", () => {
  const s = normalizeSchedules(ROWS);

  it("fallback is suppressed when the event path already delivered T1", () => {
    const due = matchDueTimeSchedules(s, 3);
    expect(dedupeBySurvey(due, [T1])).toEqual([]);
  });

  it("event path is suppressed when the fallback already delivered T1", () => {
    const ev = matchEventSchedules(s, "privacy_view");
    expect(dedupeBySurvey(ev, new Set([T1]))).toEqual([]);
  });

  it("any prior delivery for the survey suppresses re-issue (submitted/expired included)", () => {
    const ev = matchEventSchedules(s, "privacy_view");
    expect(dedupeBySurvey(ev, ["other", T1])).toEqual([]);
    expect(dedupeBySurvey(ev, ["other"])).toHaveLength(1);
  });

  it("collapses two schedules for one survey in the same batch to one row", () => {
    // Both T1 schedules due at once (e.g. a hypothetical time+time pair).
    const both = s.filter((x) => x.survey_id === T1);
    const kept = dedupeBySurvey(both, []);
    expect(kept).toHaveLength(1);
    expect(kept[0].survey_id).toBe(T1);
  });

  it("does not mutate its inputs", () => {
    const input = matchDueTimeSchedules(s, 21);
    const existing = new Set<string>();
    dedupeBySurvey(input, existing);
    expect(input).toHaveLength(2);
    expect(existing.size).toBe(0);
  });
});

describe("buildDeliveryRows", () => {
  it("creates pending rows with expires_at from expires_days", () => {
    const now = Date.UTC(2026, 0, 1);
    const rows = buildDeliveryRows(matchEventSchedules(normalizeSchedules(ROWS), "privacy_view"), "u1", now);
    expect(rows).toEqual([
      {
        survey_id: T1,
        user_id: "u1",
        status: "pending",
        expires_at: new Date(now + 7 * DAY_MS).toISOString(),
      },
    ]);
  });
});

describe("timepointForSurvey", () => {
  it("reads the timepoint from any schedule of the survey", () => {
    const s = normalizeSchedules(ROWS);
    expect(timepointForSurvey(s, T1)).toBe("T1");
    expect(timepointForSurvey(s, T2)).toBe("T2");
    expect(timepointForSurvey(s, "nope")).toBeNull();
  });
});

describe("selectPendingDeliveries (what the privacy-page gate keys on)", () => {
  const s = normalizeSchedules(ROWS);
  const now = Date.UTC(2026, 0, 10);
  const future = new Date(now + DAY_MS).toISOString();
  const past = new Date(now - DAY_MS).toISOString();

  it("includes pending and opened, unexpired deliveries with their timepoint", () => {
    const out = selectPendingDeliveries(
      [
        { id: "d1", survey_id: T1, status: "pending", expires_at: future },
        { id: "d2", survey_id: T1, status: "opened", expires_at: null },
      ],
      [T1],
      s,
      now
    );
    expect(out).toEqual([
      { delivery_id: "d1", survey_id: T1, timepoint: "T1" },
      { delivery_id: "d2", survey_id: T1, timepoint: "T1" },
    ]);
  });

  it("excludes submitted, expired, abandoned, and past-expires_at deliveries", () => {
    const out = selectPendingDeliveries(
      [
        { id: "a", survey_id: T1, status: "submitted", expires_at: future },
        { id: "b", survey_id: T1, status: "expired", expires_at: past },
        { id: "c", survey_id: T1, status: "abandoned", expires_at: future },
        { id: "d", survey_id: T1, status: "pending", expires_at: past },
      ],
      [T1],
      s,
      now
    );
    expect(out).toEqual([]);
  });

  it("only reports deliveries for the requested surveys", () => {
    const out = selectPendingDeliveries(
      [{ id: "x", survey_id: T2, status: "pending", expires_at: future }],
      [T1],
      s,
      now
    );
    expect(out).toEqual([]);
  });
});
