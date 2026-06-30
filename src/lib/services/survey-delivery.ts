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
