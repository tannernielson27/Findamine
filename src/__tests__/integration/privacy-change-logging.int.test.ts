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

import { PUT } from "@/app/api/v1/auth/profile/route";

const TOKEN = "bearer-token-u1";
const ALL_EVERYONE = {
  display_name: "everyone", avatar: "everyone", real_name: "everyone", personality_scores: "everyone",
  badges: "everyone", total_score: "everyone", hunt_history: "everyone", friends_list: "everyone",
};
const TIGHTER = { ...ALL_EVERYONE, total_score: "nobody", real_name: "team" };

function put(body: unknown) {
  return PUT(
    new NextRequest("http://localhost/api/v1/auth/profile", {
      method: "PUT",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

describe("PUT /api/v1/auth/profile privacy-change logging", () => {
  let db: SupabaseDouble;
  beforeEach(() => {
    db = installDouble(
      {
        users: [
          {
            id: "u1", auth_id: "auth-1", role: "teen", deleted_at: null, display_name: "Ada",
            profile_visibility: { ...ALL_EVERYONE },
            profile_visibility_overrides: {},
            metadata: {
              privacy_treatment: "moderate", privacy_default: "public", privacy_friction: "low",
              dim_privacy_control_complexity: "moderate", dim_privacy_default: "public", dim_privacy_friction: "low",
            },
          },
          { id: "friend", auth_id: "auth-2", role: "teen", deleted_at: null },
        ],
        friend_connections: [{ requester_id: "friend", addressee_id: "u1", status: "accepted" }],
        minion_links: [],
      },
      { authTokens: { [TOKEN]: { id: "auth-1" } } }
    );
  });

  it("writes one authoritative privacy_change event and one change snapshot", async () => {
    const res = await put({
      profile_visibility: TIGHTER,
      privacy_meta: { duration_ms: 4321, click_count: 3, session_id: "sess-1" },
    });
    expect(res.status).toBe(200);

    const events = db.table("privacy_events");
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.event_type).toBe("privacy_change");
    expect(ev.old_value).toEqual(ALL_EVERYONE);
    expect(ev.new_value).toEqual(TIGHTER);
    expect(ev.duration_ms).toBe(4321);
    expect(ev.click_count).toBe(3);
    expect(ev.session_id).toBe("sess-1");
    expect(ev.treatment).toBe("moderate");
    expect(ev.privacy_default).toBe("public");
    expect(ev.conditions).toEqual({
      privacy_control_complexity: "moderate", privacy_default: "public", privacy_friction: "low",
    });
    const meta = ev.metadata as Record<string, unknown>;
    expect(meta.direction).toBe("tighten");
    expect(meta.index_before).toBe(0);
    expect(meta.index_after).toBeGreaterThan(0);
    expect(meta.source).toBe("server");
    expect((meta.deltas as unknown[]).length).toBe(2);

    const snaps = db.table("privacy_index_snapshots");
    expect(snaps).toHaveLength(1);
    expect(snaps[0].source).toBe("change");
    expect(snaps[0].index_value).toBe(meta.index_after);
    expect(snaps[0].conditions).toEqual(ev.conditions);

    const user = db.table("users").find((u) => u.id === "u1")!;
    expect(user.profile_visibility).toEqual(TIGHTER);
    expect((user.metadata as Record<string, unknown>).privacy_first_choice_at).toBeTruthy();
  });

  it("drops client-supplied condition keys, including dim_* keys", async () => {
    await put({
      profile_visibility: TIGHTER,
      metadata: { privacy_treatment: "complex", dim_privacy_default: "private", nickname: "ok" },
    });
    const meta = db.table("users").find((u) => u.id === "u1")!.metadata as Record<string, unknown>;
    expect(meta.privacy_treatment).toBe("moderate");
    expect(meta.dim_privacy_default).toBe("public");
    expect(meta.nickname).toBe("ok");
    // The event was stamped from the server-owned metadata, not the payload.
    expect(db.table("privacy_events")[0].treatment).toBe("moderate");
  });

  it("logs nothing when the map does not change", async () => {
    await put({ profile_visibility: { ...ALL_EVERYONE } });
    expect(db.table("privacy_events")).toHaveLength(0);
    expect(db.table("privacy_index_snapshots")).toHaveLength(0);
    expect((db.table("users")[0].metadata as Record<string, unknown>).privacy_first_choice_at).toBeUndefined();
  });

  it("accepts per-person overrides only for friends and minions, and logs them as a change", async () => {
    const res = await put({
      profile_visibility: { ...ALL_EVERYONE },
      profile_visibility_overrides: {
        friend: { total_score: "nobody", bogus_field: "nobody" },
        stranger: { total_score: "nobody" },
      },
    });
    expect(res.status).toBe(200);
    const user = db.table("users").find((u) => u.id === "u1")!;
    expect(user.profile_visibility_overrides).toEqual({ friend: { total_score: "nobody" } });

    const events = db.table("privacy_events");
    expect(events).toHaveLength(1);
    const meta = events[0].metadata as Record<string, unknown>;
    expect(meta.direction).toBe("none"); // no audience-level field moved
    expect(meta.override_count_before).toBe(0);
    expect(meta.override_count_after).toBe(1);
    expect(meta.overrides_changed).toBe(true);
    expect(db.table("privacy_index_snapshots")[0].override_count).toBe(1);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await PUT(
      new NextRequest("http://localhost/api/v1/auth/profile", {
        method: "PUT",
        headers: { authorization: "Bearer nope", "content-type": "application/json" },
        body: JSON.stringify({ profile_visibility: TIGHTER }),
      })
    );
    expect(res.status).toBe(401);
    expect(db.table("privacy_events")).toHaveLength(0);
  });
});
