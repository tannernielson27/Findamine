import { describe, it, expect, vi, beforeEach } from "vitest";
import { installDouble, daysAgo, type SupabaseDouble } from "@/__tests__/support/supabase-double";

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return {
    createSupabaseServiceClient: async () => m.current().client,
    createSupabaseServerClient: async () => m.current().client,
  };
});

import { createDueDeliveriesForUser, createEventDeliveriesForUser } from "@/lib/services/survey-delivery";

const T1 = "survey-t1";
const T2 = "survey-t2";
const DRAFT = "survey-draft";

describe("survey delivery against the Supabase double", () => {
  let db: SupabaseDouble;
  beforeEach(() => {
    db = installDouble({
      surveys: [
        { id: T1, title: "Baseline", status: "active" },
        { id: T2, title: "Midpoint", status: "active" },
        { id: DRAFT, title: "Not yet", status: "draft" },
      ],
      survey_schedules: [
        // Migration 054: T1 on the first privacy view, with a day-3 time fallback.
        { survey_id: T1, trigger_type: "event", trigger_config: { timepoint: "T1", event: "privacy_view", expires_days: 7 }, active: true },
        { survey_id: T1, trigger_type: "time", trigger_config: { timepoint: "T1", offset_days: 3, expires_days: 7, fallback: true }, active: true },
        { survey_id: T2, trigger_type: "time", trigger_config: { timepoint: "T2", offset_days: 21, expires_days: 10 }, active: true },
        { survey_id: DRAFT, trigger_type: "time", trigger_config: { timepoint: "T0", offset_days: 0, expires_days: 7 }, active: true },
      ],
      study_enrollments: [
        { study_id: "s", user_id: "u1", enrolled_at: daysAgo(22), withdrawn_at: null },
        { study_id: "s", user_id: "u2", enrolled_at: daysAgo(22), withdrawn_at: daysAgo(1) },
        { study_id: "s", user_id: "u3", enrolled_at: daysAgo(0), withdrawn_at: null },
      ],
      survey_deliveries: [],
    });
  });

  it("time path: creates every due active survey once, never a draft", async () => {
    expect(await createDueDeliveriesForUser("u1", daysAgo(22))).toBe(2); // T1 fallback + T2
    const mine = db.where("survey_deliveries", (d) => d.user_id === "u1");
    expect(new Set(mine.map((d) => d.survey_id))).toEqual(new Set([T1, T2]));
    expect(mine.every((d) => d.status === "pending")).toBe(true);

    expect(await createDueDeliveriesForUser("u1", daysAgo(22))).toBe(0); // idempotent
    expect(db.where("survey_deliveries", (d) => d.user_id === "u1")).toHaveLength(2);
  });

  it("time path: T2 is not due at day 20, and the T1 fallback is not due at day 2", async () => {
    expect(await createDueDeliveriesForUser("u3", daysAgo(20))).toBe(1); // only the T1 fallback
    expect(db.where("survey_deliveries", (d) => d.user_id === "u3").map((d) => d.survey_id)).toEqual([T1]);
    expect(await createDueDeliveriesForUser("u4", daysAgo(2))).toBe(0);
  });

  it("event path: the first privacy view creates T1 once and reports it pending", async () => {
    const first = await createEventDeliveriesForUser("u3", "privacy_view");
    expect(first.created).toBe(1);
    expect(first.pending).toHaveLength(1);
    expect(first.pending[0]).toMatchObject({ survey_id: T1, timepoint: "T1" });

    const again = await createEventDeliveriesForUser("u3", "privacy_view");
    expect(again.created).toBe(0);
    expect(again.pending).toHaveLength(1);

    // The day-3 time fallback must not produce a second T1 later.
    expect(await createDueDeliveriesForUser("u3", daysAgo(5))).toBe(0);
    expect(db.where("survey_deliveries", (d) => d.user_id === "u3" && d.survey_id === T1)).toHaveLength(1);
  });

  it("event path: withdrawn and never-enrolled users get nothing, so the gate cannot block them", async () => {
    expect(await createEventDeliveriesForUser("u2", "privacy_view")).toEqual({ created: 0, pending: [] });
    expect(await createEventDeliveriesForUser("ghost", "privacy_view")).toEqual({ created: 0, pending: [] });
    expect(db.table("survey_deliveries")).toHaveLength(0);
  });

  it("event path: an unknown event matches no schedule", async () => {
    expect(await createEventDeliveriesForUser("u1", "leaderboard_view")).toEqual({ created: 0, pending: [] });
  });
});
