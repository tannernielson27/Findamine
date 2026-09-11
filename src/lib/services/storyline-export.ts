/**
 * Cohort-2 storyline columns for the participants export (C2, C3, D2, D3).
 *
 * Each storyline's columns appear only when its dimension is among the
 * study's assigned dimensions, so a cohort-1 export is unchanged. The
 * summarizers are pure (one participant's rows in, one string per header out)
 * and unit tested; loadStorylineColumns does the reads.
 */

import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { classifyChange, type FieldDelta } from "@/lib/utils/privacy-tracking";
import { NORM_FIELD } from "@/lib/utils/class-norms";
import { SCHEMES } from "@/lib/utils/scheme-selection";

type Db = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

const DAY_MS = 86_400_000;

export interface PrivacyEventLite {
  user_id: string;
  event_type: string;
  metadata: Record<string, unknown> | null;
  norm_exposure_id?: string | null;
  created_at: string;
}

export interface SchemeSelectionLite {
  user_id: string;
  source: string;
  scheme_before: string;
  scheme_after: string;
  ratings: Record<string, number> | null;
  display_order: string[] | null;
  dwell_ms: number | null;
}

export interface NoticeEventLite {
  user_id: string;
  exposure_number: number;
  notice_style: string;
  audience_level: string | null;
  delivered_at: string;
  displayed_at: string | null;
  dismissed_at: string | null;
  dismissed_auto: boolean | null;
  link_clicked_at: string | null;
  dwell_ms: number | null;
  conditions?: Record<string, unknown> | null;
}

export interface CheckinEventLite {
  user_id: string;
  notification_id: string | null;
  cadence: string;
  exposure_number: number | null;
  action: string;
  reason: string | null;
  latency_ms: number | null;
  created_at: string;
  conditions?: Record<string, unknown> | null;
}

export interface NormExposureLite {
  id: string;
  user_id: string;
  share_shown: number | string | null;
  created_at: string;
}

// ── Pure helpers ────────────────────────────────────────────

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const fmt = (n: number | null | undefined, dp = 0): string =>
  n === null || n === undefined || !Number.isFinite(n) ? "" : dp > 0 ? n.toFixed(dp) : String(n);

const rate = (num: number, den: number): string => (den > 0 ? (num / den).toFixed(3) : "");

const flag = (b: boolean): string => (b ? "1" : "0");

const metaString = (e: PrivacyEventLite, key: string): string | null => {
  const v = e.metadata?.[key];
  return typeof v === "string" ? v : null;
};

