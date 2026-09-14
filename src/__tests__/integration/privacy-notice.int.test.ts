import { describe, it, expect, vi, beforeEach } from "vitest";
import { installDouble, type SupabaseDouble } from "@/__tests__/support/supabase-double";

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return {
    createSupabaseServiceClient: async () => m.current().client,
    createSupabaseServerClient: async () => m.current().client,
  };
});

import { recordPrivacyNotice } from "@/lib/services/privacy-notice";

describe("recordPrivacyNotice against the Supabase double", () => {
  let db: SupabaseDouble;
  beforeEach(() => {
    db = installDouble({
      users: [
        {
          id: "ctx",
          profile_visibility: { total_score: "class" },
          metadata: { privacy_treatment: "moderate", dim_notice_style: "contextual" },
        },
        { id: "spec-unset", profile_visibility: {}, metadata: { dim_notice_style: "specific" } },
        { id: "off", profile_visibility: { total_score: "nobody" }, metadata: { dim_notice_style: "none" } },
        { id: "unlinked", profile_visibility: {}, metadata: {} },
      ],
      notice_events: [],
      study_enrollments: [
        { id: "e1", study_id: "s", user_id: "ctx", withdrawn_at: null },
        { id: "e2", study_id: "s", user_id: "spec-unset", withdrawn_at: null },
        { id: "e3", study_id: "s", user_id: "off", withdrawn_at: null },
      ],
    });
  });

  it("records nothing once the participant has withdrawn", async () => {
    db.table("study_enrollments")[0].withdrawn_at = new Date().toISOString();
    expect(await recordPrivacyNotice("ctx", { findId: "f1", huntId: "h1" })).toBeNull();
    expect(db.table("notice_events")).toHaveLength(0);
  });

  it("records a contextual notice with conditions and returns it with its id", async () => {
    const notice = await recordPrivacyNotice("ctx", { findId: "f1", huntId: "h1" });
    expect(notice).toMatchObject({
      style: "contextual",
      message: "Your class can see this score.",
      link: { href: "/settings/privacy?from=notice", label: "Change who sees it" },
    });
    const rows = db.table("notice_events");
    expect(rows).toHaveLength(1);
    expect(notice?.id).toBe(rows[0].id);
    expect(rows[0]).toMatchObject({
      user_id: "ctx",
      notice_style: "contextual",
      field: "total_score",
      audience_level: "class",
      exposure_number: 1,
      find_id: "f1",
      hunt_id: "h1",
      conditions: { privacy_control_complexity: "moderate", notice_style: "contextual" },
    });
  });

  it("numbers repeated exposures per user", async () => {
    await recordPrivacyNotice("ctx", { findId: "f1", huntId: "h1" });
    await recordPrivacyNotice("spec-unset", { findId: "f1", huntId: "h1" });
    await recordPrivacyNotice("ctx", { findId: "f2", huntId: "h1" });
    await recordPrivacyNotice("ctx", { findId: "f3", huntId: "h1" });
    const mine = db.where("notice_events", (r) => r.user_id === "ctx").map((r) => r.exposure_number);
    expect(mine).toEqual([1, 2, 3]);
    expect(db.where("notice_events", (r) => r.user_id === "spec-unset")[0].exposure_number).toBe(1);
  });

  it("records an unset score field as everyone", async () => {
    const notice = await recordPrivacyNotice("spec-unset", { findId: null, huntId: null });
    expect(notice?.message).toBe("Everyone can see this score.");
    expect(db.table("notice_events")[0].audience_level).toBe("everyone");
  });

  it("records nothing for none or an unlinked dimension", async () => {
    expect(await recordPrivacyNotice("off", { findId: "f1", huntId: "h1" })).toBeNull();
    expect(await recordPrivacyNotice("unlinked", { findId: "f1", huntId: "h1" })).toBeNull();
    expect(await recordPrivacyNotice("missing-user", { findId: "f1", huntId: "h1" })).toBeNull();
    expect(db.table("notice_events")).toHaveLength(0);
  });
});
