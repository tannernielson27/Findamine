import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, type SupabaseDouble } from "@/__tests__/support/supabase-double";

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return {
    createSupabaseServiceClient: async () => m.current().client,
    createSupabaseServerClient: async () => m.current().client,
  };
});

import { computeAndStoreClassNorms, serveNormExposure, ownsNormExposure } from "@/lib/services/class-norms";
import { GET as classNormsCron } from "@/app/api/cron/class-norms/route";
import { PUT as profilePut } from "@/app/api/v1/auth/profile/route";

const SECRET = "cron-secret";
const TOKEN = "bearer-s1";
const HIDDEN = { total_score: "nobody" };
const SHOWN = { total_score: "everyone" };

function seed(): SupabaseDouble {
  const student = (id: string, visibility: Record<string, string>, metadata: Record<string, unknown> = {}) => ({
    id, auth_id: `auth-${id}`, role: "teen", deleted_at: null, profile_visibility: visibility,
    profile_visibility_overrides: {}, metadata,
  });
  return installDouble(
    {
      rosters: [
        { id: "r1", deleted_at: null },
        { id: "r2", deleted_at: null },
        { id: "r3", deleted_at: "2026-09-01T00:00:00Z" },
      ],
      roster_entries: [
        ...["s1", "s2", "s3", "s4", "s5", "s6"].map((s) => ({ roster_id: "r1", student_id: s })),
        ...["s7", "s8", "s9"].map((s) => ({ roster_id: "r2", student_id: s })),
        ...["s1", "s2", "s3", "s4", "s5", "s6"].map((s) => ({ roster_id: "r3", student_id: s })),
      ],
      users: [
        student("s1", SHOWN, { dim_norm_line: "descriptive" }),
        student("s2", HIDDEN, { dim_norm_line: "none" }),
        student("s3", { total_score: "class" }),
        student("s4", SHOWN),
        student("s5", {}),
        student("s6", HIDDEN),
        student("s7", HIDDEN, { dim_norm_line: "descriptive" }),
        student("s8", SHOWN),
        student("s9", SHOWN),
      ],
      class_norm_stats: [],
      norm_exposures: [],
      behavioral_events: [],
      privacy_events: [],
      privacy_index_snapshots: [],
      friend_connections: [],
      minion_links: [],
    },
    {
      authTokens: { [TOKEN]: { id: "auth-s1" } },
      unique: { class_norm_stats: [["roster_id", "computed_on", "field"]] },
    }
  );
}

describe("class norms (S5) against the Supabase double", () => {
  let db: SupabaseDouble;
  beforeEach(() => {
    db = seed();
    process.env.CRON_SECRET = SECRET;
  });

  it("computes one statistic per live class of five or more, idempotently per day", async () => {
    expect(await computeAndStoreClassNorms("2026-09-11")).toEqual({ rosters: 2, written: 1, skipped_small: 1 });
    await computeAndStoreClassNorms("2026-09-11");
    const stats = db.table("class_norm_stats");
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ roster_id: "r1", n_players: 6, n_hidden: 3, share_hidden: 0.5, field: "total_score" });
  });

  it("serves and logs the line for the descriptive arm only", async () => {
    await computeAndStoreClassNorms("2026-09-11");

    const shown = await serveNormExposure("s1", "settings_privacy");
    expect(shown.norm?.message).toBe("50% of players in your class hide their score from Everyone.");
    const exposures = db.table("norm_exposures");
    expect(exposures).toHaveLength(1);
    expect(exposures[0]).toMatchObject({ user_id: "s1", norm_type: "descriptive", roster_id: "r1", share_shown: 0.5, conditions: { norm_line: "descriptive" } });
    expect(shown.exposure_id).toBe(exposures[0].id);

    expect(await serveNormExposure("s2", "settings_privacy")).toEqual({ type: "none", norm: null, exposure_id: null });

    // s7's only class is below the size floor: no line, but the gap is logged.
    const small = await serveNormExposure("s7", "settings_privacy");
    expect(small).toMatchObject({ type: "descriptive", norm: null, reason: "no_class_stat" });
    expect(db.where("behavioral_events", (e) => e.event_name === "norm_unavailable" && e.user_id === "s7")).toHaveLength(1);
    expect(db.table("norm_exposures")).toHaveLength(1);
  });

  it("stamps only the saver's own exposure on the privacy_change row", async () => {
    await computeAndStoreClassNorms("2026-09-11");
    const { exposure_id } = await serveNormExposure("s1", "settings_privacy");
    expect(await ownsNormExposure("s1", exposure_id)).toBe(true);
    expect(await ownsNormExposure("s2", exposure_id)).toBe(false);
    expect(await ownsNormExposure("s1", "not-a-uuid")).toBe(false);

    const save = (id: string | null, visibility: Record<string, string>) =>
      profilePut(
        new NextRequest("http://localhost/api/v1/auth/profile", {
          method: "PUT",
          headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
          body: JSON.stringify({ profile_visibility: visibility, privacy_meta: { norm_exposure_id: id } }),
        })
      );

    expect((await save(exposure_id, HIDDEN)).status).toBe(200);
    expect((await save("22222222-2222-4222-8222-222222222222", SHOWN)).status).toBe(200);
    const changes = db.where("privacy_events", (e) => e.event_type === "privacy_change");
    expect(changes.map((c) => c.norm_exposure_id)).toEqual([exposure_id, null]);
  });

  it("cron requires the secret", async () => {
    const call = (auth?: string) =>
      classNormsCron(new NextRequest("http://localhost/api/cron/class-norms", { headers: auth ? { authorization: auth } : {} }));
    expect((await call()).status).toBe(401);
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ written: 1 });
  });
});