function nonNull(values: readonly (number | null | undefined)[]): number[] {
  return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

// ── C2 / S2: scheme preview and choice ──────────────────────

export const SCHEME_HEADERS = [
  "scheme_preview_completed",
  "scheme_initial",
  "scheme_after_preview",
  ...SCHEMES.map((s) => `expected_utility_${s}`),
  "scheme_preview_dwell_ms",
  "scheme_preview_order",
  "scheme_chosen_position",
  "scheme_switch_opened_count",
  "scheme_switch_used",
  "scheme_switched_to",
  "scheme_final",
];

export function summarizeScheme(selections: readonly SchemeSelectionLite[], events: readonly PrivacyEventLite[]): string[] {
  const preview = selections.find((s) => s.source === "preview");
  const sw = selections.find((s) => s.source === "switch");
  const order = preview?.display_order ?? null;
  const position = preview && order ? order.indexOf(preview.scheme_after) + 1 : 0;
  const switchOpened = events.filter(
    (e) => e.event_type === "privacy_field_touch" && metaString(e, "scope") === "scheme_switch:opened"
  ).length;
  return [
    flag(!!preview),
    preview?.scheme_before ?? "",
    preview?.scheme_after ?? "",
    ...SCHEMES.map((s) => fmt(preview?.ratings?.[s])),
    fmt(preview?.dwell_ms),
    order ? order.join(">") : "",
    position > 0 ? String(position) : "",
    String(switchOpened),
    flag(!!sw),
    sw?.scheme_after ?? "",
    sw?.scheme_after ?? preview?.scheme_after ?? "",
  ];
}

// ── C3 / S6: score-time notices ─────────────────────────────

export const NOTICE_HEADERS = [
  "notices_delivered",
  "notices_displayed",
  "notices_clicked",
  "notice_click_rate",
  "notices_dismissed_manual",
  "notices_dismissed_auto",
  "notice_median_dwell_ms",
  "first_notice_click_exposure",
  "notice_link_visits",
];

export function summarizeNotices(notices: readonly NoticeEventLite[], events: readonly PrivacyEventLite[]): string[] {
  const clicked = notices.filter((n) => n.link_clicked_at);
  const firstClick = clicked.length ? Math.min(...clicked.map((n) => n.exposure_number)) : null;
  const visits = events.filter(
    (e) => e.event_type === "privacy_view" && metaString(e, "entry_source") === "notice"
  ).length;
  return [
    String(notices.length),
    String(notices.filter((n) => n.displayed_at).length),
    String(clicked.length),
    rate(clicked.length, notices.length),
    String(notices.filter((n) => n.dismissed_at && n.dismissed_auto !== true).length),
    String(notices.filter((n) => n.dismissed_auto === true).length),
    fmt(median(nonNull(notices.map((n) => n.dwell_ms)))),
    fmt(firstClick),
    String(visits),
  ];
}

// ── D2 / S4: check-in cadence ───────────────────────────────

export const CHECKIN_HEADERS = [
  "checkins_delivered",
  "checkins_opened",
  "checkins_dismissed",
  "checkins_skipped_optout",
  "checkin_open_rate",
  "checkin_median_open_latency_ms",
  "checkin_median_dismiss_latency_ms",
  "checkin_first_open_exposure",
  "checkin_visits",
  "checkin_saves_within_24h",
];

export function summarizeCheckins(rows: readonly CheckinEventLite[], events: readonly PrivacyEventLite[]): string[] {
  const delivered = rows.filter((r) => r.action === "delivered");
  const opened = rows.filter((r) => r.action === "opened");
  const dismissed = rows.filter((r) => r.action === "dismissed");
  const exposureByNotification = new Map(delivered.map((d) => [d.notification_id, d.exposure_number]));
  const openExposures = nonNull(opened.map((o) => exposureByNotification.get(o.notification_id) ?? o.exposure_number));
  const deliveredMs = delivered.map((d) => new Date(d.created_at).getTime());
  const savesWithin24h = events.filter((e) => {
    if (e.event_type !== "privacy_change") return false;
    const t = new Date(e.created_at).getTime();
    return deliveredMs.some((d) => t >= d && t < d + DAY_MS);
  }).length;
  return [
    String(delivered.length),
    String(opened.length),
    String(dismissed.length),
    String(rows.filter((r) => r.action === "skipped").length),
    rate(opened.length, delivered.length),
    fmt(median(nonNull(opened.map((r) => r.latency_ms)))),
    fmt(median(nonNull(dismissed.map((r) => r.latency_ms)))),
    openExposures.length ? String(Math.min(...openExposures)) : "",
    String(events.filter((e) => e.event_type === "privacy_view" && metaString(e, "entry_source") === "checkin").length),
    String(savesWithin24h),
  ];
}

// ── D3 / S5: descriptive norm line ──────────────────────────

export const NORM_HEADERS = [
  "norm_exposures",
  "norm_share_first_shown",
  "norm_first_save_direction",
  "norm_first_save_score_direction",
];

export function summarizeNorms(exposures: readonly NormExposureLite[], events: readonly PrivacyEventLite[]): string[] {
  const sorted = [...exposures].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const first = sorted[0];
  const ids = new Set(sorted.map((x) => x.id));
  const firstSave = events.find(
    (e) => e.event_type === "privacy_change" && !!e.norm_exposure_id && ids.has(e.norm_exposure_id)
  );
  const deltas = (Array.isArray(firstSave?.metadata?.deltas) ? firstSave.metadata.deltas : []) as FieldDelta[];
  return [
    String(sorted.length),
    first && first.share_shown !== null ? Number(first.share_shown).toFixed(4) : "",
    firstSave ? (metaString(firstSave, "direction") ?? classifyChange(deltas)) : "",
    firstSave ? classifyChange(deltas.filter((d) => d.field === NORM_FIELD)) : "",
  ];
}

// ── Loader ──────────────────────────────────────────────────

export interface StorylineColumns {
  headers: string[];
  valuesFor: (userId: string) => string[];
}

function groupByUser<T extends { user_id: string }>(rows: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const list = out.get(r.user_id) ?? [];
    list.push(r);
    out.set(r.user_id, list);
  }
  return out;
}

