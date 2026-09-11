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

import { POST as schemeChoice } from "@/app/api/v1/research/scheme-choice/route";
import { POST as withdraw } from "@/app/api/v1/research/withdraw/route";

const TOKEN = "bearer-u1";
const RATINGS = { simple: 2, moderate: 4, complex: 6 };

function post(handler: (r: NextRequest) => Promise<Response>, path: string, body?: unknown, token = TOKEN) {
  return handler(
    new NextRequest(`http://localhost${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
}
const choose = (body: unknown, token?: string) => post(schemeChoice, "/api/v1/research/scheme-choice", body, token);

function seed(metadata: Record<string, unknown>, selections: Record<string, unknown>[] = []): SupabaseDouble {
  return installDouble(
    {
      users: [{ id: "u1", auth_id: "auth-1", role: "student", deleted_at: null, metadata }],
      scheme_selections: selections,
      study_enrollments: [{ id: "e1", study_id: "s1", user_id: "u1", withdrawn_at: null }],
      minion_links: [],
    },
    { authTokens: { [TOKEN]: { id: "auth-1" } }, unique: { scheme_selections: [["user_id", "source"]] } }
  );
}

const meta = (db: SupabaseDouble) => db.table("users")[0].metadata as Record<string, unknown>;

describe("POST /api/v1/research/scheme-choice", () => {
  let db: SupabaseDouble;
  beforeEach(() => {
    db = seed({ dim_scheme_selection: "chosen", privacy_treatment: "moderate" });
  });

  it("records the chosen arm's pick, puts it in force, and refuses a second preview", async () => {
    const res = await choose({ source: "preview", scheme: "complex", ratings: RATINGS, display_order: ["simple", "moderate", "complex"], dwell_ms: 5000 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scheme).toBe("complex");
    expect(body.state).toMatchObject({ needsPreview: false, canSwitch: true });

    expect(meta(db).privacy_treatment).toBe("complex");
    expect(typeof meta(db).scheme_preview_completed_at).toBe("string");
    const rows = db.table("scheme_selections");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "preview", selection_arm: "chosen", scheme_before: "moderate", scheme_after: "complex", ratings: RATINGS });
    // Condition context is stamped from the metadata read before the update.
    expect(rows[0].conditions).toEqual({ privacy_control_complexity: "moderate", scheme_selection: "chosen" });

    expect((await choose({ source: "preview", scheme: "simple", ratings: RATINGS })).status).toBe(409);
  });

  it("honors one switch and refuses a second", async () => {
    await choose({ source: "preview", scheme: "complex", ratings: RATINGS });
    const res = await choose({ source: "switch", scheme: "simple" });
    expect(res.status).toBe(200);
    expect(meta(db).privacy_treatment).toBe("simple");
    expect(typeof meta(db).scheme_switch_used_at).toBe("string");
    expect((await choose({ source: "switch", scheme: "moderate" })).status).toBe(409);
    expect(db.table("scheme_selections")).toHaveLength(2);
  });

  it("re-applies an already-recorded preview instead of leaving the participant stuck", async () => {
    db = seed(
      { dim_scheme_selection: "chosen", privacy_treatment: "moderate" },
      [{ user_id: "u1", source: "preview", selection_arm: "chosen", scheme_before: "moderate", scheme_after: "simple", ratings: RATINGS, display_order: null, dwell_ms: 100 }]
    );
    const res = await choose({ source: "preview", scheme: "complex", ratings: RATINGS });
    expect(res.status).toBe(200);
    expect((await res.json()).scheme).toBe("simple");
    expect(meta(db).privacy_treatment).toBe("simple");
    expect(db.table("scheme_selections")).toHaveLength(1);
  });

  it("validates input and authentication", async () => {
    expect((await choose({ source: "preview", scheme: "complex", ratings: { simple: 9 } })).status).toBe(400);
    expect((await choose({ source: "preview", ratings: RATINGS })).status).toBe(400);
    expect((await choose({ source: "preview", scheme: "complex", ratings: RATINGS }, "nope")).status).toBe(401);
    expect(db.table("scheme_selections")).toHaveLength(0);
  });

  it("is refused for participants without the dimension", async () => {
    db = seed({ privacy_treatment: "moderate" });
    expect((await choose({ source: "preview", ratings: RATINGS })).status).toBe(409);
  });

  it("is refused after withdrawal, which stamps research_withdrawn_at", async () => {
    const res = await post(withdraw, "/api/v1/research/withdraw");
    expect(res.status).toBe(200);
    expect(typeof meta(db).research_withdrawn_at).toBe("string");
    expect(meta(db).dim_scheme_selection).toBe("chosen"); // the assignment stays on record
    expect((await choose({ source: "preview", scheme: "complex", ratings: RATINGS })).status).toBe(409);
  });
});
