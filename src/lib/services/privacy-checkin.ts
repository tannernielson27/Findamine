/**
 * Privacy check-in cadence (build plan D2, storyline S4).
 *
 * A "review your privacy settings" check-in is sent never, every two weeks, or
 * weekly, by randomized condition (dimension `privacy_checkin`, migration 061).
 * This is deliberately a SEPARATE job from re-engagement: reengagement.ts is
 * condition-blind by design and must stay that way, while this job exists only
 * to vary by condition. Copy is identical across arms — only the dose varies.
 *
 * Everything here is pure so the schedule and the event-body validation are
 * unit tested without a database; the cron and the events route do the I/O.
 */

import { levelFromMetadata } from "@/lib/utils/conditions";

export const PRIVACY_CHECKIN_TYPE = "privacy_checkin";
export const PRIVACY_CHECKIN_DIMENSION = "privacy_checkin";
export const PRIVACY_CHECKIN_LEVELS = ["none", "biweekly", "weekly"] as const;
export type CheckinCadence = (typeof PRIVACY_CHECKIN_LEVELS)[number];

/** Days between check-ins per active arm. */
export const CADENCE_DAYS: Readonly<Record<Exclude<CheckinCadence, "none">, number>> = {
  biweekly: 14,
  weekly: 7,
};

/** Fixed copy, the same for every arm. */
export const CHECKIN_MESSAGE = {
  title: "Review your privacy settings",
  body: "Take a moment to check who can see your profile.",
} as const;

/** Where a check-in click lands; the query flags the visit's source. */
export const CHECKIN_TARGET_PATH = "/settings/privacy?from=checkin";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The participant's arm from users.metadata; unlinked/unknown → "none". Pure. */
export function resolveCheckinCadence(
  meta: Record<string, unknown> | null | undefined
): CheckinCadence {
  return levelFromMetadata(meta, PRIVACY_CHECKIN_DIMENSION, PRIVACY_CHECKIN_LEVELS, "none");
}

export interface CheckinInput {
  cadence: CheckinCadence;
  /** ISO timestamp of enrollment (the schedule's anchor before any check-in). */
  enrolledAt: string;
  /** ISO timestamp of the most recent DELIVERED check-in, if any. */
  lastCheckinAt: string | null;
  /**
   * ISO timestamp of the most recent SKIPPED slot (opted out when due), if any.
   * A skipped slot occupies its slot, so an opted-out participant is logged
   * once per cadence period rather than on every cron run.
   */
  lastSkippedAt?: string | null;
  /** Check-ins delivered so far (exposure_number of the next one is this + 1). */
  deliveredCount?: number;
  /** The participant's own push setting. */
  pushEnabled: boolean;
  /** The participant's own muted notification types. */
  disabledTypes: string[];
}

export type CheckinReason = "none_arm" | "not_yet_due" | "opted_out" | "due";

export interface CheckinDecision {
  send: boolean;
  reason: CheckinReason;
  /** When the current slot fell due (set for opted_out and due). */
  dueAt?: string;
  /** exposure_number the check-in would carry (set when due). */
  exposureDue?: number;
}

function latestIso(...values: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const v of values) {
    if (!v) continue;
    if (!best || new Date(v).getTime() > new Date(best).getTime()) best = v;
  }
  return best;
}

/**
 * Decide whether a check-in is due now. The first is due at enrolledAt +
 * cadence days; each later one cadence days after the last delivered (or
 * skipped) slot. Pure.
 */
export function decideCheckin(input: CheckinInput, nowMs: number): CheckinDecision {
  if (input.cadence === "none") return { send: false, reason: "none_arm" };

  const anchor = latestIso(input.lastCheckinAt, input.lastSkippedAt) ?? input.enrolledAt;
  const dueMs = new Date(anchor).getTime() + CADENCE_DAYS[input.cadence] * DAY_MS;
  if (!Number.isFinite(dueMs) || nowMs < dueMs) return { send: false, reason: "not_yet_due" };

  const dueAt = new Date(dueMs).toISOString();
  if (!input.pushEnabled || input.disabledTypes.includes(PRIVACY_CHECKIN_TYPE)) {
    return { send: false, reason: "opted_out", dueAt };
  }
  return { send: true, reason: "due", dueAt, exposureDue: (input.deliveredCount ?? 0) + 1 };
}

// ── Client event validation (POST /api/v1/research/checkin-events) ──────────

export type CheckinResponseAction = "opened" | "dismissed";

export interface CheckinEventBody {
  notification_id: string;
  action: CheckinResponseAction;
  reason: "mark_all" | null;
}

export type ParseResult =
  | { ok: true; value: CheckinEventBody }
  | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate an untrusted event body. Pure. */
export function parseCheckinEventBody(body: unknown): ParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.notification_id !== "string" || !UUID_RE.test(b.notification_id)) {
    return { ok: false, error: "notification_id must be a UUID" };
  }
  if (b.action !== "opened" && b.action !== "dismissed") {
    return { ok: false, error: "action must be 'opened' or 'dismissed'" };
  }
  let reason: "mark_all" | null = null;
  if (b.reason !== undefined && b.reason !== null) {
    if (b.reason !== "mark_all" || b.action !== "dismissed") {
      return { ok: false, error: "reason 'mark_all' is only valid with action 'dismissed'" };
    }
    reason = "mark_all";
  }
  return { ok: true, value: { notification_id: b.notification_id, action: b.action, reason } };
}

/** Milliseconds from delivery to a response, never negative. Pure. */
export function responseLatencyMs(deliveredAtIso: string, nowMs: number): number | null {
  const t = new Date(deliveredAtIso).getTime();
  return Number.isFinite(t) ? Math.max(0, nowMs - t) : null;
}
