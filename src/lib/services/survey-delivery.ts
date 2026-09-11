/**
 * Survey delivery (Workstream A / Task A7, Workstream B / Task B2).
 *
 * Materializes survey_deliveries on two paths, both restricted to ACTIVE
 * surveys so draft instruments never reach participants:
 *   - time:  a participant's enrollment age crosses a schedule's offset_days
 *            (cron + enrollment)
 *   - event: the client reports a named event, e.g. the first privacy-page view
 *            (POST /api/v1/surveys/trigger)
 * Dedupe is per survey per user across BOTH paths (see survey-triggers.ts), so a
 * survey with an event schedule plus a time fallback (T1) is delivered once.
 * Also expires stale pending deliveries and sends reminders.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  DAY_MS,
  buildDeliveryRows,
  dedupeBySurvey,
  matchDueTimeSchedules,
  matchEventSchedules,
  normalizeSchedules,
  selectPendingDeliveries,
  type NormalizedSchedule,
  type PendingDelivery,
} from "@/lib/services/survey-triggers";

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

/** Active schedules (any trigger type) whose survey is active, normalized. */
async function getActiveSchedules(supabase: ServiceClient): Promise<NormalizedSchedule[]> {
  const { data } = await supabase
    .from("survey_schedules")
    .select("survey_id, trigger_type, trigger_config, surveys(status)")
    .eq("active", true);
  return normalizeSchedules(data || []);
}

/** Survey ids this user already has a delivery for (any status). */
async function getExistingSurveyIds(supabase: ServiceClient, userId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from("survey_deliveries")
    .select("survey_id")
    .eq("user_id", userId);
  return new Set((data || []).map((d) => d.survey_id));
}

/** Insert pending deliveries for the (already deduped) schedules. Returns count. */
async function insertDeliveries(
  supabase: ServiceClient,
  schedules: NormalizedSchedule[],
  userId: string
): Promise<number> {
  const rows = buildDeliveryRows(schedules, userId, Date.now());
  if (rows.length === 0) return 0;
  const { error } = await supabase.from("survey_deliveries").insert(rows);
  return error ? 0 : rows.length;
}

/** Create any time-schedule deliveries now due for a single enrolled user. Returns count created. */
export async function createDueDeliveriesForUser(
  userId: string,
  enrolledAt: string
): Promise<number> {
  try {
    const supabase = await createSupabaseServiceClient();
    const schedules = await getActiveSchedules(supabase);
    if (schedules.length === 0) return 0;

    const ageDays = (Date.now() - new Date(enrolledAt).getTime()) / DAY_MS;
    const due = matchDueTimeSchedules(schedules, ageDays);
    if (due.length === 0) return 0;

    const have = await getExistingSurveyIds(supabase, userId);
    return insertDeliveries(supabase, dedupeBySurvey(due, have), userId);
  } catch {
    return 0;
  }
}

export interface EventDeliveryResult {
  created: number;
  /** Still-answerable deliveries for every survey scheduled on this event. */
  pending: PendingDelivery[];
}

/** Is the user an enrolled, non-withdrawn study participant? */
async function isEnrolled(supabase: ServiceClient, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("study_enrollments")
    .select("id")
    .eq("user_id", userId)
    .is("withdrawn_at", null)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

/**
 * Create deliveries for active event schedules matching `eventName`, for one
 * user. Non-participants (never enrolled, or withdrawn) get nothing, so the
 * privacy-page survey gate can never block them. Idempotent: re-calling returns
 * created: 0 plus the same pending list. Never throws.
 */
export async function createEventDeliveriesForUser(
  userId: string,
  eventName: string
): Promise<EventDeliveryResult> {
  const empty: EventDeliveryResult = { created: 0, pending: [] };
  try {
    const supabase = await createSupabaseServiceClient();
    if (!(await isEnrolled(supabase, userId))) return empty;

    const schedules = await getActiveSchedules(supabase);
    const matched = matchEventSchedules(schedules, eventName);
    if (matched.length === 0) return empty;

    const have = await getExistingSurveyIds(supabase, userId);
    const created = await insertDeliveries(supabase, dedupeBySurvey(matched, have), userId);

    const surveyIds = matched.map((s) => s.survey_id);
    const { data: deliveries } = await supabase
      .from("survey_deliveries")
      .select("id, survey_id, status, expires_at")
      .eq("user_id", userId)
      .in("survey_id", surveyIds);

    return {
      created,
      pending: selectPendingDeliveries(deliveries || [], surveyIds, schedules, Date.now()),
    };
  } catch {
    return empty;
  }
}

/** Expire pending deliveries past their expires_at. Returns count expired. */
export async function expireStaleDeliveries(): Promise<number> {
  const supabase = await createSupabaseServiceClient();
  const { data } = await supabase
    .from("survey_deliveries")
    .update({ status: "expired" })
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString())
    .select("id");
  return (data || []).length;
}

const REMINDER_TYPE = "survey_reminder";
const REMINDER_COOLDOWN_DAYS = 3;

/**
 * Nudge participants who have a pending/opened (unsubmitted, unexpired) survey,
 * so T2/T3 response rates don't collapse to silent expiry. Selects recipients
 * ONLY by delivery status — never by privacy condition — mirroring the
 * re-engagement cron's research-integrity guardrail. Cooldown-limited and
 * respects a user's disabled notification types. Returns count of reminders sent.
 */
export async function sendSurveyReminders(): Promise<number> {
  const supabase = await createSupabaseServiceClient();
  const now = Date.now();

  const { data: deliveries } = await supabase
    .from("survey_deliveries")
    .select("user_id, expires_at, status, surveys(title)")
    .in("status", ["pending", "opened"]);
  if (!deliveries || deliveries.length === 0) return 0;

  // Group unexpired deliveries per participant.
  const byUser = new Map<string, number>();
  for (const d of deliveries) {
    if (d.expires_at && new Date(d.expires_at).getTime() <= now) continue; // effectively expired
    byUser.set(d.user_id, (byUser.get(d.user_id) || 0) + 1);
  }
  if (byUser.size === 0) return 0;

  const cutoff = new Date(now - REMINDER_COOLDOWN_DAYS * DAY_MS).toISOString();
  let sent = 0;

  for (const [userId, count] of byUser) {
    // Cooldown: skip if we reminded this user recently.
    const { data: last } = await supabase
      .from("notifications")
      .select("created_at")
      .eq("user_id", userId)
      .eq("type", REMINDER_TYPE)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last?.created_at && last.created_at > cutoff) continue;

    // Respect an explicit opt-out of this notification type.
    const { data: prefs } = await supabase
      .from("notification_preferences")
      .select("disabled_types")
      .eq("user_id", userId)
      .maybeSingle();
    if ((prefs?.disabled_types || []).includes(REMINDER_TYPE)) continue;

    const title = count > 1 ? `${count} surveys waiting` : "A quick survey is waiting";
    const body =
      "You have a short check-in to complete. It only takes a couple of minutes, and your answers are private.";
    const { error } = await supabase
      .from("notifications")
      .insert({ user_id: userId, type: REMINDER_TYPE, title, body });
    if (!error) sent++;
  }

  return sent;
}
