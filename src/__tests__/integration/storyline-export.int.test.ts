import { describe, it, expect, vi, beforeEach } from "vitest";
import { installDouble, daysAgo } from "@/__tests__/support/supabase-double";

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return {
    createSupabaseServiceClient: async () => m.current().client,
    createSupabaseServerClient: async () => m.current().client,
  };
});

import { generateResearchExport } from "@/lib/services/research-export";
import { generateStorylineEventsExport } from "@/lib/services/storyline-events-export";

const STUDY = "study-2";
const DIMS = [
  { id: "d-ss", name: "scheme_selection", levels: ["assigned", "chosen"] },
  { id: "d-ns", name: "notice_style", levels: ["none", "generic", "specific", "contextual"] },
  { id: "d-pc", name: "privacy_checkin", levels: ["none", "biweekly", "weekly"] },
  { id: "d-nl", name: "norm_line", levels: ["none", "descriptive"] },
];
const EXPOSURE = "11111111-1111-4111-8111-111111111111";

function seed() {
  const t0 = daysAgo(20);
  installDouble({
    treatment_studies: [{ id: STUDY, study_code: "cohort2", status: "active" }],
    treatment_dimensions: DIMS.map((d) => ({ ...d, is_active: true })),
    treatment_study_dimensions: DIMS.map((d, i) => ({ study_id: STUDY, dimension_id: d.id, sort_order: i, active_levels: null })),
    study_enrollments: [
      { study_id: STUDY, user_id: "u1", enrolled_at: t0, withdrawn_at: null },
      { study_id: STUDY, user_id: "u2", enrolled_at: t0, withdrawn_at: null },
      { study_id: STUDY, user_id: "u3", enrolled_at: t0, withdrawn_at: daysAgo(2) },
    ],
    users: ["u1", "u2", "u3"].map((id) => ({ id, email: `${id}@example.edu`, role: "student", age_band: "adult", created_at: t0 })),
    dimension_assignments: [
      { user_id: "u1", dimension_id: "d-ss", level: "chosen" },
      { user_id: "u1", dimension_id: "d-ns", level: "contextual" },
      { user_id: "u1", dimension_id: "d-pc", level: "none" },
      { user_id: "u1", dimension_id: "d-nl", level: "descriptive" },
      { user_id: "u2", dimension_id: "d-ss", level: "assigned" },
      { user_id: "u2", dimension_id: "d-ns", level: "none" },
      { user_id: "u2", dimension_id: "d-pc", level: "weekly" },
      { user_id: "u2", dimension_id: "d-nl", level: "none" },
    ],
    play_sessions: [],
    find_completions: [],
    points_ledger: [],
    minion_links: [],
    privacy_index_snapshots: [],
    privacy_events: [
      {
        user_id: "u1", event_type: "privacy_change", created_at: daysAgo(15), norm_exposure_id: EXPOSURE, conditions: {},
        metadata: { direction: "tighten", deltas: [{ field: "total_score", from: "everyone", to: "nobody" }] },
      },
      { user_id: "u1", event_type: "privacy_view", created_at: daysAgo(10), metadata: { entry_source: "notice" }, conditions: {} },
      { user_id: "u2", event_type: "privacy_view", created_at: daysAgo(12), metadata: { entry_source: "checkin" }, conditions: {} },
    ],
    survey_schedules: [],
    survey_questions: [],
    survey_deliveries: [],
    survey_responses: [],
    scheme_selections: [
      { user_id: "u1", source: "preview", selection_arm: "chosen", scheme_before: "moderate", scheme_after: "complex", ratings: { simple: 2, moderate: 5, complex: 7 }, display_order: ["complex", "moderate", "simple"], dwell_ms: 30000 },
      { user_id: "u2", source: "preview", selection_arm: "assigned", scheme_before: "simple", scheme_after: "simple", ratings: { simple: 6, moderate: 4, complex: 1 }, display_order: ["simple", "complex", "moderate"], dwell_ms: 12000 },
    ],
    notice_events: [
      { user_id: "u1", exposure_number: 1, notice_style: "contextual", audience_level: "everyone", delivered_at: daysAgo(14), displayed_at: daysAgo(14), dismissed_at: daysAgo(14), dismissed_auto: true, link_clicked_at: null, dwell_ms: 8000, conditions: { notice_style: "contextual" } },
      { user_id: "u1", exposure_number: 2, notice_style: "contextual", audience_level: "nobody", delivered_at: daysAgo(10), displayed_at: daysAgo(10), dismissed_at: null, dismissed_auto: null, link_clicked_at: daysAgo(10), dwell_ms: 2500, conditions: { notice_style: "contextual" } },
      { user_id: "u3", exposure_number: 1, notice_style: "generic", audience_level: "class", delivered_at: daysAgo(5), displayed_at: null, dismissed_at: null, dismissed_auto: null, link_clicked_at: null, dwell_ms: null, conditions: {} },
    ],
    privacy_checkin_events: [
      { user_id: "u2", notification_id: "n1", cadence: "weekly", exposure_number: 1, action: "delivered", reason: null, latency_ms: null, created_at: daysAgo(13), conditions: { privacy_checkin: "weekly" } },
      { user_id: "u2", notification_id: "n1", cadence: "weekly", exposure_number: 1, action: "opened", reason: null, latency_ms: 90000, created_at: daysAgo(12), conditions: { privacy_checkin: "weekly" } },
      { user_id: "u2", notification_id: "n2", cadence: "weekly", exposure_number: 2, action: "delivered", reason: null, latency_ms: null, created_at: daysAgo(6), conditions: { privacy_checkin: "weekly" } },
    ],
    norm_exposures: [{ id: EXPOSURE, user_id: "u1", share_shown: 0.62, created_at: daysAgo(15) }],
  });
}

