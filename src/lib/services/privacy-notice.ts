/**
 * Just-in-time privacy notices after scoring (build plan C3, storyline S6).
 *
 * When a participant completes a find, the answer route asks this service for
 * a notice about who can see the score they just earned. The variant comes from
 * the `notice_style` dimension (migration 063); unlinked or unassigned means
 * `none`, which shows and records nothing (today's behavior). Every delivered
 * notice is one notice_events row, stamped with the participant's conditions;
 * the client reports display, dismissal, and link clicks against that row.
 *
 * Pure builders/validators are exported for tests; `recordPrivacyNotice` does
 * the reads and the insert and never throws.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { conditionsFromMetadata, levelFromMetadata } from "@/lib/utils/conditions";
import { logger } from "@/lib/utils/logger";
import type { VisibilityLevel } from "@/lib/utils/privacy";

export const NOTICE_STYLES = ["none", "generic", "specific", "contextual"] as const;
export type NoticeStyle = (typeof NOTICE_STYLES)[number];

/** The profile field the notice is about. */
export const NOTICE_FIELD = "total_score";

export const NOTICE_LINK = {
  href: "/settings/privacy?from=notice",
  label: "Change who sees it",
} as const;

export const GENERIC_NOTICE_MESSAGE = "Your privacy settings apply to this score.";

const AUDIENCE_SENTENCE: Record<VisibilityLevel, string> = {
  everyone: "Everyone can see this score.",
  class: "Your class can see this score.",
  team: "Your team can see this score.",
  nobody: "Only you can see this score.",
};

export interface NoticeLink {
  href: string;
  label: string;
}

export interface PrivacyNotice {
  id?: string;
  style: Exclude<NoticeStyle, "none">;
  message: string;
  link: NoticeLink | null;
}

/**
 * The field's effective audience level. An unset or unknown value counts as
 * "everyone", matching canViewField / filterProfileForViewer. Pure.
 */
export function effectiveAudience(level: string | null | undefined): VisibilityLevel {
  return level && level in AUDIENCE_SENTENCE ? (level as VisibilityLevel) : "everyone";
}

/** Notice copy for a style and the score field's visibility level. Pure. */
export function buildPrivacyNotice(
  style: NoticeStyle,
  level: string | null | undefined,
  noticeId?: string
): PrivacyNotice | null {
  if (style === "none") return null;
  const idPart = noticeId ? { id: noticeId } : {};
  if (style === "generic") {
    return { ...idPart, style, message: GENERIC_NOTICE_MESSAGE, link: null };
  }
  const message = AUDIENCE_SENTENCE[effectiveAudience(level)];
  return {
    ...idPart,
    style,
    message,
    link: style === "contextual" ? { ...NOTICE_LINK } : null,
  };
}

/** Resolve the participant's notice style from users.metadata. Pure. */
export function resolveNoticeStyle(meta: Record<string, unknown> | null | undefined): NoticeStyle {
  return levelFromMetadata(meta, "notice_style", NOTICE_STYLES, "none");
}

// ── Client-reported interaction events ───────────────────────────────────

export const NOTICE_ACTIONS = ["displayed", "dismissed", "clicked"] as const;
export type NoticeAction = (typeof NOTICE_ACTIONS)[number];

export const MAX_DWELL_MS = 600_000;

export interface NoticeEventInput {
  action: NoticeAction;
  dwell_ms: number | null;
  auto: boolean;
}

/**
 * Validate a notice-event request body. Returns null for anything malformed
 * (unknown action, non-object body, non-numeric dwell, non-boolean auto).
 * Dwell is rounded and clamped to 0..MAX_DWELL_MS. Pure.
 */
