/**
 * Privacy check-in cron (build plan D2, storyline S4).
 *
 * Condition-AWARE by design: sends the "review your privacy settings" check-in
 * on the participant's assigned cadence (none / biweekly / weekly). It is kept
 * separate from the re-engagement cron so that job stays condition-blind.
 *
 * Every delivery writes a notifications row plus a `delivered` event carrying
 * exposure_number and the condition map; a due slot the participant has opted
 * out of writes one `skipped` event instead. CRON_SECRET auth, same pattern as
 * the other crons.
 */

import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { conditionsFromMetadata } from "@/lib/utils/conditions";
import {
  decideCheckin,
  resolveCheckinCadence,
  CHECKIN_MESSAGE,
  PRIVACY_CHECKIN_TYPE,
} from "@/lib/services/privacy-checkin";

export const maxDuration = 60;

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

interface SlotHistory {
  lastDelivered: string | null;
  lastSkipped: string | null;
  delivered: number;
}

function later(a: string | null, b: string): string {
  return !a || new Date(b).getTime() > new Date(a).getTime() ? b : a;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || !auth || !safeCompare(auth, `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createSupabaseServiceClient();
  const nowMs = Date.now();

  // Earliest active enrollment per participant anchors the schedule.
  const { data: enrollments } = await supabase
    .from("study_enrollments")
    .select("user_id, enrolled_at")
    .is("withdrawn_at", null);
  const enrolledAt = new Map<string, string>();
  for (const e of enrollments || []) {
    const uid = e.user_id as string;
    const at = e.enrolled_at as string;
    const prev = enrolledAt.get(uid);
    if (!prev || new Date(at).getTime() < new Date(prev).getTime()) enrolledAt.set(uid, at);
  }

  const counts = { participants_considered: enrolledAt.size, none_arm: 0, checkins_sent: 0, skipped_opted_out: 0 };
  if (enrolledAt.size === 0) return Response.json(counts);

  // Arms first, so the none arm costs no further reads.
  const { data: users } = await supabase
    .from("users")
    .select("id, metadata")
    .in("id", [...enrolledAt.keys()]);
  const metaById = new Map<string, Record<string, unknown>>();
  for (const u of users || []) metaById.set(u.id as string, (u.metadata || {}) as Record<string, unknown>);

  const active = [...enrolledAt.keys()].filter((uid) => resolveCheckinCadence(metaById.get(uid)) !== "none");
  counts.none_arm = enrolledAt.size - active.length;
  if (active.length === 0) return Response.json(counts);

  const [{ data: prefs }, { data: history }] = await Promise.all([
    supabase
      .from("notification_preferences")
      .select("user_id, push_enabled, disabled_types")
      .in("user_id", active),
    supabase
      .from("privacy_checkin_events")
      .select("user_id, action, created_at")
      .in("user_id", active)
      .in("action", ["delivered", "skipped"]),
  ]);

  const prefsById = new Map<string, { push_enabled: boolean | null; disabled_types: string[] | null }>();
  for (const p of prefs || []) prefsById.set(p.user_id as string, p as never);

  const slots = new Map<string, SlotHistory>();
  for (const h of history || []) {
    const uid = h.user_id as string;
    const s = slots.get(uid) ?? { lastDelivered: null, lastSkipped: null, delivered: 0 };
    if (h.action === "delivered") {
      s.lastDelivered = later(s.lastDelivered, h.created_at as string);
      s.delivered += 1;
    } else {
      s.lastSkipped = later(s.lastSkipped, h.created_at as string);
    }
    slots.set(uid, s);
  }

  for (const userId of active) {
    const meta = metaById.get(userId);
    const cadence = resolveCheckinCadence(meta);
    const slot = slots.get(userId) ?? { lastDelivered: null, lastSkipped: null, delivered: 0 };
    const pref = prefsById.get(userId);

    const decision = decideCheckin(
      {
        cadence,
        enrolledAt: enrolledAt.get(userId)!,
        lastCheckinAt: slot.lastDelivered,
        lastSkippedAt: slot.lastSkipped,
        deliveredCount: slot.delivered,
        pushEnabled: pref?.push_enabled ?? true,
        disabledTypes: pref?.disabled_types ?? [],
      },
      nowMs
    );

    const conditions = conditionsFromMetadata(meta);

    if (decision.reason === "opted_out") {
      const { error } = await supabase.from("privacy_checkin_events").insert({
        user_id: userId,
        cadence,
        action: "skipped",
        reason: "opted_out",
        conditions,
      });
      if (!error) counts.skipped_opted_out++;
      continue;
    }
    if (!decision.send) continue;

    const { data: notification, error: nErr } = await supabase
      .from("notifications")
      .insert({
        user_id: userId,
        type: PRIVACY_CHECKIN_TYPE,
        title: CHECKIN_MESSAGE.title,
        body: CHECKIN_MESSAGE.body,
        entity_type: PRIVACY_CHECKIN_TYPE,
      })
      .select("id")
      .single();
    if (nErr || !notification) continue;

    const { error } = await supabase.from("privacy_checkin_events").insert({
      user_id: userId,
      notification_id: notification.id,
      cadence,
      exposure_number: decision.exposureDue,
      action: "delivered",
      conditions,
    });
    if (!error) counts.checkins_sent++;
  }

  return Response.json(counts);
}
