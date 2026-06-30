/**
 * Research Data Export Service (Workstream A / Task A8).
 *
 * Generates anonymized CSV/TSV exports: one row per enrolled, non-withdrawn
 * participant with demographics, treatment assignments, real behavioral
 * aggregates, the privacy-index trajectory, and referral outcomes.
 * No PII (email/auth_id/real name) is ever emitted.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";

export interface ExportConfig {
  studyId: string;
  format: "csv" | "tsv";
  includeRawEvents?: boolean;
}

function inc(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

export async function generateResearchExport(config: ExportConfig): Promise<string> {
  const supabase = await createSupabaseServiceClient();

  // Enrolled, non-withdrawn participants.
  const { data: enrollments } = await supabase
    .from("study_enrollments")
    .select("user_id, enrolled_at")
    .eq("study_id", config.studyId)
    .is("withdrawn_at", null);

  if (!enrollments || enrollments.length === 0) return "";

  const userIds = enrollments.map((e) => e.user_id);

  // Demographics (no PII).
  const { data: users } = await supabase
    .from("users")
    .select("id, role, age_band, created_at")
    .in("id", userIds);

  // Treatment assignments.
  const { data: assignments } = await supabase
    .from("dimension_assignments")
    .select("user_id, level, treatment_dimensions(name)")
    .in("user_id", userIds);

  // Play sessions → hunts completed + map session→user.
  const { data: sessions } = await supabase
    .from("play_sessions")
    .select("id, user_id, status")
    .in("user_id", userIds);

  const sessionToUser = new Map<string, string>();
  const huntsCompleted = new Map<string, number>();
  for (const s of sessions || []) {
    sessionToUser.set(s.id, s.user_id);
    if (s.status === "completed") inc(huntsCompleted, s.user_id);
  }

  // Find completions (via session) → finds completed.
  const findsCompleted = new Map<string, number>();
  const sessionIds = (sessions || []).map((s) => s.id);
  if (sessionIds.length > 0) {
    const { data: finds } = await supabase
      .from("find_completions")
      .select("play_session_id, completed_at")
      .in("play_session_id", sessionIds);
    for (const f of finds || []) {
      if (!f.completed_at) continue;
      const uid = sessionToUser.get(f.play_session_id);
      if (uid) inc(findsCompleted, uid);
    }
  }

  // Points ledger → total + referral points.
  const totalPoints = new Map<string, number>();
  const referralPoints = new Map<string, number>();
  const { data: ledger } = await supabase
    .from("points_ledger")
    .select("user_id, amount, source_type")
    .in("user_id", userIds);
  for (const p of ledger || []) {
    inc(totalPoints, p.user_id, p.amount || 0);
    if (p.source_type === "referral") inc(referralPoints, p.user_id, p.amount || 0);
  }

  // Minion counts (as recruiter).
  const minionCount = new Map<string, number>();
  const { data: minions } = await supabase
    .from("minion_links")
    .select("recruiter_id")
    .in("recruiter_id", userIds);
  for (const m of minions || []) inc(minionCount, m.recruiter_id);

  // Privacy-index trajectory → t0 + final.
  const indexT0 = new Map<string, number>();
  const indexFinal = new Map<string, number>();
  const finalAt = new Map<string, string>();
  const { data: snapshots } = await supabase
    .from("privacy_index_snapshots")
    .select("user_id, index_value, source, created_at")
    .in("user_id", userIds)
    .order("created_at", { ascending: true });
  for (const s of snapshots || []) {
    if (s.source === "enrollment" && !indexT0.has(s.user_id)) {
      indexT0.set(s.user_id, Number(s.index_value));
    }
    if (!indexT0.has(s.user_id)) indexT0.set(s.user_id, Number(s.index_value)); // earliest fallback
    // Snapshots are ascending, so the last seen per user is the final value.
    indexFinal.set(s.user_id, Number(s.index_value));
    finalAt.set(s.user_id, s.created_at);
  }

  // Privacy events → change/tighten/loosen/abandon counts + first change time.
  const changeCount = new Map<string, number>();
  const tightenCount = new Map<string, number>();
  const loosenCount = new Map<string, number>();
  const abandonCount = new Map<string, number>();
  const firstChangeAt = new Map<string, string>();
  const totalEvents = new Map<string, number>();
  const { data: pEvents } = await supabase
    .from("privacy_events")
    .select("user_id, event_type, metadata, created_at")
    .in("user_id", userIds)
    .order("created_at", { ascending: true });
  for (const e of pEvents || []) {
    inc(totalEvents, e.user_id);
    if (e.event_type === "privacy_change") {
      inc(changeCount, e.user_id);
      if (!firstChangeAt.has(e.user_id)) firstChangeAt.set(e.user_id, e.created_at);
      const dir = (e.metadata as { direction?: string } | null)?.direction;
      if (dir === "tighten") inc(tightenCount, e.user_id);
      else if (dir === "loosen") inc(loosenCount, e.user_id);
    } else if (e.event_type === "privacy_abandon") {
      inc(abandonCount, e.user_id);
    }
  }

  // Treatment dimension names for headers.
  const dimensionNames = new Set<string>();
  for (const a of assignments || []) {
    dimensionNames.add((a.treatment_dimensions as unknown as { name: string }).name);
  }

  const separator = config.format === "tsv" ? "\t" : ",";
  const num = (n: number | undefined, dp = 0) =>
    n === undefined ? "" : dp > 0 ? n.toFixed(dp) : String(n);

  const headers = [
    "participant_id",
    "age_band",
    "role",
    "enrolled_at",
    ...Array.from(dimensionNames).map((d) => `treatment_${d.replace(/\s/g, "_").toLowerCase()}`),
    "total_hunts_completed",
    "total_finds_completed",
    "total_points",
    "referral_points_earned",
    "minion_count",
    "privacy_index_t0",
    "privacy_index_final",
    "privacy_changes_count",
    "tighten_count",
    "loosen_count",
    "abandon_count",
    "time_to_first_change_hours",
    "total_privacy_events",
  ];

  const rows: string[][] = [];
  for (let i = 0; i < userIds.length; i++) {
    const userId = userIds[i];
    const user = users?.find((u) => u.id === userId);
    const enrollment = enrollments.find((e) => e.user_id === userId);
    const participantId = `P${String(i + 1).padStart(4, "0")}`;

    const userAssignments = (assignments || []).filter((a) => a.user_id === userId);
    const treatmentValues = Array.from(dimensionNames).map((dimName) => {
      const a = userAssignments.find(
        (x) => (x.treatment_dimensions as unknown as { name: string }).name === dimName
      );
      return a?.level || "";
    });

    // Time to first change in hours since enrollment.
    let ttfc = "";
    const fc = firstChangeAt.get(userId);
    if (fc && enrollment?.enrolled_at) {
      const hours = (new Date(fc).getTime() - new Date(enrollment.enrolled_at).getTime()) / 3_600_000;
      if (Number.isFinite(hours) && hours >= 0) ttfc = hours.toFixed(2);
    }

    rows.push([
      participantId,
      user?.age_band || "",
      user?.role || "",
      enrollment?.enrolled_at || "",
      ...treatmentValues,
      num(huntsCompleted.get(userId) || 0),
      num(findsCompleted.get(userId) || 0),
      num(totalPoints.get(userId) || 0),
      num(referralPoints.get(userId) || 0),
      num(minionCount.get(userId) || 0),
      indexT0.has(userId) ? num(indexT0.get(userId), 4) : "",
      indexFinal.has(userId) ? num(indexFinal.get(userId), 4) : "",
      num(changeCount.get(userId) || 0),
      num(tightenCount.get(userId) || 0),
      num(loosenCount.get(userId) || 0),
      num(abandonCount.get(userId) || 0),
      ttfc,
      num(totalEvents.get(userId) || 0),
    ]);
  }

  const escape = (v: string) =>
    v.includes(separator) || v.includes('"') || v.includes("\n")
      ? `"${v.replace(/"/g, '""')}"`
      : v;

  return [headers.join(separator), ...rows.map((r) => r.map(escape).join(separator))].join("\n");
}
