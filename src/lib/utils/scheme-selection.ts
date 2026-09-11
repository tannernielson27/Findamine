/**
 * Scheme preview and choice for storyline S2 (build plan C2, migration 060).
 *
 * A participant assigned a level on `scheme_selection` previews all three
 * control schemes at their first privacy-page view and rates the expected
 * utility of each. The `chosen` arm then picks the scheme they will use; the
 * `assigned` arm keeps the one they were given. Both arms may switch schemes
 * once afterwards. Participants with no level on the dimension see none of it.
 *
 * Pure — shared by the privacy page (client) and the scheme-choice route.
 */

import { hasDimension, levelFromMetadata } from "@/lib/utils/conditions";

export const SCHEMES = ["simple", "moderate", "complex"] as const;
export type Scheme = (typeof SCHEMES)[number];

export const SCHEME_SELECTION_DIMENSION = "scheme_selection";
export const SELECTION_ARMS = ["assigned", "chosen"] as const;
export type SelectionArm = (typeof SELECTION_ARMS)[number];

/** Server-owned metadata keys (protected from client writes in the profile PUT). */
export const SCHEME_PREVIEW_DONE_KEY = "scheme_preview_completed_at";
export const SCHEME_SWITCH_USED_KEY = "scheme_switch_used_at";
export const SCHEME_META_KEYS = [SCHEME_PREVIEW_DONE_KEY, SCHEME_SWITCH_USED_KEY] as const;

export const RATING_MIN = 1;
export const RATING_MAX = 7;
const MAX_DWELL_MS = 30 * 60_000;
const DEFAULT_SCHEME: Scheme = "moderate";

export function isScheme(value: unknown): value is Scheme {
  return typeof value === "string" && (SCHEMES as readonly string[]).includes(value);
}

export interface SchemeSelectionState {
  /** null when the participant has no level on scheme_selection (feature off). */
  arm: SelectionArm | null;
  currentScheme: Scheme;
  needsPreview: boolean;
  /** Whether the preview lets them pick (chosen arm, complexity not randomized). */
  canChoose: boolean;
  canSwitch: boolean;
}

/** Where a participant stands in the S2 flow, from their metadata. Pure. */
export function schemeSelectionState(
  meta: Record<string, unknown> | null | undefined
): SchemeSelectionState {
  const arm = hasDimension(meta, SCHEME_SELECTION_DIMENSION)
    ? levelFromMetadata(meta, SCHEME_SELECTION_DIMENSION, SELECTION_ARMS, "assigned")
    : null;
  const currentScheme = isScheme(meta?.privacy_treatment) ? meta.privacy_treatment : DEFAULT_SCHEME;
  const previewDone = typeof meta?.[SCHEME_PREVIEW_DONE_KEY] === "string";
  const switchUsed = typeof meta?.[SCHEME_SWITCH_USED_KEY] === "string";
  return {
    arm,
    currentScheme,
    needsPreview: arm !== null && !previewDone,
    // A randomized complexity level always wins over a choice.
    canChoose: arm === "chosen" && !hasDimension(meta, "privacy_control_complexity"),
    canSwitch: arm !== null && previewDone && !switchUsed,
  };
}

export type SchemeChoiceSource = "preview" | "switch";

/** One scheme_selections row, minus user_id / conditions / timestamps. */
export interface SchemeChoiceRecord {
  source: SchemeChoiceSource;
  selection_arm: SelectionArm;
  scheme_before: Scheme;
  scheme_after: Scheme;
  ratings: Record<Scheme, number> | null;
  display_order: Scheme[] | null;
  dwell_ms: number | null;
}

export type SchemeChoiceResult =
  | { ok: true; record: SchemeChoiceRecord }
  | { ok: false; status: 400 | 409; error: string };

function parseRatings(raw: unknown): Record<Scheme, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out = {} as Record<Scheme, number>;
  for (const s of SCHEMES) {
    const v = src[s];
    if (typeof v !== "number" || !Number.isInteger(v) || v < RATING_MIN || v > RATING_MAX) return null;
    out[s] = v;
  }
  return out;
}

function parseDisplayOrder(raw: unknown): Scheme[] | null {
  if (!Array.isArray(raw) || raw.length !== SCHEMES.length) return null;
  if (!raw.every(isScheme) || new Set(raw).size !== SCHEMES.length) return null;
  return [...raw];
}

function parseDwell(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.min(MAX_DWELL_MS, Math.max(0, Math.round(raw)));
}

/**
 * Validate a scheme-choice request against the participant's state and build
 * the row to record. Pure; the route turns failures into HTTP errors.
 */
export function validateSchemeChoice(body: unknown, state: SchemeSelectionState): SchemeChoiceResult {
  if (!body || typeof body !== "object") return { ok: false, status: 400, error: "Invalid body" };
  const b = body as Record<string, unknown>;
  if (state.arm === null) return { ok: false, status: 409, error: "Scheme selection is not active for this account" };

  if (b.source === "preview") {
    if (!state.needsPreview) return { ok: false, status: 409, error: "Preview already completed" };
    const ratings = parseRatings(b.ratings);
    if (!ratings) return { ok: false, status: 400, error: `Rate every scheme from ${RATING_MIN} to ${RATING_MAX}` };
    let after: Scheme = state.currentScheme;
    if (state.canChoose) {
      if (!isScheme(b.scheme)) return { ok: false, status: 400, error: "Pick a scheme" };
      after = b.scheme;
    }
    return {
      ok: true,
      record: {
        source: "preview",
        selection_arm: state.arm,
        scheme_before: state.currentScheme,
        scheme_after: after,
        ratings,
        display_order: parseDisplayOrder(b.display_order),
        dwell_ms: parseDwell(b.dwell_ms),
      },
    };
  }

  if (b.source === "switch") {
    if (!state.canSwitch) return { ok: false, status: 409, error: "Scheme switch is not available" };
    if (!isScheme(b.scheme) || b.scheme === state.currentScheme) {
      return { ok: false, status: 400, error: "Pick a different scheme" };
    }
    return {
      ok: true,
      record: {
        source: "switch",
        selection_arm: state.arm,
        scheme_before: state.currentScheme,
        scheme_after: b.scheme,
        ratings: null,
        display_order: null,
        dwell_ms: parseDwell(b.dwell_ms),
      },
    };
  }

  return { ok: false, status: 400, error: "source must be preview or switch" };
}

/**
 * Metadata after a recorded choice: the scheme in force plus the step's
 * timestamp (kept if already set, so re-applying is idempotent). Pure.
 */
export function applySchemeChoice(
  meta: Record<string, unknown>,
  record: Pick<SchemeChoiceRecord, "source" | "scheme_after">,
  nowIso: string
): Record<string, unknown> {
  const key = record.source === "preview" ? SCHEME_PREVIEW_DONE_KEY : SCHEME_SWITCH_USED_KEY;
  return {
    ...meta,
    privacy_treatment: record.scheme_after,
    [key]: typeof meta[key] === "string" ? meta[key] : nowIso,
  };
}

/**
 * Per-participant card order for the preview, stable across renders and
 * reloads (derived from the user id, so no randomness during render). Pure.
 */
export function previewOrder(seed: string): Scheme[] {
  const score = (s: string) => {
    let h = 2166136261;
    for (const ch of `${seed}:${s}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
  };
  return [...SCHEMES].sort((a, b) => score(a) - score(b));
}
