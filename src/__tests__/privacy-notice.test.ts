import { describe, it, expect } from "vitest";
import {
  buildPrivacyNotice,
  effectiveAudience,
  resolveNoticeStyle,
  parseNoticeEventBody,
  noticeEventUpdate,
  GENERIC_NOTICE_MESSAGE,
  NOTICE_LINK,
  MAX_DWELL_MS,
  type NoticeEventRow,
} from "@/lib/services/privacy-notice";

const AUDIENCE = {
  everyone: "Everyone can see this score.",
  class: "Your class can see this score.",
  team: "Your team can see this score.",
  nobody: "Only you can see this score.",
} as const;

describe("buildPrivacyNotice", () => {
  const levels = ["everyone", "class", "team", "nobody", undefined, null, "bogus"] as const;

  it("returns null for none at every level", () => {
    for (const level of levels) expect(buildPrivacyNotice("none", level)).toBeNull();
  });

  it("generic ignores the level and carries no link", () => {
    for (const level of levels) {
      expect(buildPrivacyNotice("generic", level)).toEqual({
        style: "generic",
        message: GENERIC_NOTICE_MESSAGE,
        link: null,
      });
    }
  });

  it("specific names the audience, no link", () => {
    for (const [level, sentence] of Object.entries(AUDIENCE)) {
      expect(buildPrivacyNotice("specific", level)).toEqual({ style: "specific", message: sentence, link: null });
    }
  });

  it("contextual names the audience and links to the privacy page", () => {
    for (const [level, sentence] of Object.entries(AUDIENCE)) {
      expect(buildPrivacyNotice("contextual", level)).toEqual({
        style: "contextual",
        message: sentence,
        link: { href: NOTICE_LINK.href, label: NOTICE_LINK.label },
      });
    }
  });

  it("treats an unset or unknown level as everyone, matching canViewField", () => {
    expect(buildPrivacyNotice("specific", undefined)?.message).toBe(AUDIENCE.everyone);
    expect(buildPrivacyNotice("contextual", "bogus")?.message).toBe(AUDIENCE.everyone);
    expect(effectiveAudience(null)).toBe("everyone");
  });

  it("carries the notice id when given", () => {
    expect(buildPrivacyNotice("generic", "class", "n-1")?.id).toBe("n-1");
    expect(buildPrivacyNotice("generic", "class")).not.toHaveProperty("id");
  });
});

describe("resolveNoticeStyle", () => {
  it("reads dim_notice_style and falls back to none", () => {
    expect(resolveNoticeStyle({ dim_notice_style: "contextual" })).toBe("contextual");
    expect(resolveNoticeStyle({ dim_notice_style: "loud" })).toBe("none");
    expect(resolveNoticeStyle({})).toBe("none");
    expect(resolveNoticeStyle(null)).toBe("none");
  });
});

describe("parseNoticeEventBody", () => {
  it("accepts the three actions", () => {
    expect(parseNoticeEventBody({ action: "displayed" })).toEqual({ action: "displayed", dwell_ms: null, auto: false });
    expect(parseNoticeEventBody({ action: "dismissed", dwell_ms: 1234.6, auto: true })).toEqual({
      action: "dismissed",
      dwell_ms: 1235,
      auto: true,
    });
    expect(parseNoticeEventBody({ action: "clicked", dwell_ms: 500 })?.action).toBe("clicked");
  });

  it("clamps dwell to 0..MAX_DWELL_MS", () => {
    expect(parseNoticeEventBody({ action: "clicked", dwell_ms: -5 })?.dwell_ms).toBe(0);
    expect(parseNoticeEventBody({ action: "clicked", dwell_ms: 10_000_000 })?.dwell_ms).toBe(MAX_DWELL_MS);
  });

  it("rejects malformed bodies", () => {
    expect(parseNoticeEventBody(null)).toBeNull();
    expect(parseNoticeEventBody("displayed")).toBeNull();
    expect(parseNoticeEventBody([])).toBeNull();
    expect(parseNoticeEventBody({})).toBeNull();
    expect(parseNoticeEventBody({ action: "opened" })).toBeNull();
    expect(parseNoticeEventBody({ action: "clicked", dwell_ms: "100" })).toBeNull();
    expect(parseNoticeEventBody({ action: "clicked", dwell_ms: Number.NaN })).toBeNull();
    expect(parseNoticeEventBody({ action: "dismissed", auto: "yes" })).toBeNull();
  });
});

describe("noticeEventUpdate", () => {
  const NOW = "2026-09-11T12:00:00.000Z";
  const blank: NoticeEventRow = { displayed_at: null, dismissed_at: null, link_clicked_at: null, dwell_ms: null };

  it("sets each timestamp once (first write wins)", () => {
    expect(noticeEventUpdate(blank, { action: "displayed", dwell_ms: null, auto: false }, NOW)).toEqual({
      displayed_at: NOW,
    });
    expect(
      noticeEventUpdate({ ...blank, displayed_at: "earlier" }, { action: "displayed", dwell_ms: null, auto: false }, NOW)
    ).toBeNull();
    expect(
      noticeEventUpdate({ ...blank, dismissed_at: "earlier" }, { action: "dismissed", dwell_ms: 10, auto: true }, NOW)
    ).toBeNull();
    expect(
      noticeEventUpdate({ ...blank, link_clicked_at: "earlier" }, { action: "clicked", dwell_ms: 10, auto: false }, NOW)
    ).toBeNull();
  });

  it("records dismissal with auto flag and dwell", () => {
    expect(noticeEventUpdate(blank, { action: "dismissed", dwell_ms: 8000, auto: true }, NOW)).toEqual({
      dismissed_at: NOW,
      dismissed_auto: true,
      dwell_ms: 8000,
    });
  });

  it("records a click with dwell but never overwrites an existing dwell", () => {
    expect(noticeEventUpdate(blank, { action: "clicked", dwell_ms: 2100, auto: false }, NOW)).toEqual({
      link_clicked_at: NOW,
      dwell_ms: 2100,
    });
    expect(
      noticeEventUpdate({ ...blank, dwell_ms: 900 }, { action: "clicked", dwell_ms: 2100, auto: false }, NOW)
    ).toEqual({ link_clicked_at: NOW });
  });
});
