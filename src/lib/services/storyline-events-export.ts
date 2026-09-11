/**
 * Long-format storyline events export (`dataset=storylines`): one row per
 * score-time notice (S6, C3) and per privacy check-in delivery or opt-out skip
 * (S4, D2), keyed to the same anonymized ids as the other datasets. This is
 * the shape the habituation curves want: response by exposure number.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  conditionValues,
  loadStudyDimensionNames,
  participantId,
  serialize,
  treatmentHeader,
  type ExportConfig,
} from "@/lib/services/research-export";
import type { CheckinEventLite, NoticeEventLite } from "@/lib/services/storyline-export";
import { fetchAllRows } from "@/lib/utils/paginate";

export const STORYLINE_EVENT_HEADERS = [
  "participant_id",
  "storyline",
  "exposure_number",
  "event_at",
  "days_since_enrollment",
  "variant",
  "audience_level",
  "outcome",
  "responded",
  "dwell_ms",
  "latency_ms",
];

function daysSince(enrolledAt: string | undefined, iso: string): string {
  if (!enrolledAt) return "";
  const d = (new Date(iso).getTime() - new Date(enrolledAt).getTime()) / 86_400_000;
  return Number.isFinite(d) && d >= 0 ? d.toFixed(4) : "";
}

/** clicked > dismissed > auto_dismissed > displayed > not_displayed. Pure. */
export function noticeOutcome(n: NoticeEventLite): string {
  if (n.link_clicked_at) return "clicked";
  if (n.dismissed_at) return n.dismissed_auto === true ? "auto_dismissed" : "dismissed";
  return n.displayed_at ? "displayed" : "not_displayed";
}

const num = (v: number | null | undefined): string => (typeof v === "number" && Number.isFinite(v) ? String(v) : "");

export interface StorylineEventInput {
  notices: readonly NoticeEventLite[];
  checkins: readonly CheckinEventLite[];
  pidByUser: ReadonlyMap<string, string>;
  enrolledAtByUser: ReadonlyMap<string, string>;
  dimensionNames: readonly string[];
}

/** Rows for enrolled participants only, ordered by participant then time. Pure. */
export function buildStorylineEventRows(input: StorylineEventInput): string[][] {
  const { pidByUser, enrolledAtByUser, dimensionNames } = input;
  const out: { pid: string; at: string; row: string[] }[] = [];

  for (const n of input.notices) {
    const pid = pidByUser.get(n.user_id);
    if (!pid) continue;
    const outcome = noticeOutcome(n);
    out.push({
      pid,
      at: n.delivered_at,
      row: [
        pid, "S6", num(n.exposure_number), n.delivered_at, daysSince(enrolledAtByUser.get(n.user_id), n.delivered_at),
        n.notice_style, n.audience_level ?? "", outcome, outcome === "clicked" ? "1" : "0", num(n.dwell_ms), "",
        ...conditionValues(dimensionNames, n.conditions ?? null, null),
      ],
    });
  }

  // A delivery's response is the opened / dismissed row sharing its notification.
  const responses = new Map<string, CheckinEventLite>();
  for (const c of input.checkins) {
    if ((c.action === "opened" || c.action === "dismissed") && c.notification_id) {
      const prior = responses.get(c.notification_id);
      if (!prior || prior.action !== "opened") responses.set(c.notification_id, c);
    }
  }
  for (const c of input.checkins) {
    if (c.action !== "delivered" && c.action !== "skipped") continue;
    const pid = pidByUser.get(c.user_id);
    if (!pid) continue;
    const response = c.notification_id ? responses.get(c.notification_id) : undefined;
    const outcome = c.action === "skipped" ? `skipped_${c.reason ?? "unknown"}` : (response?.action ?? "ignored");
    out.push({
      pid,
      at: c.created_at,
      row: [
        pid, "S4", num(c.exposure_number), c.created_at, daysSince(enrolledAtByUser.get(c.user_id), c.created_at),
        c.cadence, "", outcome, outcome === "opened" ? "1" : "0", "", num(response?.latency_ms),
        ...conditionValues(dimensionNames, c.conditions ?? null, null),
      ],
    });
  }

  return out
    .sort((a, b) => a.pid.localeCompare(b.pid) || a.at.localeCompare(b.at))
    .map((r) => r.row);
}

export async function generateStorylineEventsExport(config: ExportConfig): Promise<string> {
  const supabase = await createSupabaseServiceClient();

  const enrollments = await fetchAllRows<{ user_id: string; enrolled_at: string }>((from, to) =>
    supabase
      .from("study_enrollments")
      .select("user_id, enrolled_at")
      .eq("study_id", config.studyId)
      .is("withdrawn_at", null)
      .order("user_id", { ascending: true })
      .range(from, to)
  );
  if (enrollments.length === 0) return "";

  const userIds = enrollments.map((e) => e.user_id);
  const pidByUser = new Map(userIds.map((uid, i) => [uid, participantId(i)]));
  const enrolledAtByUser = new Map(enrollments.map((e) => [e.user_id, e.enrolled_at]));
  const dimensionNames = await loadStudyDimensionNames(supabase, config.studyId);

  const [notices, checkins] = await Promise.all([
    fetchAllRows<NoticeEventLite>((from, to) =>
      supabase
        .from("notice_events")
        .select("user_id, exposure_number, notice_style, audience_level, delivered_at, displayed_at, dismissed_at, dismissed_auto, link_clicked_at, dwell_ms, conditions")
        .in("user_id", userIds)
        .order("delivered_at", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<CheckinEventLite>((from, to) =>
      supabase
        .from("privacy_checkin_events")
        .select("user_id, notification_id, cadence, exposure_number, action, reason, latency_ms, created_at, conditions")
        .in("user_id", userIds)
        .order("created_at", { ascending: true })
        .range(from, to)
    ),
  ]);

  const rows = buildStorylineEventRows({
    notices,
    checkins,
    pidByUser,
    enrolledAtByUser,
    dimensionNames,
  });
  if (rows.length === 0) return "";
  return serialize([...STORYLINE_EVENT_HEADERS, ...dimensionNames.map(treatmentHeader)], rows, config.format);
}
