import { describe, it, expect } from "vitest";
import {
  decideCheckin,
  resolveCheckinCadence,
  parseCheckinEventBody,
  responseLatencyMs,
  CHECKIN_MESSAGE,
  PRIVACY_CHECKIN_TYPE,
  type CheckinInput,
} from "@/lib/services/privacy-checkin";

const DAY = 86_400_000;
const T0 = Date.parse("2026-09-01T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function input(over: Partial<CheckinInput> = {}): CheckinInput {
  return {
    cadence: "weekly",
    enrolledAt: iso(T0),
    lastCheckinAt: null,
    lastSkippedAt: null,
    deliveredCount: 0,
    pushEnabled: true,
    disabledTypes: [],
    ...over,
  };
}

describe("resolveCheckinCadence", () => {
  it("reads dim_privacy_checkin and falls back to none", () => {
    expect(resolveCheckinCadence({ dim_privacy_checkin: "weekly" })).toBe("weekly");
    expect(resolveCheckinCadence({ dim_privacy_checkin: "biweekly" })).toBe("biweekly");
    expect(resolveCheckinCadence({ dim_privacy_checkin: "daily" })).toBe("none");
    expect(resolveCheckinCadence({})).toBe("none");
    expect(resolveCheckinCadence(null)).toBe("none");
  });
});

describe("decideCheckin", () => {
  it("never sends in the none arm, however long enrolled", () => {
    expect(decideCheckin(input({ cadence: "none" }), T0 + 100 * DAY)).toEqual({ send: false, reason: "none_arm" });
  });

  it("weekly: first check-in is due exactly 7 days after enrollment", () => {
    expect(decideCheckin(input(), T0 + 7 * DAY - 1).reason).toBe("not_yet_due");
    const d = decideCheckin(input(), T0 + 7 * DAY);
    expect(d).toEqual({ send: true, reason: "due", dueAt: iso(T0 + 7 * DAY), exposureDue: 1 });
  });

  it("biweekly: first check-in is due 14 days after enrollment", () => {
    expect(decideCheckin(input({ cadence: "biweekly" }), T0 + 13 * DAY).reason).toBe("not_yet_due");
    expect(decideCheckin(input({ cadence: "biweekly" }), T0 + 14 * DAY).send).toBe(true);
  });

  it("schedules each later check-in a full cadence after the last delivered one", () => {
    const last = T0 + 8 * DAY; // delivered a day late
    const base = input({ lastCheckinAt: iso(last), deliveredCount: 1 });
    expect(decideCheckin(base, T0 + 14 * DAY).reason).toBe("not_yet_due");
    const d = decideCheckin(base, last + 7 * DAY);
    expect(d.send).toBe(true);
    expect(d.exposureDue).toBe(2);
  });

  it("opted out (push off or type muted) is reported with the slot's due time, not sent", () => {
    const now = T0 + 7 * DAY;
    expect(decideCheckin(input({ pushEnabled: false }), now)).toEqual({
      send: false, reason: "opted_out", dueAt: iso(T0 + 7 * DAY),
    });
    expect(decideCheckin(input({ disabledTypes: [PRIVACY_CHECKIN_TYPE] }), now).reason).toBe("opted_out");
    // Muting a different type does not opt out of check-ins.
    expect(decideCheckin(input({ disabledTypes: ["reengagement"] }), now).send).toBe(true);
  });

  it("a skipped slot occupies its slot, so an opted-out participant is logged once per period", () => {
    const skipped = T0 + 7 * DAY;
    const base = input({ pushEnabled: false, lastSkippedAt: iso(skipped) });
    expect(decideCheckin(base, skipped + DAY).reason).toBe("not_yet_due");
    expect(decideCheckin(base, skipped + 7 * DAY).reason).toBe("opted_out");
  });

  it("anchors on whichever of delivered / skipped is later", () => {
    const base = input({ lastCheckinAt: iso(T0 + 7 * DAY), lastSkippedAt: iso(T0 + 14 * DAY), deliveredCount: 1 });
    expect(decideCheckin(base, T0 + 20 * DAY).reason).toBe("not_yet_due");
    expect(decideCheckin(base, T0 + 21 * DAY).send).toBe(true);
  });

  it("copy is fixed and identical across arms", () => {
    expect(CHECKIN_MESSAGE).toEqual({
      title: "Review your privacy settings",
      body: "Take a moment to check who can see your profile.",
    });
  });
});

describe("parseCheckinEventBody", () => {
  const id = "5b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";

  it("accepts opened and dismissed, with mark_all only on dismissed", () => {
    expect(parseCheckinEventBody({ notification_id: id, action: "opened" })).toEqual({
      ok: true, value: { notification_id: id, action: "opened", reason: null },
    });
    expect(parseCheckinEventBody({ notification_id: id, action: "dismissed", reason: "mark_all" })).toEqual({
      ok: true, value: { notification_id: id, action: "dismissed", reason: "mark_all" },
    });
  });

  it("rejects malformed bodies", () => {
    for (const bad of [
      null,
      "x",
      [],
      {},
      { notification_id: "not-a-uuid", action: "opened" },
      { notification_id: id, action: "delivered" },
      { notification_id: id, action: "skipped" },
      { notification_id: id, action: "opened", reason: "mark_all" },
      { notification_id: id, action: "dismissed", reason: "because" },
    ]) {
      expect(parseCheckinEventBody(bad).ok).toBe(false);
    }
  });
});

describe("responseLatencyMs", () => {
  it("measures from delivery and never goes negative", () => {
    expect(responseLatencyMs(iso(T0), T0 + 5000)).toBe(5000);
    expect(responseLatencyMs(iso(T0), T0 - 5000)).toBe(0);
    expect(responseLatencyMs("garbage", T0)).toBeNull();
  });
});