export function parseNoticeEventBody(body: unknown): NoticeEventInput | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.action !== "string" || !(NOTICE_ACTIONS as readonly string[]).includes(b.action)) {
    return null;
  }
  let dwell: number | null = null;
  if (b.dwell_ms !== undefined && b.dwell_ms !== null) {
    if (typeof b.dwell_ms !== "number" || !Number.isFinite(b.dwell_ms)) return null;
    dwell = Math.min(MAX_DWELL_MS, Math.max(0, Math.round(b.dwell_ms)));
  }
  if (b.auto !== undefined && typeof b.auto !== "boolean") return null;
  return { action: b.action as NoticeAction, dwell_ms: dwell, auto: b.auto === true };
}

export interface NoticeEventRow {
  displayed_at: string | null;
  dismissed_at: string | null;
  link_clicked_at: string | null;
  dwell_ms: number | null;
}

/**
 * The column update for one reported action, or null when the row already
 * holds that timestamp (first write wins). Dwell is only written alongside the
 * terminal action (dismissed / clicked), and never overwrites a recorded one.
 * Pure.
 */
export function noticeEventUpdate(
  row: NoticeEventRow,
  input: NoticeEventInput,
  nowIso: string
): Record<string, unknown> | null {
  const dwell = row.dwell_ms == null && input.dwell_ms != null ? { dwell_ms: input.dwell_ms } : {};
  switch (input.action) {
    case "displayed":
      return row.displayed_at ? null : { displayed_at: nowIso };
    case "dismissed":
      return row.dismissed_at
        ? null
        : { dismissed_at: nowIso, dismissed_auto: input.auto, ...dwell };
    case "clicked":
      return row.link_clicked_at ? null : { link_clicked_at: nowIso, ...dwell };
  }
}

// ── Delivery ─────────────────────────────────────────────────────────────

/**
 * Record and return the notice for a just-completed find, or null when the
 * participant's style is `none` (nothing recorded) or anything fails. Never
 * throws: scoring must never fail because of a notice.
 */
export async function recordPrivacyNotice(
  userId: string,
  source: { findId: string | null; huntId: string | null }
): Promise<PrivacyNotice | null> {
  try {
    const supabase = await createSupabaseServiceClient();

    const { data: user } = await supabase
      .from("users")
      .select("metadata, profile_visibility")
      .eq("id", userId)
      .maybeSingle();
    const meta = (user?.metadata || {}) as Record<string, unknown>;
    const style = resolveNoticeStyle(meta);
    if (style === "none") return null;

    // Withdrawal keeps dim_* keys in metadata; only an active (non-withdrawn)
    // enrollment may keep receiving the manipulation and generating rows.
    const { data: enrollment } = await supabase
      .from("study_enrollments")
      .select("id")
      .eq("user_id", userId)
      .is("withdrawn_at", null)
      .limit(1)
      .maybeSingle();
    if (!enrollment) return null;

    const visibility = (user?.profile_visibility || {}) as Record<string, string>;
    const audience = effectiveAudience(visibility[NOTICE_FIELD]);
    const draft = buildPrivacyNotice(style, audience);
    if (!draft) return null;

    // exposure_number is the habituation curve's x-axis, so it has to be one
    // clean per-participant sequence. count + 1 races with a second find
    // finishing at the same moment; the unique index (migration 063) rejects
    // the duplicate and we recount and retry.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { count } = await supabase
        .from("notice_events")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);

      const { data: inserted, error } = await supabase
        .from("notice_events")
        .insert({
          user_id: userId,
          notice_style: style,
          field: NOTICE_FIELD,
          audience_level: audience,
          message: draft.message,
          exposure_number: (count ?? 0) + 1,
          find_id: source.findId,
          hunt_id: source.huntId,
          conditions: conditionsFromMetadata(meta),
        })
        .select("id")
        .single();

      if (!error && inserted) return { ...draft, id: inserted.id as string };
      if (error?.code !== "23505") {
        logger.error("privacy_notice.insert_failed", { userId, error: error?.message });
        return null;
      }
    }

    logger.error("privacy_notice.exposure_conflict", { userId });
    return null;
  } catch (err) {
    logger.error("privacy_notice.error", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
