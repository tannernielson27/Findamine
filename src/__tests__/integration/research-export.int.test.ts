import { describe, it, expect, vi, beforeEach } from "vitest";
import { installDouble, daysAgo, type SupabaseDouble } from "@/__tests__/support/supabase-double";

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return {
    createSupabaseServiceClient: async () => m.current().client,
    createSupabaseServerClient: async () => m.current().client,
  };
});

import { generateResearchExport, generateTrajectoryExport, generateEventsExport } from "@/lib/services/research-export";

const STUDY = "study-1";
const D_CPX = "dim-cpx";
const D_DEF = "dim-def";
const T1 = "survey-t1";
const ALL_EVERYONE = {
  display_name: "everyone", avatar: "everyone", real_name: "everyone", personality_scores: "everyone",
  badges: "everyone", total_score: "everyone", hunt_history: "everyone", friends_list: "everyone",
};
const ALL_NOBODY = Object.fromEntries(Object.keys(ALL_EVERYONE).map((k) => [k, "nobody"]));

function seed(): SupabaseDouble {
  const t0 = daysAgo(10);
  return installDouble({
    treatment_studies: [{ id: STUDY, study_code: "x", status: "active" }],
    treatment_dimensions: [
      { id: D_CPX, name: "privacy_control_complexity", levels: ["simple", "moderate", "complex"], is_active: true },
      { id: D_DEF, name: "privacy_default", levels: ["private", "neutral", "public"], is_active: true },
    ],
    treatment_study_dimensions: [
      { study_id: STUDY, dimension_id: D_CPX, sort_order: 0, active_levels: null },
      { study_id: STUDY, dimension_id: D_DEF, sort_order: 1, active_levels: ["public", "private"] },
    ],
    study_enrollments: [
      { study_id: STUDY, user_id: "u1", enrolled_at: t0, withdrawn_at: null },
      { study_id: STUDY, user_id: "u2", enrolled_at: t0, withdrawn_at: null },
      { study_id: STUDY, user_id: "u3", enrolled_at: t0, withdrawn_at: daysAgo(1) },
    ],
    users: [
      // "teen" is a real users.role value; "student" is not one the CHECK allows.
      { id: "u1", email: "zelda@example.edu", display_name: "Zelda", role: "teen", created_at: t0 },
      { id: "u2", email: "bartholomew@example.edu", display_name: "Bartholomew", role: "teen", created_at: t0 },
      { id: "u3", email: "cyrus@example.edu", display_name: "Cyrus", role: "teen", created_at: t0 },
    ],
    // The age band lives here, not on users — the export reads effective_band.
    user_profiles: [
      { user_id: "u1", age_band: "adult", effective_band: "adult" },
      { user_id: "u2", age_band: "teen", age_band_override: "adult", effective_band: "adult" },
    ],
    dimension_assignments: [
      { user_id: "u1", dimension_id: D_CPX, level: "complex" },
      { user_id: "u1", dimension_id: D_DEF, level: "public" },
      { user_id: "u2", dimension_id: D_CPX, level: "simple" },
      { user_id: "u2", dimension_id: D_DEF, level: "private" },
    ],
    play_sessions: [
      { id: "ps1", user_id: "u1", status: "completed" },
      { id: "ps2", user_id: "u1", status: "active" },
    ],
    find_completions: [
      { play_session_id: "ps1", completed_at: daysAgo(9) },
      { play_session_id: "ps1", completed_at: daysAgo(8) },
      { play_session_id: "ps2", completed_at: null },
    ],
    points_ledger: [
      { user_id: "u1", amount: 80, source_type: "challenge" },
      { user_id: "u1", amount: 12, source_type: "referral" },
    ],
    minion_links: [{ recruiter_id: "u1", minion_id: "u2" }],
    privacy_index_snapshots: [
      { user_id: "u1", index_value: 0, source: "enrollment", created_at: t0, visibility: { ...ALL_EVERYONE }, conditions: { privacy_control_complexity: "complex", privacy_default: "public" } },
      { user_id: "u1", index_value: 0.125, source: "change", created_at: daysAgo(8), visibility: { ...ALL_EVERYONE, total_score: "nobody" }, conditions: { privacy_control_complexity: "complex", privacy_default: "public" } },
      { user_id: "u1", index_value: 0, source: "change", created_at: daysAgo(6), visibility: { ...ALL_EVERYONE }, conditions: { privacy_control_complexity: "complex", privacy_default: "public" } },
      { user_id: "u2", index_value: 1, source: "enrollment", created_at: t0, visibility: { ...ALL_NOBODY }, conditions: { privacy_control_complexity: "simple", privacy_default: "private" } },
    ],
    privacy_events: [
      { user_id: "u1", event_type: "privacy_view", created_at: daysAgo(9), metadata: {}, conditions: {} },
      { user_id: "u1", event_type: "privacy_field_touch", created_at: daysAgo(9), metadata: {}, conditions: {} },
      { user_id: "u1", event_type: "privacy_field_touch", created_at: daysAgo(9), metadata: {}, conditions: {} },
      { user_id: "u1", event_type: "privacy_change", created_at: daysAgo(8), conditions: { privacy_control_complexity: "complex", privacy_default: "public" },
        metadata: { direction: "tighten", deltas: [{ field: "total_score", from: "everyone", to: "nobody" }] } },
      { user_id: "u1", event_type: "privacy_abandon", created_at: daysAgo(7), metadata: { direction: "none" }, conditions: {} },
      { user_id: "u1", event_type: "privacy_change", created_at: daysAgo(6), conditions: { privacy_control_complexity: "complex", privacy_default: "public" },
        metadata: { direction: "loosen", deltas: [{ field: "total_score", from: "nobody", to: "everyone" }] } },
      { user_id: "u3", event_type: "privacy_change", created_at: daysAgo(5), metadata: { direction: "tighten", deltas: [] }, conditions: {} },
    ],
    surveys: [{ id: T1, title: "Baseline", status: "active" }],
    survey_schedules: [
      { survey_id: T1, trigger_type: "event", trigger_config: { timepoint: "T1", event: "privacy_view", expires_days: 7 }, active: true },
    ],
    survey_questions: [
      { survey_id: T1, item_code: "fat_1", question_type: "likert_7", scale_config: { min: 1, max: 7 }, reverse_coded: false, subscale: "privacy_fatigue", sort_order: 1 },
      { survey_id: T1, item_code: "fat_2", question_type: "likert_7", scale_config: { min: 1, max: 7 }, reverse_coded: true, subscale: "privacy_fatigue", sort_order: 2 },
      { survey_id: T1, item_code: "ideal_total_score", question_type: "multiple_choice", options: [], scale_config: {}, reverse_coded: false, subscale: "ideal_audience", sort_order: 3 },
      { survey_id: T1, item_code: "ideal_badges", question_type: "multiple_choice", options: [], scale_config: {}, reverse_coded: false, subscale: "ideal_audience", sort_order: 4 },
    ],
    survey_deliveries: [
      { survey_id: T1, user_id: "u1", status: "submitted" },
      { survey_id: T1, user_id: "u2", status: "pending" },
    ],
    survey_responses: [
      // Submitted at day 7, when total_score was "nobody" (snapshot at day 8 is the one in force).
      { survey_id: T1, user_id: "u1", created_at: daysAgo(7), answers: { fat_1: 6, fat_2: 2, ideal_total_score: "class", ideal_badges: "everyone" } },
    ],
  });
}

