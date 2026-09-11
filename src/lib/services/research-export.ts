/**
 * Research Data Export Service (Workstream A / Task A8).
 *
 * Generates anonymized CSV/TSV exports: one row per enrolled, non-withdrawn
 * participant with demographics, treatment assignments, real behavioral
 * aggregates, the privacy-index trajectory, and referral outcomes.
 * No PII (email/auth_id/real name) is ever emitted.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  scoreAnswers,
  isScorableQuestionType,
  type ScorableQuestion,
} from "@/lib/services/survey-scoring";
import {
  idealFromAnswers,
  settingsError,
  pickSnapshotAt,
  IDEAL_AUDIENCE_SUBSCALE,
  type SettingsErrorResult,
  type TimedVisibility,
} from "@/lib/utils/settings-error";
import { loadStorylineColumns } from "@/lib/services/storyline-export";
import { fetchAllByIds, fetchAllRows } from "@/lib/utils/paginate";

export type ExportFormat = "csv" | "tsv" | "json";

export interface ExportConfig {
  studyId: string;
  format: ExportFormat;
}

function inc(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

interface ExportFieldDelta {
  field: string;
  from: string | null;
  to: string | null;
}

/**
 * Count cross-save decision reversals in a participant's ordered sequence of
 * privacy_change delta lists: a change that returns a field to the exact value
 * a previous change moved it away from (a→b … b→a). Pure + testable.
 */
export function countReversals(changeDeltas: ExportFieldDelta[][]): number {
  const lastTransition = new Map<string, { from: string | null; to: string | null }>();
  let reversals = 0;
  for (const deltas of changeDeltas) {
    for (const d of deltas) {
      const prev = lastTransition.get(d.field);
      if (prev && prev.to === d.from && prev.from === d.to) reversals++;
      lastTransition.set(d.field, { from: d.from, to: d.to });
    }
  }
  return reversals;
}

/** Anonymized, sequential participant id (never derived from PII). */
export function participantId(index: number): string {
  return `P${String(index + 1).padStart(4, "0")}`;
}

/** Escape one CSV/TSV field: quote when it contains the separator, a quote, or a newline. */
export function escapeField(value: string, separator: string): string {
  return value.includes(separator) || value.includes('"') || value.includes("\n")
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

/** Serialize a header + rows into a CSV/TSV string. Pure + testable. */
export function serializeTable(headers: string[], rows: string[][], separator: string): string {
  return [
    headers.join(separator),
    ...rows.map((r) => r.map((v) => escapeField(v, separator)).join(separator)),
  ].join("\n");
}

/** Serialize a header + rows into a JSON array of objects (one per row). Pure. */
export function tableToJSON(headers: string[], rows: string[][]): string {
  return JSON.stringify(
    rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]))),
  );
}

/** Serialize a table in the requested format. */
export function serialize(headers: string[], rows: string[][], format: ExportFormat): string {
  if (format === "json") return tableToJSON(headers, rows);
  return serializeTable(headers, rows, format === "tsv" ? "\t" : ",");
}

/** `treatment_<dimension>` header for one dimension name. Pure. */
export function treatmentHeader(dimensionName: string): string {
  return `treatment_${dimensionName.replace(/\s/g, "_").toLowerCase()}`;
}

/** The two legacy denormalized condition columns (migration 048). */
export interface LegacyConditionColumns {
  treatment?: string | null;
  privacy_default?: string | null;
}

/** Dimension name → which legacy column carried it before migration 053. */
const LEGACY_COLUMN_FOR_DIMENSION: Readonly<Record<string, keyof LegacyConditionColumns>> = {
  privacy_control_complexity: "treatment",
  privacy_default: "privacy_default",
};

/**
 * One value per dimension for a long-format row: the `conditions` JSONB map
 * (migration 053) first, falling back to the legacy column for the two
 * dimensions that had one, else "". Pure.
 */
export function conditionValues(
  dimensionNames: readonly string[],
  conditions: Record<string, unknown> | null | undefined,
  legacy: LegacyConditionColumns | null | undefined
): string[] {
  return dimensionNames.map((name) => {
    const fromJson = conditions?.[name];
    if (typeof fromJson === "string" && fromJson) return fromJson;
    const col = LEGACY_COLUMN_FOR_DIMENSION[name];
    const fromLegacy = col ? legacy?.[col] : undefined;
    return typeof fromLegacy === "string" ? fromLegacy : "";
  });
}

