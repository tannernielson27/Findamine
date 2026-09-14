import { describe, it, expect } from "vitest";
import {
  decideReengagement,
  reengagementMessage,
  DEFAULT_REENGAGEMENT_CONFIG,
  REENGAGEMENT_TYPE,
  type ParticipantEngagement,
} from "@/lib/services/reengagement";

const NOW = new Date("2026-06-30T12:00:00Z").getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString();

const active: ParticipantEngagement = {
  lastSeenAt: daysAgo(5),
  lastNudgeAt: null,
  pushEnabled: true,
  disabledTypes: [],
};

describe("decideReengagement", () => {
  it("nudges a participant inactive past the threshold", () => {
    const d = decideReengagement(active, NOW);
    expect(d.shouldNudge).toBe(true);
    expect(d.reason).toBe("eligible");
    expect(d.daysInactive).toBe(5);
  });

  it("does not nudge a recently-active participant", () => {
    const d = decideReengagement({ ...active, lastSeenAt: daysAgo(1) }, NOW);
    expect(d.shouldNudge).toBe(false);
    expect(d.reason).toBe("still_active");
  });

  it("respects the cooldown between nudges", () => {
    const d = decideReengagement({ ...active, lastNudgeAt: daysAgo(1) }, NOW);
    expect(d.shouldNudge).toBe(false);
    expect(d.reason).toBe("in_cooldown");
  });

  it("nudges again once the cooldown has elapsed", () => {
    const d = decideReengagement({ ...active, lastNudgeAt: daysAgo(10) }, NOW);
    expect(d.shouldNudge).toBe(true);
  });

  it("honors a push opt-out", () => {
    const d = decideReengagement({ ...active, pushEnabled: false }, NOW);
    expect(d.reason).toBe("opted_out");
    expect(d.shouldNudge).toBe(false);
  });

  it("honors a muted re-engagement type", () => {
    const d = decideReengagement({ ...active, disabledTypes: [REENGAGEMENT_TYPE] }, NOW);
    expect(d.reason).toBe("opted_out");
  });

  it("skips participants with no activity baseline", () => {
    const d = decideReengagement({ ...active, lastSeenAt: null }, NOW);
    expect(d.reason).toBe("no_baseline");
    expect(d.shouldNudge).toBe(false);
  });

  it("UNIFORMITY: identical engagement → identical decision regardless of any other attribute", () => {
    // The function signature cannot even receive a condition; two participants
    // with the same engagement signals must get byte-identical decisions.
    const a = decideReengagement(active, NOW);
    const b = decideReengagement({ ...active }, NOW);
    expect(a).toEqual(b);
  });
});

describe("reengagementMessage", () => {
  it("uses a gentle message in the first window", () => {
    expect(reengagementMessage(3).title).toMatch(/waiting/i);
  });

  it("escalates after a week away", () => {
    expect(reengagementMessage(7).title).toMatch(/miss you/i);
  });

  it("is deterministic and tiered only by inactivity", () => {
    expect(reengagementMessage(4)).toEqual(reengagementMessage(4));
    expect(reengagementMessage(10)).toEqual(reengagementMessage(8));
  });

  it("never references the privacy manipulation", () => {
    const all = [reengagementMessage(3), reengagementMessage(9)]
      .flatMap((m) => [m.title, m.body])
      .join(" ")
      .toLowerCase();
    expect(all).not.toMatch(/privacy|visibility|treatment|condition|setting/);
  });

  it("exposes the default config", () => {
    expect(DEFAULT_REENGAGEMENT_CONFIG.inactivityDays).toBeGreaterThan(0);
    expect(DEFAULT_REENGAGEMENT_CONFIG.cooldownDays).toBeGreaterThan(0);
  });
});