describe("research exports against the Supabase double", () => {
  let db: SupabaseDouble;
  beforeEach(() => {
    db = seed();
  });

  it("participants: one de-identified row per non-withdrawn enrollee with per-dimension columns", async () => {
    const out = await generateResearchExport({ studyId: STUDY, format: "json" });
    const rows = JSON.parse(out) as Record<string, string>[];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.participant_id)).toEqual(["P0001", "P0002"]);

    const text = out.toLowerCase();
    for (const pii of ["zelda", "bartholomew", "cyrus", "example.edu", "display_name", "email"]) {
      expect(text).not.toContain(pii);
    }

    const u1 = rows[0];
    // Demographics come from users + user_profiles.effective_band.
    expect(u1.role).toBe("teen");
    expect(u1.age_band).toBe("adult");
    expect(u1.treatment_privacy_control_complexity).toBe("complex");
    expect(u1.treatment_privacy_default).toBe("public");
    expect(u1.total_hunts_completed).toBe("1");
    expect(u1.total_finds_completed).toBe("2");
    expect(u1.total_points).toBe("92");
    expect(u1.referral_points_earned).toBe("12");
    expect(u1.minion_count).toBe("1");
    expect(u1.privacy_index_t0).toBe("0.0000");
    expect(u1.privacy_index_final).toBe("0.0000");
    expect(u1.privacy_changes_count).toBe("2");
    expect(u1.tighten_count).toBe("1");
    expect(u1.loosen_count).toBe("1");
    expect(u1.abandon_count).toBe("1");
    expect(u1.reversal_count).toBe("1"); // nobody → everyone reversed everyone → nobody
    expect(u1.view_count).toBe("1");
    expect(u1.field_touch_count).toBe("2");
    expect(u1.successful_change_rate).toBe("0.667"); // 2 saves / (2 saves + 1 abandon)
    expect(Number(u1.time_to_first_change_hours)).toBeCloseTo(48, 0);
    expect(u1.total_privacy_events).toBe("6");

    expect(u1.survey_T1_status).toBe("submitted");
    expect(u1.survey_T1_privacy_fatigue).toBe("6.00"); // (6 + reverse(2)=6) / 2
    expect(u1.survey_T1_ideal_audience).toBeUndefined(); // choice block is not a Likert mean
    // ideal total_score=class vs actual nobody (2 ranks off), ideal badges=everyone vs actual everyone (0)
    expect(u1.settings_error_T1).toBe(((2 + 0) / 2 / 3).toFixed(4));
    expect(u1.over_shared_T1).toBe("0");

    const u2 = rows[1];
    expect(u2.treatment_privacy_control_complexity).toBe("simple");
    expect(u2.privacy_index_t0).toBe("1.0000");
    expect(u2.privacy_changes_count).toBe("0");
    expect(u2.successful_change_rate).toBe("");
    expect(u2.survey_T1_status).toBe("pending");
    expect(u2.settings_error_T1).toBe("");
  });

  it("trajectory: one row per snapshot of enrolled participants, with condition columns from JSON", async () => {
    const rows = JSON.parse(await generateTrajectoryExport({ studyId: STUDY, format: "json" })) as Record<string, string>[];
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.participant_id))).toEqual(new Set(["P0001", "P0002"]));
    const first = rows.find((r) => r.participant_id === "P0001" && r.source === "enrollment")!;
    expect(first.treatment_privacy_control_complexity).toBe("complex");
    expect(first.treatment_privacy_default).toBe("public");
    expect(Number(first.days_since_enrollment)).toBeCloseTo(0, 1);
  });

  it("events: excludes withdrawn participants and carries direction and deltas", async () => {
    const rows = JSON.parse(await generateEventsExport({ studyId: STUDY, format: "json" })) as Record<string, string>[];
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.participant_id === "P0001")).toBe(true);
    const changes = rows.filter((r) => r.event_type === "privacy_change");
    expect(changes.map((r) => r.direction)).toEqual(["tighten", "loosen"]);
    expect(changes[0].treatment_privacy_control_complexity).toBe("complex");
    expect(db.table("privacy_events")).toHaveLength(7); // read-only
  });
});