export async function generateResearchExport(config: ExportConfig): Promise<string> {
  const supabase = await createSupabaseServiceClient();

  // Every read below is paginated: PostgREST caps a response at 1000 rows and
  // does not say so, which silently truncated the trajectory and made the
  // "final" index the earliest one (found by the H9 dry run). Reads filtered by
  // participant are also chunked, so the id list never overflows the URL.
  const enrollments = await fetchAllRows<{ user_id: string; enrolled_at: string }>((from, to) =>
    supabase
      .from("study_enrollments")
      .select("user_id, enrolled_at")
      .eq("study_id", config.studyId)
      .is("withdrawn_at", null)
      .order("user_id", { ascending: true })
      .range(from, to)
  );

  if (enrollments.length === 0) return "";

  const userIds = enrollments.map((e) => e.user_id);

  // Demographics (no PII).
  const users = await fetchAllByIds<{ id: string; role: string | null; created_at: string }>(
    userIds,
    (ids, from, to) =>
      supabase
        .from("users")
        .select("id, role, created_at")
        .in("id", ids)
        .order("id", { ascending: true })
        .range(from, to)
  );

  // The age band lives on user_profiles.effective_band. Selecting age_band from
  // `users` (no such column) failed the query above outright, which emptied the
  // role column too — every participant exported blank on both.
  const profiles = await fetchAllByIds<{ user_id: string; effective_band: string | null }>(
    userIds,
    (ids, from, to) =>
      supabase
        .from("user_profiles")
        .select("user_id, effective_band")
        .in("user_id", ids)
        .order("user_id", { ascending: true })
        .range(from, to)
  );
  const bandByUser = new Map(profiles.map((p) => [p.user_id, p.effective_band ?? ""]));

  // Treatment assignments.
  const assignments = await fetchAllByIds<{ user_id: string; level: string; treatment_dimensions: unknown }>(
    userIds,
    (ids, from, to) =>
      supabase
        .from("dimension_assignments")
        .select("user_id, level, treatment_dimensions(name)")
        .in("user_id", ids)
        .order("user_id", { ascending: true })
        .range(from, to)
  );

  // Play sessions → hunts completed + map session→user.
  const sessions = await fetchAllByIds<{ id: string; user_id: string; status: string }>(
    userIds,
    (ids, from, to) =>
      supabase
        .from("play_sessions")
        .select("id, user_id, status")
        .in("user_id", ids)
        .order("id", { ascending: true })
        .range(from, to)
  );

  const sessionToUser = new Map<string, string>();
  const huntsCompleted = new Map<string, number>();
  for (const s of sessions || []) {
    sessionToUser.set(s.id, s.user_id);
    if (s.status === "completed") inc(huntsCompleted, s.user_id);
  }

  // Find completions (via session) → finds completed.
  const findsCompleted = new Map<string, number>();
  const sessionIds = sessions.map((s) => s.id);
  if (sessionIds.length > 0) {
    const finds = await fetchAllByIds<{ play_session_id: string; completed_at: string | null }>(
      sessionIds,
      (ids, from, to) =>
        supabase
          .from("find_completions")
          .select("play_session_id, completed_at")
          .in("play_session_id", ids)
          .order("play_session_id", { ascending: true })
          .range(from, to)
    );
    for (const f of finds) {
      if (!f.completed_at) continue;
      const uid = sessionToUser.get(f.play_session_id);
      if (uid) inc(findsCompleted, uid);
    }
  }

  // Points ledger → total + referral points.
  const totalPoints = new Map<string, number>();
  const referralPoints = new Map<string, number>();
  const ledger = await fetchAllByIds<{ user_id: string; amount: number | null; source_type: string }>(
    userIds,
    (ids, from, to) =>
      supabase
        .from("points_ledger")
        .select("user_id, amount, source_type")
        .in("user_id", ids)
        .order("user_id", { ascending: true })
        .range(from, to)
  );
  for (const p of ledger) {
    inc(totalPoints, p.user_id, p.amount || 0);
    if (p.source_type === "referral") inc(referralPoints, p.user_id, p.amount || 0);
  }

  // Minion counts (as recruiter).
  const minionCount = new Map<string, number>();
  const minions = await fetchAllByIds<{ recruiter_id: string }>(userIds, (ids, from, to) =>
    supabase
      .from("minion_links")
      .select("recruiter_id")
      .in("recruiter_id", ids)
      .order("recruiter_id", { ascending: true })
      .range(from, to)
  );
  for (const m of minions) inc(minionCount, m.recruiter_id);

  // Privacy-index trajectory → t0 + final.
  const indexT0 = new Map<string, number>();
  const indexFinal = new Map<string, number>();
  const finalAt = new Map<string, string>();
  // Full visibility map per snapshot is kept so the ideal-audience block
  // (migration 058) can be paired with the settings in force at submission.
  const snapshotsByUser = new Map<string, TimedVisibility[]>();
  const snapshots = await fetchAllByIds<{
    user_id: string;
    index_value: number | string;
    source: string;
    created_at: string;
    visibility: unknown;
  }>(userIds, (ids, from, to) =>
    supabase
      .from("privacy_index_snapshots")
      .select("user_id, index_value, source, created_at, visibility")
      .in("user_id", ids)
      .order("created_at", { ascending: true })
      .range(from, to)
  );
  for (const s of snapshots) {
    if (!snapshotsByUser.has(s.user_id)) snapshotsByUser.set(s.user_id, []);
    snapshotsByUser.get(s.user_id)!.push({
      created_at: s.created_at,
      visibility: (s.visibility ?? undefined) as Record<string, string> | undefined,
    });
    if (s.source === "enrollment" && !indexT0.has(s.user_id)) {
      indexT0.set(s.user_id, Number(s.index_value));
    }
    if (!indexT0.has(s.user_id)) indexT0.set(s.user_id, Number(s.index_value)); // earliest fallback
    // Snapshots are ascending, so the last seen per user is the final value.
    indexFinal.set(s.user_id, Number(s.index_value));
    finalAt.set(s.user_id, s.created_at);
  }

  // Privacy events → change/tighten/loosen/abandon/view/touch counts,
  // first change time, and cross-save reversal reconstruction.
  const changeCount = new Map<string, number>();
  const tightenCount = new Map<string, number>();
  const loosenCount = new Map<string, number>();
  const abandonCount = new Map<string, number>();
  const viewCount = new Map<string, number>();
  const fieldTouchCount = new Map<string, number>();
  const firstChangeAt = new Map<string, string>();
  const totalEvents = new Map<string, number>();
  const changeDeltasByUser = new Map<string, ExportFieldDelta[][]>();
  const pEvents = await fetchAllByIds<{
    user_id: string;
    event_type: string;
    metadata: unknown;
    created_at: string;
  }>(userIds, (ids, from, to) =>
    supabase
      .from("privacy_events")
      .select("user_id, event_type, metadata, created_at")
      .in("user_id", ids)
      .order("created_at", { ascending: true })
      .range(from, to)
  );
  for (const e of pEvents) {
    inc(totalEvents, e.user_id);
    if (e.event_type === "privacy_change") {
      inc(changeCount, e.user_id);
      if (!firstChangeAt.has(e.user_id)) firstChangeAt.set(e.user_id, e.created_at);
      const meta = e.metadata as { direction?: string; deltas?: ExportFieldDelta[] } | null;
      if (meta?.direction === "tighten") inc(tightenCount, e.user_id);
      else if (meta?.direction === "loosen") inc(loosenCount, e.user_id);
      if (Array.isArray(meta?.deltas)) {
        if (!changeDeltasByUser.has(e.user_id)) changeDeltasByUser.set(e.user_id, []);
        changeDeltasByUser.get(e.user_id)!.push(meta.deltas);
      }
    } else if (e.event_type === "privacy_abandon") {
      inc(abandonCount, e.user_id);
    } else if (e.event_type === "privacy_view") {
      inc(viewCount, e.user_id);
    } else if (e.event_type === "privacy_field_touch") {
      inc(fieldTouchCount, e.user_id);
    }
  }

  // ── Survey scores per timepoint (T1/T2/T3) ──────────────────────
  // Map each scheduled survey to its timepoint label, score each participant's
  // submitted response by subscale, and expose a status per timepoint.
  // Any trigger type counts (T1 is event-triggered since migration 054); a
  // survey with several schedules keeps the first timepoint label seen.
  const surveyTimepoint = new Map<string, string>();
  const { data: schedules } = await supabase
    .from("survey_schedules")
    .select("survey_id, trigger_config");
  for (const s of schedules || []) {
    if (surveyTimepoint.has(s.survey_id)) continue;
    const cfg = (s.trigger_config || {}) as { timepoint?: string; offset_days?: number };
    const tp = cfg.timepoint || (cfg.offset_days !== undefined ? `d${cfg.offset_days}` : "survey");
    surveyTimepoint.set(s.survey_id, tp);
  }
  const surveyIds = [...surveyTimepoint.keys()];

  const questionsBySurvey = new Map<string, ScorableQuestion[]>();
  const subscalesByTp = new Map<string, Set<string>>();
  const statusByUserTp = new Map<string, Map<string, string>>(); // user → tp → status
  const scoreByUserTp = new Map<string, Map<string, number>>(); // user → `${tp}::${subscale}` → score
  // Timepoints carrying the ideal-audience block, and each user's settings error there.
  const idealTps = new Set<string>();
  const settingsErrorByUserTp = new Map<string, Map<string, SettingsErrorResult>>();

  if (surveyIds.length > 0) {
    const { data: questions } = await supabase
      .from("survey_questions")
      .select("survey_id, item_code, question_type, scale_config, reverse_coded, subscale, sort_order")
      .in("survey_id", surveyIds);
    for (const q of questions || []) {
      if (!questionsBySurvey.has(q.survey_id)) questionsBySurvey.set(q.survey_id, []);
      questionsBySurvey.get(q.survey_id)!.push(q as ScorableQuestion);
      const tp = surveyTimepoint.get(q.survey_id)!;
      if (q.subscale === IDEAL_AUDIENCE_SUBSCALE) idealTps.add(tp);
      // Only Likert-style subscales get a mean column; choice blocks are
      // exported through their own derived columns (settings_error_<tp>).
      if (q.subscale && isScorableQuestionType(q.question_type)) {
        if (!subscalesByTp.has(tp)) subscalesByTp.set(tp, new Set());
        subscalesByTp.get(tp)!.add(q.subscale);
      }
    }

    // Delivery status per (user, timepoint): prefer the most-complete state.
    const statusRank: Record<string, number> = { submitted: 4, opened: 3, expired: 2, pending: 1 };
    const deliveries = await fetchAllByIds<{ survey_id: string; user_id: string; status: string }>(
      userIds,
      (ids, from, to) =>
        supabase
          .from("survey_deliveries")
          .select("survey_id, user_id, status")
          .in("user_id", ids)
          .in("survey_id", surveyIds)
          .order("user_id", { ascending: true })
          .range(from, to)
    );
    for (const d of deliveries) {
      const tp = surveyTimepoint.get(d.survey_id);
      if (!tp) continue;
      if (!statusByUserTp.has(d.user_id)) statusByUserTp.set(d.user_id, new Map());
      const cur = statusByUserTp.get(d.user_id)!.get(tp);
      if (!cur || (statusRank[d.status] || 0) > (statusRank[cur] || 0)) {
        statusByUserTp.get(d.user_id)!.set(tp, d.status);
      }
    }

    // Latest response per (user, survey) → score by subscale.
    const latestAnswers = new Map<string, Record<string, number | string>>(); // `${user}::${survey}`
    const responses = await fetchAllByIds<{
      survey_id: string;
      user_id: string;
      answers: unknown;
      created_at: string;
    }>(userIds, (ids, from, to) =>
      supabase
        .from("survey_responses")
        .select("survey_id, user_id, answers, created_at")
        .in("user_id", ids)
        .in("survey_id", surveyIds)
        .order("created_at", { ascending: true })
        .range(from, to)
    );
    const latestAnswerAt = new Map<string, string>();
    for (const r of responses) {
      const key = `${r.user_id}::${r.survey_id}`;
      latestAnswers.set(key, (r.answers || {}) as Record<string, number | string>);
      latestAnswerAt.set(key, r.created_at);
    }
    for (const [key, answers] of latestAnswers) {
      const [uid, surveyId] = key.split("::");
      const qs = questionsBySurvey.get(surveyId);
      const tp = surveyTimepoint.get(surveyId);
      if (!qs || !tp) continue;
      if (!scoreByUserTp.has(uid)) scoreByUserTp.set(uid, new Map());
      for (const sub of scoreAnswers(qs, answers)) {
        scoreByUserTp.get(uid)!.set(`${tp}::${sub.subscale}`, sub.score);
      }

      // Settings error: ideal audience (this response) vs actual settings in
      // force when it was submitted (nearest snapshot).
      if (idealTps.has(tp)) {
        const ideal = idealFromAnswers(answers);
        if (Object.keys(ideal).length > 0) {
          const at = latestAnswerAt.get(key) || "";
          const snap = pickSnapshotAt(snapshotsByUser.get(uid) || [], at);
          const result = settingsError(ideal, snap?.visibility);
          if (!settingsErrorByUserTp.has(uid)) settingsErrorByUserTp.set(uid, new Map());
          settingsErrorByUserTp.get(uid)!.set(tp, result);
        }
      }
    }
  }

  const timepoints = [...new Set(surveyTimepoint.values())].sort();
  const sortedSubscalesByTp = new Map<string, string[]>();
  for (const tp of timepoints) {
    sortedSubscalesByTp.set(tp, [...(subscalesByTp.get(tp) || [])].sort());
  }

  // Treatment dimension names for headers.
  const dimensionNames = new Set<string>();
  for (const a of assignments || []) {
    dimensionNames.add((a.treatment_dimensions as unknown as { name: string }).name);
  }

  // Cohort-2 storyline columns (C2, C3, D2, D3), only for dimensions in play.
  const storyline = await loadStorylineColumns(supabase, userIds, dimensionNames);

  const num = (n: number | undefined, dp = 0) =>
    n === undefined ? "" : dp > 0 ? n.toFixed(dp) : String(n);

  // Survey columns: per timepoint, a status column + one column per subscale.
  const surveyHeaders: string[] = [];
  for (const tp of timepoints) {
    surveyHeaders.push(`survey_${tp}_status`);
    for (const sub of sortedSubscalesByTp.get(tp) || []) surveyHeaders.push(`survey_${tp}_${sub}`);
  }
  // Ideal-audience block (migration 058): settings error and over-sharing count
  // per timepoint that carries it.
  const sortedIdealTps = [...idealTps].sort();
  for (const tp of sortedIdealTps) {
    surveyHeaders.push(`settings_error_${tp}`, `over_shared_${tp}`);
  }

  const headers = [
    "participant_id",
    "age_band",
    "role",
    "enrolled_at",
    ...Array.from(dimensionNames).map(treatmentHeader),
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
    "reversal_count",
    "view_count",
    "field_touch_count",
    "successful_change_rate",
    "time_to_first_change_hours",
    "total_privacy_events",
    ...surveyHeaders,
    ...storyline.headers,
  ];

  const rows: string[][] = [];
  for (let i = 0; i < userIds.length; i++) {
    const userId = userIds[i];
    const user = users?.find((u) => u.id === userId);
    const enrollment = enrollments.find((e) => e.user_id === userId);
    const pid = participantId(i);

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

    // Per-timepoint survey status + subscale scores.
    const uStatus = statusByUserTp.get(userId);
    const uScore = scoreByUserTp.get(userId);
    const surveyValues: string[] = [];
    for (const tp of timepoints) {
      surveyValues.push(uStatus?.get(tp) || "none");
      for (const sub of sortedSubscalesByTp.get(tp) || []) {
        const v = uScore?.get(`${tp}::${sub}`);
        surveyValues.push(v === undefined ? "" : num(v, 2));
      }
    }
    const uErr = settingsErrorByUserTp.get(userId);
    for (const tp of sortedIdealTps) {
      const r = uErr?.get(tp);
      surveyValues.push(r && r.error !== null ? r.error.toFixed(4) : "");
      surveyValues.push(r ? num(r.over_shared) : "");
    }

    rows.push([
      pid,
      bandByUser.get(userId) || "",
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
      num(countReversals(changeDeltasByUser.get(userId) || [])),
      num(viewCount.get(userId) || 0),
      num(fieldTouchCount.get(userId) || 0),
      // Completed saves over initiated flows (completed + abandoned). Blank when
      // the participant never initiated a change flow at all.
      (() => {
        const completed = changeCount.get(userId) || 0;
        const initiated = completed + (abandonCount.get(userId) || 0);
        return initiated > 0 ? (completed / initiated).toFixed(3) : "";
      })(),
      ttfc,
      num(totalEvents.get(userId) || 0),
      ...surveyValues,
      ...storyline.valuesFor(userId),
    ]);
  }

  return serialize(headers, rows, config.format);
}

