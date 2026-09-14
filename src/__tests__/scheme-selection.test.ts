import { describe, it, expect } from "vitest";
import {
  schemeSelectionState,
  validateSchemeChoice,
  applySchemeChoice,
  previewOrder,
  SCHEMES,
  SCHEME_PREVIEW_DONE_KEY,
  SCHEME_SWITCH_USED_KEY,
} from "@/lib/utils/scheme-selection";

const RATINGS = { simple: 3, moderate: 5, complex: 6 };
const chosen = { dim_scheme_selection: "chosen", privacy_treatment: "moderate" };
const assigned = { dim_scheme_selection: "assigned", privacy_treatment: "simple" };

describe("schemeSelectionState", () => {
  it("is off for participants without the dimension", () => {
    expect(schemeSelectionState({ privacy_treatment: "complex" })).toEqual({
      arm: null,
      currentScheme: "complex",
      needsPreview: false,
      canChoose: false,
      canSwitch: false,
    });
    expect(schemeSelectionState(null).currentScheme).toBe("moderate");
  });

  it("asks both arms for the preview; only the chosen arm may pick", () => {
    expect(schemeSelectionState(chosen)).toMatchObject({ arm: "chosen", needsPreview: true, canChoose: true, canSwitch: false });
    expect(schemeSelectionState(assigned)).toMatchObject({ arm: "assigned", needsPreview: true, canChoose: false });
  });

  it("does not let a choice override a randomized complexity level", () => {
    expect(schemeSelectionState({ ...chosen, dim_privacy_control_complexity: "simple" }).canChoose).toBe(false);
  });

  it("offers the switch once, after the preview", () => {
    const afterPreview = { ...chosen, [SCHEME_PREVIEW_DONE_KEY]: "2026-09-11T00:00:00Z" };
    expect(schemeSelectionState(afterPreview)).toMatchObject({ needsPreview: false, canSwitch: true });
    expect(schemeSelectionState({ ...afterPreview, [SCHEME_SWITCH_USED_KEY]: "2026-09-12T00:00:00Z" }).canSwitch).toBe(false);
  });
});

describe("validateSchemeChoice", () => {
  it("records a chosen-arm pick with ratings, order and clamped dwell", () => {
    const r = validateSchemeChoice(
      { source: "preview", scheme: "complex", ratings: RATINGS, display_order: ["complex", "simple", "moderate"], dwell_ms: 99_999_999 },
      schemeSelectionState(chosen)
    );
    expect(r).toEqual({
      ok: true,
      record: {
        source: "preview",
        selection_arm: "chosen",
        scheme_before: "moderate",
        scheme_after: "complex",
        ratings: RATINGS,
        display_order: ["complex", "simple", "moderate"],
        dwell_ms: 30 * 60_000,
      },
    });
  });

  it("requires a pick in the chosen arm and ignores one in the assigned arm", () => {
    expect(validateSchemeChoice({ source: "preview", ratings: RATINGS }, schemeSelectionState(chosen))).toMatchObject({ ok: false, status: 400 });
    const r = validateSchemeChoice({ source: "preview", scheme: "complex", ratings: RATINGS }, schemeSelectionState(assigned));
    expect(r.ok && r.record.scheme_after).toBe("simple");
  });

  it("rejects missing, fractional and out-of-range ratings", () => {
    const state = schemeSelectionState(assigned);
    for (const ratings of [undefined, { simple: 3, moderate: 5 }, { ...RATINGS, complex: 8 }, { ...RATINGS, simple: 2.5 }, [1, 2, 3]]) {
      expect(validateSchemeChoice({ source: "preview", ratings }, state)).toMatchObject({ ok: false, status: 400 });
    }
  });

  it("drops a display order that is not a permutation of the schemes", () => {
    const r = validateSchemeChoice(
      { source: "preview", ratings: RATINGS, display_order: ["simple", "simple", "complex"], dwell_ms: -5 },
      schemeSelectionState(assigned)
    );
    expect(r.ok && r.record.display_order).toBeNull();
    expect(r.ok && r.record.dwell_ms).toBe(0);
  });

  it("refuses a second preview and anything for participants without the dimension", () => {
    const done = schemeSelectionState({ ...chosen, [SCHEME_PREVIEW_DONE_KEY]: "x" });
    expect(validateSchemeChoice({ source: "preview", scheme: "simple", ratings: RATINGS }, done)).toMatchObject({ ok: false, status: 409 });
    expect(validateSchemeChoice({ source: "preview", ratings: RATINGS }, schemeSelectionState({}))).toMatchObject({ ok: false, status: 409 });
  });

  it("allows one switch to a different scheme", () => {
    const state = schemeSelectionState({ ...assigned, [SCHEME_PREVIEW_DONE_KEY]: "x" });
    expect(validateSchemeChoice({ source: "switch", scheme: "simple" }, state)).toMatchObject({ ok: false, status: 400 });
    const r = validateSchemeChoice({ source: "switch", scheme: "complex" }, state);
    expect(r.ok && r.record).toMatchObject({ source: "switch", scheme_before: "simple", scheme_after: "complex", ratings: null });
    const used = schemeSelectionState({ ...assigned, [SCHEME_PREVIEW_DONE_KEY]: "x", [SCHEME_SWITCH_USED_KEY]: "y" });
    expect(validateSchemeChoice({ source: "switch", scheme: "complex" }, used)).toMatchObject({ ok: false, status: 409 });
  });

  it("rejects an unknown source or a non-object body", () => {
    expect(validateSchemeChoice({ source: "other" }, schemeSelectionState(chosen))).toMatchObject({ ok: false, status: 400 });
    expect(validateSchemeChoice(null, schemeSelectionState(chosen))).toMatchObject({ ok: false, status: 400 });
  });
});

describe("applySchemeChoice", () => {
  it("sets the scheme and the step timestamp without mutating the input", () => {
    const meta = { ...chosen };
    const next = applySchemeChoice(meta, { source: "preview", scheme_after: "complex" }, "2026-09-11T10:00:00Z");
    expect(next).toEqual({ ...chosen, privacy_treatment: "complex", [SCHEME_PREVIEW_DONE_KEY]: "2026-09-11T10:00:00Z" });
    expect(meta).toEqual(chosen);
  });

  it("keeps an existing timestamp when re-applied", () => {
    const meta = { ...chosen, [SCHEME_SWITCH_USED_KEY]: "2026-09-01T00:00:00Z" };
    const next = applySchemeChoice(meta, { source: "switch", scheme_after: "simple" }, "2026-09-11T10:00:00Z");
    expect(next[SCHEME_SWITCH_USED_KEY]).toBe("2026-09-01T00:00:00Z");
  });
});

describe("previewOrder", () => {
  it("is a stable permutation of the three schemes", () => {
    const a = previewOrder("user-1");
    expect([...a].sort()).toEqual([...SCHEMES].sort());
    expect(previewOrder("user-1")).toEqual(a);
  });

  it("varies across participants", () => {
    const orders = new Set(Array.from({ length: 40 }, (_, i) => previewOrder(`user-${i}`).join(",")));
    expect(orders.size).toBeGreaterThan(1);
  });
});
