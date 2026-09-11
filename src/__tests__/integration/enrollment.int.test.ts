import { describe, it, expect, vi, beforeEach } from "vitest";
import { installDouble, type SupabaseDouble } from "@/__tests__/support/supabase-double";

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return {
    createSupabaseServiceClient: async () => m.current().client,
    createSupabaseServerClient: async () => m.current().client,
  };
});

import { enrollParticipant } from "@/lib/services/enrollment";

const STUDY = "study-1";
const D_COMPLEXITY = "dim-a-complexity";
const D_DEFAULT = "dim-b-default";

function seed(n: number, opts: { consent?: boolean; activeDims?: boolean } = {}): SupabaseDouble {
  const users = Array.from({ length: n }, (_, i) => ({
    id: `u${i + 1}`,
    age_band: "intermediate",
    school_id: null,
    metadata: { existing_key: "keep-me" },
    profile_visibility: {},
    profile_visibility_overrides: {},
  }));
  const consent_records =
    opts.consent === false
      ? []
      : users.map((u) => ({ user_id: u.id, consent_type: "research", granted: true, revoked_at: null }));
  return installDouble({
    treatment_studies: [
      { id: STUDY, study_code: "privacy_fatigue_rep_2026", status: "active", auto_enroll: true, current_sample_size: 0 },
    ],
    treatment_dimensions: [
      {
        id: D_COMPLEXITY,
        name: "privacy_control_complexity",
        levels: ["simple", "moderate", "complex"],
        is_active: opts.activeDims !== false,
      },
      { id: D_DEFAULT, name: "privacy_default", levels: ["private", "neutral", "public"], is_active: opts.activeDims !== false },
    ],
    treatment_study_dimensions: [
      { study_id: STUDY, dimension_id: D_COMPLEXITY, sort_order: 0, active_levels: null },
      { study_id: STUDY, dimension_id: D_DEFAULT, sort_order: 1, active_levels: ["public", "private"] },
    ],
    users,
    consent_records,
    survey_schedules: [],
  });
}

describe("enrollParticipant against the Supabase double", () => {
  let db: SupabaseDouble;
  beforeEach(() => {
    db = seed(24);
  });

  it("assigns every consented user across the six active cells, balanced within one", async () => {
    for (let i = 1; i <= 24; i++) {
      const r = await enrollParticipant(`u${i}`);
      expect(r.enrolled).toBe(true);
    }
    const assignments = db.table("dimension_assignments");
    expect(assignments).toHaveLength(48);

    const byUser = new Map<string, Record<string, string>>();
    for (const a of assignments) {
      const u = String(a.user_id);
      byUser.set(u, { ...(byUser.get(u) || {}), [String(a.dimension_id)]: String(a.level) });
    }
    const cells = new Map<string, number>();
    for (const [, m] of byUser) {
      expect(["simple", "moderate", "complex"]).toContain(m[D_COMPLEXITY]);
      expect(["public", "private"]).toContain(m[D_DEFAULT]); // neutral is not an active level
      const key = `${m[D_COMPLEXITY]}|${m[D_DEFAULT]}`;
      cells.set(key, (cells.get(key) ?? 0) + 1);
    }
    expect(cells.size).toBe(6);
    const counts = [...cells.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("writes condition metadata, condition-aware defaults, a t0 snapshot, and the enrollment", async () => {
    await enrollParticipant("u1");
    const user = db.table("users").find((u) => u.id === "u1")!;
    const meta = user.metadata as Record<string, unknown>;
    expect(meta.existing_key).toBe("keep-me"); // merged, never clobbered
    expect(meta.privacy_treatment).toBe(meta.dim_privacy_control_complexity);
    expect(meta.privacy_default).toBe(meta.dim_privacy_default);
    expect(meta.privacy_friction).toBeNull(); // not a crossed factor in this study

    const vis = user.profile_visibility as Record<string, string>;
    const expected = meta.privacy_default === "public" ? "everyone" : "nobody";
    expect(Object.keys(vis)).toHaveLength(8);
    expect(new Set(Object.values(vis))).toEqual(new Set([expected]));

    const snaps = db.where("privacy_index_snapshots", (s) => s.user_id === "u1");
    expect(snaps).toHaveLength(1);
    expect(snaps[0].source).toBe("enrollment");
    expect(snaps[0].unset).toBe(false);
    expect(snaps[0].conditions).toEqual({
      privacy_control_complexity: meta.privacy_treatment,
      privacy_default: meta.privacy_default,
    });
    expect(snaps[0].index_value).toBe(meta.privacy_default === "public" ? 0 : 1);

    expect(db.where("study_enrollments", (e) => e.user_id === "u1" && e.study_id === STUDY)).toHaveLength(1);
    const study = db.table("treatment_studies")[0];
    expect(study.current_sample_size).toBe(1);
    expect(db.where("behavioral_events", (e) => e.event_type === "study_enrolled" && e.user_id === "u1")).toHaveLength(1);
  });

  it("is idempotent: a second call assigns nothing new", async () => {
    await enrollParticipant("u1");
    const again = await enrollParticipant("u1");
    expect(again.enrolled).toBe(false);
    expect(db.where("dimension_assignments", (a) => a.user_id === "u1")).toHaveLength(2);
    expect(db.where("privacy_index_snapshots", (s) => s.user_id === "u1")).toHaveLength(1);
  });

  it("does nothing for a user without research consent", async () => {
    db = seed(3, { consent: false });
    const r = await enrollParticipant("u1");
    expect(r.enrolled).toBe(false);
    expect(db.table("dimension_assignments")).toHaveLength(0);
    expect(db.table("study_enrollments")).toHaveLength(0);
    expect(db.table("privacy_index_snapshots")).toHaveLength(0);
    expect((db.table("users")[0].metadata as Record<string, unknown>).privacy_treatment).toBeUndefined();
  });

  it("records a study_enrollment_failed event with the stage when assignment throws", async () => {
    db = seed(2, { activeDims: false }); // assignParticipant: "No active dimensions found"
    const r = await enrollParticipant("u1");
    expect(r.enrolled).toBe(false);
    expect(r.error).toMatch(/dimension/i);
    const failures = db.where("behavioral_events", (e) => e.event_name === "study_enrollment_failed");
    expect(failures).toHaveLength(1);
    expect((failures[0].payload as Record<string, unknown>).stage).toBe("randomize");
    expect(db.table("study_enrollments")).toHaveLength(0);
  });

  it("fails loudly instead of dropping a linked dimension that is inactive", async () => {
    db = seed(2);
    db.replace(
      "treatment_dimensions",
      db.table("treatment_dimensions").map((d) => (d.id === D_DEFAULT ? { ...d, is_active: false } : d))
    );
    const r = await enrollParticipant("u1");
    expect(r.enrolled).toBe(false);
    expect(r.error).toContain(D_DEFAULT);
    const failures = db.where("behavioral_events", (e) => e.event_name === "study_enrollment_failed");
    expect((failures[0].payload as Record<string, unknown>).stage).toBe("randomize");
    expect(db.table("dimension_assignments")).toHaveLength(0);
  });
});
