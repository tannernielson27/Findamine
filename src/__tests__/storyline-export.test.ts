import { describe, it, expect } from "vitest";
import {
  median,
  summarizeScheme,
  summarizeNotices,
  summarizeCheckins,
  summarizeNorms,
  SCHEME_HEADERS,
  NOTICE_HEADERS,
  CHECKIN_HEADERS,
  NORM_HEADERS,
  type PrivacyEventLite,
} from "@/lib/services/storyline-export";

const at = (iso: string) => iso;
const row = (headers: string[], values: string[]) => Object.fromEntries(headers.map((h, i) => [h, values[i]]));

describe("median", () => {
  it("handles empty, odd and even inputs", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("summarizeScheme", () => {
  it("reports ratings, the chosen card's position, switch requests and the final scheme", () => {
    const events: PrivacyEventLite[] = [
      { user_id: "u", event_type: "privacy_field_touch", metadata: { scope: "scheme_switch:opened" }, created_at: at("2026-09-02") },
      { user_id: "u", event_type: "privacy_field_touch", metadata: { scope: "scheme_switch:cancelled" }, created_at: at("2026-09-02") },
      { user_id: "u", event_type: "privacy_field_touch", metadata: { scope: "scheme_switch:opened" }, created_at: at("2026-09-03") },
    ];
    const r = row(
      SCHEME_HEADERS,
      summarizeScheme(
        [
          { user_id: "u", source: "preview", scheme_before: "moderate", scheme_after: "complex", ratings: { simple: 2, moderate: 4, complex: 7 }, display_order: ["simple", "complex", "moderate"], dwell_ms: 42_000 },
          { user_id: "u", source: "switch", scheme_before: "complex", scheme_after: "simple", ratings: null, display_order: null, dwell_ms: null },
        ],
        events
      )
    );
    expect(r).toEqual({
      scheme_preview_completed: "1",
      scheme_initial: "moderate",
      scheme_after_preview: "complex",
      expected_utility_simple: "2",
      expected_utility_moderate: "4",
      expected_utility_complex: "7",
      scheme_preview_dwell_ms: "42000",
      scheme_preview_order: "simple>complex>moderate",
      scheme_chosen_position: "2",
      scheme_switch_opened_count: "2",
      scheme_switch_used: "1",
      scheme_switched_to: "simple",
      scheme_final: "simple",
    });
  });

  it("is blank for a participant who never finished the preview", () => {
    const r = row(SCHEME_HEADERS, summarizeScheme([], []));
    expect(r.scheme_preview_completed).toBe("0");
    expect(r.scheme_final).toBe("");
    expect(r.scheme_switch_used).toBe("0");
  });
});

describe("summarizeNotices", () => {
  it("counts delivery, display, clicks and dismissals, with median dwell and first click", () => {
    const base = { user_id: "u", notice_style: "contextual", audience_level: "class", delivered_at: at("2026-09-01") };
    const r = row(
      NOTICE_HEADERS,
      summarizeNotices(
        [
          { ...base, exposure_number: 1, displayed_at: "x", dismissed_at: "x", dismissed_auto: true, link_clicked_at: null, dwell_ms: 8000 },
          { ...base, exposure_number: 2, displayed_at: "x", dismissed_at: null, dismissed_auto: null, link_clicked_at: "x", dwell_ms: 2000 },
          { ...base, exposure_number: 3, displayed_at: "x", dismissed_at: "x", dismissed_auto: false, link_clicked_at: null, dwell_ms: 3000 },
          { ...base, exposure_number: 4, displayed_at: null, dismissed_at: null, dismissed_auto: null, link_clicked_at: null, dwell_ms: null },
        ],
        [{ user_id: "u", event_type: "privacy_view", metadata: { entry_source: "notice" }, created_at: at("2026-09-02") }]
      )
    );
    expect(r).toEqual({
      notices_delivered: "4",
      notices_displayed: "3",
      notices_clicked: "1",
      notice_click_rate: "0.250",
      notices_dismissed_manual: "1",
      notices_dismissed_auto: "1",
      notice_median_dwell_ms: "3000",
      first_notice_click_exposure: "2",
      notice_link_visits: "1",
    });
  });
});

describe("summarizeCheckins", () => {
  it("summarizes responses and counts saves within a day of a delivery", () => {
    const d1 = "2026-09-08T17:00:00.000Z";
    const d2 = "2026-09-15T17:00:00.000Z";
    const base = { user_id: "u", cadence: "weekly", reason: null };
    const r = row(
      CHECKIN_HEADERS,
      summarizeCheckins(
        [
          { ...base, notification_id: "n1", exposure_number: 1, action: "delivered", latency_ms: null, created_at: d1 },
          { ...base, notification_id: "n2", exposure_number: 2, action: "delivered", latency_ms: null, created_at: d2 },
          { ...base, notification_id: "n2", exposure_number: null, action: "opened", latency_ms: 60_000, created_at: d2 },
          { ...base, notification_id: "n1", exposure_number: null, action: "dismissed", latency_ms: 5_000, created_at: d1 },
          { ...base, notification_id: null, exposure_number: 3, action: "skipped", reason: "opted_out", latency_ms: null, created_at: d2 },
        ],
        [
          { user_id: "u", event_type: "privacy_view", metadata: { entry_source: "checkin" }, created_at: d2 },
          { user_id: "u", event_type: "privacy_change", metadata: {}, created_at: "2026-09-15T18:00:00.000Z" },
          { user_id: "u", event_type: "privacy_change", metadata: {}, created_at: "2026-09-12T18:00:00.000Z" },
        ]
      )
    );
    expect(r).toEqual({
      checkins_delivered: "2",
      checkins_opened: "1",
      checkins_dismissed: "1",
      checkins_skipped_optout: "1",
      checkin_open_rate: "0.500",
      checkin_median_open_latency_ms: "60000",
      checkin_median_dismiss_latency_ms: "5000",
      checkin_first_open_exposure: "2",
      checkin_visits: "1",
      checkin_saves_within_24h: "1",
    });
  });
});

describe("summarizeNorms", () => {
  it("reads the first stamped save's overall and score-only direction", () => {
    const r = row(
      NORM_HEADERS,
      summarizeNorms(
        [
          { id: "e2", user_id: "u", share_shown: "0.6200", created_at: at("2026-09-05") },
          { id: "e1", user_id: "u", share_shown: 0.58, created_at: at("2026-09-04") },
        ],
        [
          { user_id: "u", event_type: "privacy_change", metadata: { direction: "loosen" }, norm_exposure_id: null, created_at: at("2026-09-03") },
          {
            user_id: "u",
            event_type: "privacy_change",
            norm_exposure_id: "e1",
            created_at: at("2026-09-04"),
            metadata: {
              direction: "mixed",
              deltas: [
                { field: "total_score", from: "everyone", to: "class" },
                { field: "badges", from: "nobody", to: "everyone" },
              ],
            },
          },
        ]
      )
    );
    expect(r).toEqual({
      norm_exposures: "2",
      norm_share_first_shown: "0.5800",
      norm_first_save_direction: "mixed",
      norm_first_save_score_direction: "tighten",
    });
  });

  it("is blank when no save carried an exposure", () => {
    const r = row(NORM_HEADERS, summarizeNorms([], []));
    expect(r).toEqual({ norm_exposures: "0", norm_share_first_shown: "", norm_first_save_direction: "", norm_first_save_score_direction: "" });
  });
});