/**
 * Long-format privacy-index trajectory export: one row per snapshot, keyed to the
 * same anonymized participant ids as the participant-level export. Includes the
 * snapshot source, the neutral `unset` flag, and one treatment_<dimension>
 * column per study dimension (from the row's `conditions` map, migration 053) —
 * the shape growth-model / fatigue-over-time analyses (H4/H5) want.
 */
export async function generateTrajectoryExport(config: ExportConfig): Promise<string> {
  const supabase = await createSupabaseServiceClient();

  const enrollments = await fetchAllRows<{ user_id: string; enrolled_at: string }>((from, to) =>
    supabase
      .from("study_enrollments")
      .select("user_id, enrolled_at")
      .eq("study_id", config.studyId)
      .is("withdrawn_at", null)
      .order("user_id", { ascending: true })
      .range(from, to)
  );

  if (enrollments.length === 0) return "";

  // Stable P#### ids matching the participant-level export (enrollment order).
  const userIds = enrollments.map((e) => e.user_id);
  const pidByUser = new Map<string, string>();
  const enrolledAtByUser = new Map<string, string>();
  userIds.forEach((uid, i) => pidByUser.set(uid, participantId(i)));
  for (const e of enrollments) enrolledAtByUser.set(e.user_id, e.enrolled_at);

  const snapshots = await fetchAllByIds<{
    user_id: string;
    index_value: number | string;
    source: string | null;
    unset: boolean | null;
    treatment: string | null;
    privacy_default: string | null;
    conditions: unknown;
    created_at: string;
  }>(userIds, (ids, from, to) =>
    supabase
      .from("privacy_index_snapshots")
      .select("user_id, index_value, source, unset, treatment, privacy_default, conditions, created_at")
      .in("user_id", ids)
      .order("created_at", { ascending: true })
      .range(from, to)
  );

  // One treatment_<dimension> column per dimension linked to the study, read
  // from the row's own `conditions` map (legacy columns as fallback).
  const dimensionNames = await loadStudyDimensionNames(supabase, config.studyId);

  const headers = [
    "participant_id",
    "snapshot_at",
    "days_since_enrollment",
    "index_value",
    "source",
    "unset",
    ...dimensionNames.map(treatmentHeader),
  ];

  const rows: string[][] = [];
  for (const s of snapshots) {
    const pid = pidByUser.get(s.user_id);
    if (!pid) continue;
    const enrolledAt = enrolledAtByUser.get(s.user_id);
    let days = "";
    if (enrolledAt) {
      const d = (new Date(s.created_at).getTime() - new Date(enrolledAt).getTime()) / 86_400_000;
      if (Number.isFinite(d) && d >= 0) days = d.toFixed(3);
    }
    rows.push([
      pid,
      s.created_at,
      days,
      Number(s.index_value).toFixed(4),
      s.source ?? "",
      s.unset ? "true" : "false",
      ...conditionValues(dimensionNames, s.conditions as Record<string, unknown> | null, s),
    ]);
  }

  return serialize(headers, rows, config.format);
}

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

