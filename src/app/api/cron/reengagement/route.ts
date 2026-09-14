/**
 * Re-engagement nudge cron (Workstream B / Task B4).
 *
 * RESEARCH-INTEGRITY GUARDRAIL: nudges are applied UNIFORMLY across all
 * participants and privacy conditions. This route selects recipients ONLY by
 * engagement signals (inactivity + cooldown) and the participant's own
 * notification preferences — it never reads `privacy_treatment`,
 * `profile_visibility`, or any condition field, and never branches on condition.
 * See src/lib/services/reengagement.ts for the (condition-blind, tested) decision.
 *
 * CRON_SECRET auth, same pattern as the other crons.
 */

import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  decideReengagement,
  reengagementMessage,
  REENGAGEMENT_TYPE,
  type ParticipantEngagement,
} from "@/lib/services/reengagement";

export const maxDuration = 60;

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function latest(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  table: string,
  userColumn: string,
  userId: string,
  timeColumn: string
): Promise<string | null> {
  const { data } = await supabase
    .from(table)
    .select(timeColumn)
    .eq(userColumn, userId)
    .order(timeColumn, { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Record<string, string> | null)?.[timeColumn] ?? null;
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || !auth || !safeCompare(auth, `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createSupabaseServiceClient();
  const nowMs = Date.now();

  const { data: enrollments } = await supabase
    .from("study_enrollments")
    .select("user_id, enrolled_at")
    .is("withdrawn_at", null);

  let nudged = 0;
  let considered = 0;

  for (const e of enrollments || []) {
    considered++;
    const userId = e.user_id as string;

    // Activity signal: most recent gameplay (session start or find completion),
    // falling back to enrollment as the baseline. Condition-independent.
    const lastSession = await latest(supabase, "play_sessions", "user_id", userId, "started_at");
    const lastFind = await latest(supabase, "find_completions", "user_id", userId, "completed_at");
    const lastSeenAt = maxIso(maxIso(lastSession, lastFind), e.enrolled_at as string);

    const lastNudge = await supabase
      .from("notifications")
      .select("created_at")
      .eq("user_id", userId)
      .eq("type", REENGAGEMENT_TYPE)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: prefs } = await supabase
      .from("notification_preferences")
      .select("push_enabled, disabled_types")
      .eq("user_id", userId)
      .maybeSingle();

    const engagement: ParticipantEngagement = {
      lastSeenAt,
      lastNudgeAt: lastNudge.data?.created_at ?? null,
      pushEnabled: prefs?.push_enabled ?? true,
      disabledTypes: prefs?.disabled_types ?? [],
    };

    const decision = decideReengagement(engagement, nowMs);
    if (!decision.shouldNudge || decision.daysInactive == null) continue;

    const msg = reengagementMessage(decision.daysInactive);
    const { error } = await supabase.from("notifications").insert({
      user_id: userId,
      type: REENGAGEMENT_TYPE,
      title: msg.title,
      body: msg.body,
    });
    if (!error) nudged++;
  }

  return Response.json({
    participants_considered: considered,
    nudges_sent: nudged,
  });
}
