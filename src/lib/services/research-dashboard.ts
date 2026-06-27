/**
 * Researcher dashboard aggregates (Workstream A / Task A9).
 *
 * Surfaces study health for the pilot's validation checks: enrollment vs target,
 * cell balance, behavioral-logging completeness, and referral-mechanic activity.
 * Shared by the dashboard page and /api/v1/research/dashboard.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { checkBalance } from "@/lib/services/randomization";

export interface StudyHealth {
  study: {
    id: string;
    study_code: string;
    name: string;
    status: string;
    current_sample_size: number;
    target_sample_size: number | null;
  } | null;
  balance: Awaited<ReturnType<typeof checkBalance>>;
  logging: {
    participants: number;
    with_privacy_events: number;
    with_snapshots: number;
    privacy_events_total: number;
    events_last_24h: number;
  };
  referral: {
    minion_links: number;
    referral_points_total: number;
  };
}

export async function getStudyHealth(studyId: string): Promise<StudyHealth> {
  const supabase = await createSupabaseServiceClient();

  const { data: study } = await supabase
    .from("treatment_studies")
    .select("id, study_code, name, status, current_sample_size, target_sample_size")
    .eq("id", studyId)
    .maybeSingle();

  const { data: enrollments } = await supabase
    .from("study_enrollments")
    .select("user_id")
    .eq("study_id", studyId)
    .is("withdrawn_at", null);
  const userIds = (enrollments || []).map((e) => e.user_id);

  const balance = await checkBalance(studyId);

  // Logging completeness.
  const usersWithEvents = new Set<string>();
  let privacyEventsTotal = 0;
  let eventsLast24h = 0;
  const since = Date.now() - 24 * 3_600_000;
  if (userIds.length > 0) {
    const { data: events } = await supabase
      .from("privacy_events")
      .select("user_id, created_at")
      .in("user_id", userIds);
    for (const e of events || []) {
      usersWithEvents.add(e.user_id);
      privacyEventsTotal++;
      if (new Date(e.created_at).getTime() >= since) eventsLast24h++;
    }
  }

  const usersWithSnapshots = new Set<string>();
  if (userIds.length > 0) {
    const { data: snaps } = await supabase
      .from("privacy_index_snapshots")
      .select("user_id")
      .in("user_id", userIds);
    for (const s of snaps || []) usersWithSnapshots.add(s.user_id);
  }

  // Referral mechanic.
  let minionLinks = 0;
  let referralPointsTotal = 0;
  if (userIds.length > 0) {
    const { count } = await supabase
      .from("minion_links")
      .select("*", { count: "exact", head: true })
      .in("recruiter_id", userIds);
    minionLinks = count || 0;

    const { data: refPoints } = await supabase
      .from("points_ledger")
      .select("amount")
      .eq("source_type", "referral")
      .in("user_id", userIds);
    referralPointsTotal = (refPoints || []).reduce((s, r) => s + (r.amount || 0), 0);
  }

  return {
    study: study || null,
    balance,
    logging: {
      participants: userIds.length,
      with_privacy_events: usersWithEvents.size,
      with_snapshots: usersWithSnapshots.size,
      privacy_events_total: privacyEventsTotal,
      events_last_24h: eventsLast24h,
    },
    referral: {
      minion_links: minionLinks,
      referral_points_total: referralPointsTotal,
    },
  };
}

/** Find the study to show by default (auto-enroll active study, else newest active). */
export async function getDefaultStudyId(): Promise<string | null> {
  const supabase = await createSupabaseServiceClient();
  const { data: auto } = await supabase
    .from("treatment_studies")
    .select("id")
    .eq("auto_enroll", true)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (auto?.id) return auto.id;

  const { data: active } = await supabase
    .from("treatment_studies")
    .select("id")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return active?.id || null;
}