/**
 * Names of the dimensions linked to a study, in sort_order (then name) so the
 * long-format datasets emit treatment_<dimension> columns in a stable order.
 */
export async function loadStudyDimensionNames(
  supabase: ServiceClient,
  studyId: string
): Promise<string[]> {
  const { data } = await supabase
    .from("treatment_study_dimensions")
    .select("sort_order, treatment_dimensions(name)")
    .eq("study_id", studyId);
  return (data || [])
    .map((r) => ({
      sort: (r.sort_order as number | null) ?? 0,
      name: (r.treatment_dimensions as unknown as { name: string } | null)?.name ?? "",
    }))
    .filter((r) => r.name)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
    .map((r) => r.name);
}

/**
 * Raw privacy-events long-format export: one row per privacy_event (view /
 * field_touch / change / abandon), keyed to the same anonymized ids. This is
 * the dataset for survival models (time-to-first-change), flow-level
 * successful-change analysis, and step-by-step friction funnels.
 */
export async function generateEventsExport(config: ExportConfig): Promise<string> {
  const supabase = await createSupabaseServiceClient();

  const enrollments = await fetchAllRows<{ user_id: string; enrolled_at: string }>((from, to) =>
    supabase
      .from("study_enrollments")
      .select("user_id, enrolled_at")
      .eq("study_id", config.studyId)
      .is("withdrawn_at", null)
      .order("user_id", { ascending: true })
      .range(from, to)
  );

  if (enrollments.length === 0) return "";

  const userIds = enrollments.map((e) => e.user_id);
  const pidByUser = new Map<string, string>();
  const enrolledAtByUser = new Map<string, string>();
  userIds.forEach((uid, i) => pidByUser.set(uid, participantId(i)));
  for (const e of enrollments) enrolledAtByUser.set(e.user_id, e.enrolled_at);

  const dimensionNames = await loadStudyDimensionNames(supabase, config.studyId);

  const events = await fetchAllByIds<{
    user_id: string;
    event_type: string | null;
    page: string | null;
    duration_ms: number | null;
    click_count: number | null;
    session_id: string | null;
    treatment: string | null;
    privacy_default: string | null;
    conditions: unknown;
    metadata: unknown;
    created_at: string;
  }>(userIds, (ids, from, to) =>
    supabase
      .from("privacy_events")
      .select(
        "user_id, event_type, page, duration_ms, click_count, session_id, treatment, privacy_default, conditions, metadata, created_at"
      )
      .in("user_id", ids)
      .order("created_at", { ascending: true })
      .range(from, to)
  );

  const headers = [
    "participant_id",
    "event_at",
    "days_since_enrollment",
    "event_type",
    "page",
    "direction",
    "fields_changed",
    "scope",
    "reversed",
    "index_before",
    "index_after",
    "duration_ms",
    "click_count",
    "session_id",
    ...dimensionNames.map(treatmentHeader),
  ];

  const rows: string[][] = [];
  for (const e of events) {
    const pid = pidByUser.get(e.user_id);
    if (!pid) continue;
    const enrolledAt = enrolledAtByUser.get(e.user_id);
    let days = "";
    if (enrolledAt) {
      const d = (new Date(e.created_at).getTime() - new Date(enrolledAt).getTime()) / 86_400_000;
      if (Number.isFinite(d) && d >= 0) days = d.toFixed(4);
    }
    const meta = (e.metadata || {}) as {
      direction?: string;
      deltas?: unknown[];
      scope?: string;
      reversed?: boolean;
      index_before?: number;
      index_after?: number;
    };
    rows.push([
      pid,
      e.created_at,
      days,
      e.event_type ?? "",
      e.page ?? "",
      meta.direction ?? "",
      Array.isArray(meta.deltas) ? String(meta.deltas.length) : "",
      meta.scope ?? "",
      meta.reversed === undefined ? "" : String(meta.reversed),
      meta.index_before === undefined ? "" : Number(meta.index_before).toFixed(4),
      meta.index_after === undefined ? "" : Number(meta.index_after).toFixed(4),
      e.duration_ms === null || e.duration_ms === undefined ? "" : String(e.duration_ms),
      e.click_count === null || e.click_count === undefined ? "" : String(e.click_count),
      e.session_id ?? "",
      ...conditionValues(dimensionNames, e.conditions as Record<string, unknown> | null, e),
    ]);
  }

  return serialize(headers, rows, config.format);
}
