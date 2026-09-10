/**
 * Survey delivery cron (Workstream A / Task A7).
 *
 * Materializes due survey_deliveries for enrolled, non-withdrawn participants and
 * expires stale pending deliveries. CRON_SECRET auth (same as other crons).
 */

import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  createDueDeliveriesForUser,
  expireStaleDeliveries,
  sendSurveyReminders,
} from "@/lib/services/survey-delivery";

export const maxDuration = 60;

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || !auth || !safeCompare(auth, `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createSupabaseServiceClient();

  const { data: enrollments } = await supabase
    .from("study_enrollments")
    .select("user_id, enrolled_at")
    .is("withdrawn_at", null);

  let created = 0;
  for (const e of enrollments || []) {
    created += await createDueDeliveriesForUser(e.user_id, e.enrolled_at);
  }

  const expired = await expireStaleDeliveries();
  const reminders = await sendSurveyReminders();

  return Response.json({
    participants: (enrollments || []).length,
    deliveries_created: created,
    deliveries_expired: expired,
    reminders_sent: reminders,
  });
}
