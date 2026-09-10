/**
 * Time-based survey delivery (Workstream A / Task A7).
 *
 * Materializes survey_deliveries when a participant's enrollment age crosses a
 * schedule's offset_days, and expires stale pending deliveries. Only ACTIVE
 * surveys with a 'time' schedule are delivered, so draft instruments never reach
 * participants. Used by the cron and at enrollment.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";

const DAY_MS = 24 * 3_600_000;

interface TimeSchedule {
  survey_id: string;
  offset_days: number;
  expires_days: number;
}

/** Active, time-triggered schedules whose survey is active. */
async function getActiveTimeSchedules(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>
): Promise<TimeSchedule[]> {
  const { data } = await supabase
    .from("survey_schedules")
    .select("survey_id, trigger_config, surveys(status)")
    .eq("trigger_type", "time")
    .eq("active", true);

  return (data || [])
    .filter((s) => (s.surveys as unknown as { status: string } | null)?.status === "active")
    .map((s) => {
      const cfg = (s.trigger_config || {}) as { offset_days?: number; expires_days?: number };
      return {
        survey_id: s.survey_id,
        offset_days: cfg.offset_days ?? 0,
        expires_days: cfg.expires_days ?? 7,
      };
    });
}

/** Create any deliveries now due for a single enrolled user. Returns count created. */
export async function createDueDeliveriesForUser(
  userId: string,
  enrolledAt: string
): Promise<number> {
  try {
    const supabase = await createSupabaseServiceClient();
    const schedules = await getActiveTimeSchedules(supabase);
    if (schedules.length === 0) return 0;

    const ageDays = (Date.now() - new Date(enrolledAt).getTime()) / DAY_MS;

    // Existing deliveries for this user (avoid duplicates).
    const { data: existing } = await supabase
      .from("survey_deliveries")
      .select("survey_id")
      .eq("user_id", userId);
    const have = new Set((existing || []).map((d) => d.survey_id));

    const toInsert = schedules
      .filter((s) => ageDays >= s.offset_days && !have.has(s.survey_id))
      .map((s) => ({
        survey_id: s.survey_id,
        user_id: userId,
        status: "pending",
        expires_at: new Date(Date.now() + s.expires_days * DAY_MS).toISOString(),
      }));

    if (toInsert.length === 0) return 0;
    const { error } = await supabase.from("survey_deliveries").insert(toInsert);
    return error ? 0 : toInsert.length;
  } catch {
    return 0;
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
