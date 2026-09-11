/**
 * Researcher dashboard aggregates (Workstream A / Task A9).
 *
 * Surfaces study health for the pilot's validation checks: enrollment vs target,
 * cell balance, behavioral-logging completeness, and referral-mechanic activity.
 * Shared by the dashboard page and /api/v1/research/dashboard.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { checkBalance } from "@/lib/services/randomization";
import { ENROLLMENT_FAILED_EVENT } from "@/lib/services/enrollment";

export interface StudyHealth {
  study: {
    id: string;
    study_code: string;
    name: string;
    status: string;
    current_sample_size: number;
    target_sample_size: number | null;
  } | null;
  /**
   * research/study_enrollment_failed behavioral_events in the last 7 days (B7).
   * Not study-scoped: a failure can happen before the study is even resolved.
   */
  enrollment_failures_7d: number;
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
  /** Delivery→submission funnel per survey timepoint (T1/T2/T3). */
  surveys: SurveyFunnelRow[];
}

export interface SurveyFunnelRow {
  timepoint: string;
  survey_title: string;
  survey_status: string;
  delivered: number;
  opened: number;
  submitted: number;
  expired: number;
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

  // Enrollment failures surfaced by enrollParticipant()'s catch block (B7).
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
  const { count: enrollmentFailures7d } = await supabase
    .from("behavioral_events")
    .select("*", { count: "exact", head: true })
    .eq("event_type", ENROLLMENT_FAILED_EVENT.eventType)
    .eq("event_name", ENROLLMENT_FAILED_EVENT.eventName)
    .gte("created_at", sevenDaysAgo);

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

  // Survey delivery/submission funnel per timepoint — one of the four pilot
  // validation checks (prospectus §7c: survey timing/delivery).
  const surveys: SurveyFunnelRow[] = [];
  const { data: schedules } = await supabase
    .from("survey_schedules")
    .select("survey_id, trigger_config, surveys(title, status)")
    .eq("trigger_type", "time");
  const scheduleRows = (schedules || [])
    .map((s) => {
      const cfg = (s.trigger_config || {}) as { timepoint?: string; offset_days?: number };
      const survey = s.surveys as unknown as { title: string; status: string } | null;
      return {
        surveyId: s.survey_id,
        timepoint: cfg.timepoint || (cfg.offset_days !== undefined ? `d${cfg.offset_days}` : "?"),
        title: survey?.title || "",
        status: survey?.status || "",
      };
    })
    .sort((a, b) => a.timepoint.localeCompare(b.timepoint));

  if (scheduleRows.length > 0 && userIds.length > 0) {
    const { data: deliveries } = await supabase
      .from("survey_deliveries")
      .select("survey_id, status")
      .in("user_id", userIds)
      .in("survey_id", scheduleRows.map((r) => r.surveyId));
    for (const row of scheduleRows) {
      const mine = (deliveries || []).filter((d) => d.survey_id === row.surveyId);
      surveys.push({
        timepoint: row.timepoint,
        survey_title: row.title,
        survey_status: row.status,
        delivered: mine.length,
        opened: mine.filter((d) => d.status === "opened" || d.status === "submitted").length,
        submitted: mine.filter((d) => d.status === "submitted").length,
        expired: mine.filter((d) => d.status === "expired").length,
      });
    }
  } else {
    for (const row of scheduleRows) {
      surveys.push({
        timepoint: row.timepoint,
        survey_title: row.title,
        survey_status: row.status,
        delivered: 0,
        opened: 0,
        submitted: 0,
        expired: 0,
      });
    }
  }

  return {
    study: study || null,
    enrollment_failures_7d: enrollmentFailures7d || 0,
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
    surveys,
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