describe("storyline columns and dataset against the Supabase double", () => {
  beforeEach(seed);

  it("participants: adds the four storyline blocks when their dimensions are in the study", async () => {
    const rows = JSON.parse(await generateResearchExport({ studyId: STUDY, format: "json" })) as Record<string, string>[];
    expect(rows).toHaveLength(2);
    const [u1, u2] = rows;

    expect(u1.treatment_scheme_selection).toBe("chosen");
    expect(u1.scheme_after_preview).toBe("complex");
    expect(u1.expected_utility_complex).toBe("7");
    expect(u1.scheme_chosen_position).toBe("1");
    expect(u1.scheme_final).toBe("complex");
    expect(u1.notices_delivered).toBe("2");
    expect(u1.notices_clicked).toBe("1");
    expect(u1.notices_dismissed_auto).toBe("1");
    expect(u1.notice_link_visits).toBe("1");
    expect(u1.norm_exposures).toBe("1");
    expect(u1.norm_share_first_shown).toBe("0.6200");
    expect(u1.norm_first_save_score_direction).toBe("tighten");

    expect(u2.scheme_final).toBe("simple");
    expect(u2.checkins_delivered).toBe("2");
    expect(u2.checkins_opened).toBe("1");
    expect(u2.checkin_open_rate).toBe("0.500");
    expect(u2.checkin_median_open_latency_ms).toBe("90000");
    expect(u2.checkin_visits).toBe("1");
    expect(u2.norm_exposures).toBe("0");

    expect(JSON.stringify(rows).toLowerCase()).not.toContain("example.edu");
  });

  it("storylines: one row per notice and check-in delivery, withdrawn participants excluded", async () => {
    const rows = JSON.parse(await generateStorylineEventsExport({ studyId: STUDY, format: "json" })) as Record<string, string>[];
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.participant_id === "P0001" || r.participant_id === "P0002")).toBe(true);

    const notices = rows.filter((r) => r.storyline === "S6");
    expect(notices.map((r) => [r.exposure_number, r.outcome, r.responded])).toEqual([
      ["1", "auto_dismissed", "0"],
      ["2", "clicked", "1"],
    ]);
    expect(notices[0].treatment_notice_style).toBe("contextual");

    const checkins = rows.filter((r) => r.storyline === "S4");
    expect(checkins.map((r) => [r.exposure_number, r.outcome, r.latency_ms])).toEqual([
      ["1", "opened", "90000"],
      ["2", "ignored", ""],
    ]);
    expect(Number(checkins[0].days_since_enrollment)).toBeCloseTo(7, 0);
  });
});
