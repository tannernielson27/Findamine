import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, daysAgo, type SupabaseDouble } from "@/__tests__/support/supabase-double";

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return {
    createSupabaseServiceClient: async () => m.current().client,
    createSupabaseServerClient: async () => m.current().client,
  };
});

import { GET } from "@/app/api/cron/privacy-snapshots/route";

const SECRET = "test-cron-secret";

function call(auth?: string) {
  return GET(
    new NextRequest("http://localhost/api/cron/privacy-snapshots", {
      headers: auth ? { authorization: auth } : {},
    })
  );
}

describe("GET /api/cron/privacy-snapshots against the Supabase double", () => {
  let db: SupabaseDouble;
  const prev = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    db = installDouble({
      study_enrollments: [
        { study_id: "s", user_id: "u1", enrolled_at: daysAgo(3), withdrawn_at: null },
        { study_id: "s", user_id: "u1", enrolled_at: daysAgo(3), withdrawn_at: null }, // duplicate row, must dedupe
        { study_id: "s", user_id: "u2", enrolled_at: daysAgo(3), withdrawn_at: daysAgo(1) },
      ],
      users: [
        {
          id: "u1",
          profile_visibility: {
            display_name: "everyone", avatar: "everyone", real_name: "nobody", personality_scores: "nobody",
            badges: "everyone", total_score: "everyone", hunt_history: "everyone", friends_list: "everyone",
          },
          profile_visibility_overrides: { friend: { total_score: "nobody", badges: "everyone" } },
          metadata: { privacy_treatment: "complex", privacy_default: "public", dim_privacy_friction: "high" },
        },
        { id: "u2", profile_visibility: {}, profile_visibility_overrides: {}, metadata: {} },
      ],
    });
  });

  afterEach(() => {
    process.env.CRON_SECRET = prev;
  });

  it("snapshots every non-withdrawn enrollee once with condition context and override count", async () => {
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ participants: 1, snapshots: 1 });

    const snaps = db.table("privacy_index_snapshots");
    expect(snaps).toHaveLength(1);
    const s = snaps[0];
    expect(s.user_id).toBe("u1");
    expect(s.source).toBe("scheduled");
    expect(s.index_value).toBeCloseTo(2 / 8, 5); // two of eight fields fully private
    expect(s.unset).toBe(false);
    expect(s.treatment).toBe("complex");
    expect(s.privacy_default).toBe("public");
    expect(s.conditions).toEqual({
      privacy_control_complexity: "complex", privacy_default: "public", privacy_friction: "high",
    });
    expect(s.override_count).toBe(2);
  });

  it("rejects a missing or wrong secret without touching the database", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect(db.table("privacy_index_snapshots")).toHaveLength(0);
    expect(db.log).toHaveLength(0);
  });

  it("reports zero when nobody is enrolled", async () => {
    db = installDouble({ study_enrollments: [], users: [] });
    const res = await call(`Bearer ${SECRET}`);
    expect(await res.json()).toEqual({ participants: 0, snapshots: 0 });
  });
});
