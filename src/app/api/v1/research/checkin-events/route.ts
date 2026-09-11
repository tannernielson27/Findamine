/**
 * Privacy check-in responses (build plan D2, storyline S4).
 *
 * The notification bell reports when a participant opens or dismisses a
 * check-in. Only the first open and first dismiss per check-in are recorded
 * (repeats return 200 without writing), latency is measured from delivery, and
 * the condition map is stamped server-side from the caller's own metadata.
 * Responses after withdrawal are acknowledged but not recorded.
 */

import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { conditionsFromMetadata } from "@/lib/utils/conditions";
import {
  parseCheckinEventBody,
  resolveCheckinCadence,
  responseLatencyMs,
  PRIVACY_CHECKIN_TYPE,
} from "@/lib/services/privacy-checkin";

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const parsed = parseCheckinEventBody(await request.json().catch(() => null));
    if (!parsed.ok) throw new ApiError(400, parsed.error);
    const { notification_id, action, reason } = parsed.value;

    const supabase = await createSupabaseServiceClient();

    const { data: notification } = await supabase
      .from("notifications")
      .select("id, user_id, type, created_at")
      .eq("id", notification_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!notification || notification.type !== PRIVACY_CHECKIN_TYPE) {
      throw new ApiError(404, "Check-in not found");
    }

    const { data: enrollment } = await supabase
      .from("study_enrollments")
      .select("id")
      .eq("user_id", user.id)
      .is("withdrawn_at", null)
      .limit(1)
      .maybeSingle();
    if (!enrollment) return Response.json({ ok: true, recorded: false });

    const { data: existing } = await supabase
      .from("privacy_checkin_events")
      .select("id")
      .eq("notification_id", notification_id)
      .eq("action", action)
      .limit(1)
      .maybeSingle();
    if (existing) return Response.json({ ok: true, recorded: false, duplicate: true });

    const [{ data: delivered }, { data: userRow }] = await Promise.all([
      supabase
        .from("privacy_checkin_events")
        .select("cadence, exposure_number")
        .eq("notification_id", notification_id)
        .eq("action", "delivered")
        .limit(1)
        .maybeSingle(),
      supabase.from("users").select("metadata").eq("id", user.id).maybeSingle(),
    ]);
    const meta = (userRow?.metadata || {}) as Record<string, unknown>;

    const { error } = await supabase.from("privacy_checkin_events").insert({
      user_id: user.id,
      notification_id,
      cadence: (delivered?.cadence as string) ?? resolveCheckinCadence(meta),
      exposure_number: (delivered?.exposure_number as number) ?? null,
      action,
      reason,
      latency_ms: responseLatencyMs(notification.created_at as string, Date.now()),
      conditions: conditionsFromMetadata(meta),
    });
    if (error) {
      // Lost a race with a concurrent request for the same response: fine.
      if (error.code === "23505") return Response.json({ ok: true, recorded: false, duplicate: true });
      throw new ApiError(500, "Failed to record check-in response");
    }

    return Response.json({ ok: true, recorded: true }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
