import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { installDouble, daysAgo, type SupabaseDouble } from "@/__tests__/support/supabase-double";

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return {
    createSupabaseServiceClient: async () => m.current().client,
    createSupabaseServerClient: async () => m.current().client,
  };
});

import { GET } from "@/app/api/cron/privacy-checkins/route";
import { POST } from "@/app/api/v1/research/checkin-events/route";

const SECRET = "test-cron-secret";
const MIN = 60_000;
const TOKEN = "tok-u1";

function runCron(auth: string | null = `Bearer ${SECRET}`) {
  return GET(
    new NextRequest("http://localhost/api/cron/privacy-checkins", {
      headers: auth !== null ? { authorization: auth } : {},
    })
  );
}

function respond(body: unknown, token = TOKEN) {
  return POST(
    new NextRequest("http://localhost/api/v1/research/checkin-events", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

const enrolled = (user_id: string, days: number, withdrawn_at: string | null = null) => ({
  study_id: "s",
  user_id,
  enrolled_at: new Date(Date.now() - days * 86_400_000 - MIN).toISOString(),
  withdrawn_at,
});

describe("GET /api/cron/privacy-checkins against the Supabase double", () => {
  let db: SupabaseDouble;
  const prev = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    db = installDouble({
      study_enrollments: [
        enrolled("weekly7", 7),
        enrolled("weekly8", 8),
        enrolled("biweekly10", 10),
        enrolled("none", 30),
        enrolled("optout", 7),
        enrolled("gone", 30, daysAgo(1)),
      ],
      users: [
        { id: "weekly7", metadata: { dim_privacy_checkin: "weekly", privacy_treatment: "complex" } },
        { id: "weekly8", metadata: { dim_privacy_checkin: "weekly" } },
        { id: "biweekly10", metadata: { dim_privacy_checkin: "biweekly" } },
        { id: "none", metadata: { dim_privacy_checkin: "none" } },
        { id: "optout", metadata: { dim_privacy_checkin: "weekly" } },
        { id: "gone", metadata: { dim_privacy_checkin: "weekly" } },
      ],
      notification_preferences: [
        { user_id: "optout", push_enabled: true, disabled_types: ["privacy_checkin"] },
      ],
      privacy_checkin_events: [
        // weekly8 already received its first check-in yesterday (day 7).
        { user_id: "weekly8", action: "delivered", cadence: "weekly", exposure_number: 1, created_at: daysAgo(1) },
      ],
    });
  });

  afterEach(() => {
    process.env.CRON_SECRET = prev;
  });

  it("sends only to participants whose slot is due, once, with exposure number and conditions", async () => {
    const res = await runCron();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      participants_considered: 5,
      none_arm: 1,
      checkins_sent: 1,
      skipped_opted_out: 1,
    });

    const notes = db.table("notifications");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      user_id: "weekly7",
      type: "privacy_checkin",
      entity_type: "privacy_checkin",
      title: "Review your privacy settings",
    });

    const delivered = db.where("privacy_checkin_events", (r) => r.action === "delivered" && r.user_id === "weekly7");
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      notification_id: notes[0].id,
      cadence: "weekly",
      exposure_number: 1,
      conditions: { privacy_checkin: "weekly", privacy_control_complexity: "complex" },
    });

    const skipped = db.where("privacy_checkin_events", (r) => r.action === "skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ user_id: "optout", reason: "opted_out", cadence: "weekly" });
  });

  it("is idempotent within a slot: a second run the same day sends and skips nothing", async () => {
    await runCron();
    const res = await runCron();
    expect(await res.json()).toMatchObject({ checkins_sent: 0, skipped_opted_out: 0 });
    expect(db.table("notifications")).toHaveLength(1);
    expect(db.where("privacy_checkin_events", (r) => r.action === "skipped")).toHaveLength(1);
  });

  it("rejects a missing or wrong secret without touching the database", async () => {
    expect((await runCron(null)).status).toBe(401);
    expect((await runCron("Bearer wrong")).status).toBe(401);
    expect(db.log).toHaveLength(0);
  });
});

describe("POST /api/v1/research/checkin-events against the Supabase double", () => {
  let db: SupabaseDouble;
  const noteId = randomUUID();
  const otherNoteId = randomUUID();
  const reminderId = randomUUID();

  beforeEach(() => {
    db = installDouble(
      {
        users: [
          { id: "u1", auth_id: "auth-1", role: "student", metadata: { dim_privacy_checkin: "biweekly" } },
          { id: "u2", auth_id: "auth-2", role: "student", metadata: {} },
        ],
        study_enrollments: [{ study_id: "s", user_id: "u1", enrolled_at: daysAgo(20), withdrawn_at: null }],
        notifications: [
          { id: noteId, user_id: "u1", type: "privacy_checkin", title: "t", created_at: daysAgo(1) },
          { id: otherNoteId, user_id: "u2", type: "privacy_checkin", title: "t", created_at: daysAgo(1) },
          { id: reminderId, user_id: "u1", type: "survey_reminder", title: "t", created_at: daysAgo(1) },
        ],
        privacy_checkin_events: [
          { user_id: "u1", notification_id: noteId, action: "delivered", cadence: "biweekly", exposure_number: 1, created_at: daysAgo(1) },
        ],
      },
      { authTokens: { [TOKEN]: { id: "auth-1" } } }
    );
  });

  it("records the first open with latency, cadence and exposure from delivery", async () => {
    const res = await respond({ notification_id: noteId, action: "opened" });
    expect(res.status).toBe(201);
    const opened = db.where("privacy_checkin_events", (r) => r.action === "opened");
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      user_id: "u1",
      notification_id: noteId,
      cadence: "biweekly",
      exposure_number: 1,
      reason: null,
      conditions: { privacy_checkin: "biweekly" },
    });
    expect(opened[0].latency_ms as number).toBeGreaterThanOrEqual(86_400_000 - MIN);
  });

  it("ignores repeats and records open and dismiss separately", async () => {
    await respond({ notification_id: noteId, action: "opened" });
    const again = await respond({ notification_id: noteId, action: "opened" });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ recorded: false, duplicate: true });

    const dismissed = await respond({ notification_id: noteId, action: "dismissed", reason: "mark_all" });
    expect(dismissed.status).toBe(201);
    expect(db.where("privacy_checkin_events", (r) => r.action === "opened")).toHaveLength(1);
    expect(db.where("privacy_checkin_events", (r) => r.action === "dismissed")[0].reason).toBe("mark_all");
  });

  it("404s for another user's check-in or a non-check-in notification, 400s on a bad body", async () => {
    expect((await respond({ notification_id: otherNoteId, action: "opened" })).status).toBe(404);
    expect((await respond({ notification_id: reminderId, action: "opened" })).status).toBe(404);
    expect((await respond({ notification_id: noteId, action: "clicked" })).status).toBe(400);
    expect((await respond({ notification_id: noteId, action: "opened" }, "nope")).status).toBe(401);
    expect(db.where("privacy_checkin_events", (r) => r.action !== "delivered")).toHaveLength(0);
  });

  it("acknowledges but does not record a response after withdrawal", async () => {
    db.table("study_enrollments")[0].withdrawn_at = daysAgo(0);
    const res = await respond({ notification_id: noteId, action: "opened" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ recorded: false });
    expect(db.where("privacy_checkin_events", (r) => r.action === "opened")).toHaveLength(0);
  });
});