async function rowsOf<T>(query: PromiseLike<{ data: unknown }> | null): Promise<T[]> {
  if (!query) return [];
  const { data } = await query;
  return (data ?? []) as T[];
}

/** Storyline columns for the participants export, driven by the study's dimensions. */
export async function loadStorylineColumns(
  supabase: Db,
  userIds: string[],
  dimensionNames: ReadonlySet<string>
): Promise<StorylineColumns> {
  const on = {
    scheme: dimensionNames.has("scheme_selection"),
    notices: dimensionNames.has("notice_style"),
    checkins: dimensionNames.has("privacy_checkin"),
    norms: dimensionNames.has("norm_line"),
  };
  if (!on.scheme && !on.notices && !on.checkins && !on.norms) return { headers: [], valuesFor: () => [] };

  const [events, selections, notices, checkins, exposures] = await Promise.all([
    rowsOf<PrivacyEventLite>(
      supabase
        .from("privacy_events")
        .select("user_id, event_type, metadata, norm_exposure_id, created_at")
        .in("user_id", userIds)
        .order("created_at", { ascending: true })
    ),
    rowsOf<SchemeSelectionLite>(
      on.scheme
        ? supabase
            .from("scheme_selections")
            .select("user_id, source, scheme_before, scheme_after, ratings, display_order, dwell_ms")
            .in("user_id", userIds)
        : null
    ),
    rowsOf<NoticeEventLite>(
      on.notices
        ? supabase
            .from("notice_events")
            .select("user_id, exposure_number, notice_style, audience_level, delivered_at, displayed_at, dismissed_at, dismissed_auto, link_clicked_at, dwell_ms")
            .in("user_id", userIds)
        : null
    ),
    rowsOf<CheckinEventLite>(
      on.checkins
        ? supabase
            .from("privacy_checkin_events")
            .select("user_id, notification_id, cadence, exposure_number, action, reason, latency_ms, created_at")
            .in("user_id", userIds)
        : null
    ),
    rowsOf<NormExposureLite>(
      on.norms
        ? supabase.from("norm_exposures").select("id, user_id, share_shown, created_at").in("user_id", userIds)
        : null
    ),
  ]);

  const g = {
    events: groupByUser(events),
    selections: groupByUser(selections),
    notices: groupByUser(notices),
    checkins: groupByUser(checkins),
    exposures: groupByUser(exposures),
  };

  return {
    headers: [
      ...(on.scheme ? SCHEME_HEADERS : []),
      ...(on.notices ? NOTICE_HEADERS : []),
      ...(on.checkins ? CHECKIN_HEADERS : []),
      ...(on.norms ? NORM_HEADERS : []),
    ],
    valuesFor: (uid) => {
      const ev = g.events.get(uid) ?? [];
      return [
        ...(on.scheme ? summarizeScheme(g.selections.get(uid) ?? [], ev) : []),
        ...(on.notices ? summarizeNotices(g.notices.get(uid) ?? [], ev) : []),
        ...(on.checkins ? summarizeCheckins(g.checkins.get(uid) ?? [], ev) : []),
        ...(on.norms ? summarizeNorms(g.exposures.get(uid) ?? [], ev) : []),
      ];
    },
  };
}
