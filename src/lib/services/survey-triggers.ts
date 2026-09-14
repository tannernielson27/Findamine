/**
 * Survey schedule matching — pure core (Workstream B / Task B2).
 *
 * Everything here is side-effect free so the event/time matching and the
 * per-survey dedupe can be unit tested without a database. `survey-delivery.ts`
 * wraps these with the Supabase reads/writes.
 *
 * Schedule shapes (survey_schedules.trigger_config):
 *   time:  { timepoint, offset_days, expires_days, fallback? }
 *   event: { timepoint, event, expires_days }
 *
 * A survey may have BOTH an event schedule and a time fallback (T1 does, so a
 * participant who never opens the privacy page still gets the baseline). Dedupe
 * is therefore keyed on survey_id, never on schedule id: at most one delivery
 * per survey per user, whichever path fires first.
 */

export const DAY_MS = 24 * 3_600_000;
const DEFAULT_EXPIRES_DAYS = 7;

/** Client-triggerable events. Anything else is rejected by the trigger endpoint. */
export const ALLOWED_TRIGGER_EVENTS = ["privacy_view"] as const;
export type TriggerEvent = (typeof ALLOWED_TRIGGER_EVENTS)[number];

export function isAllowedTriggerEvent(value: unknown): value is TriggerEvent {
  return typeof value === "string" && (ALLOWED_TRIGGER_EVENTS as readonly string[]).includes(value);
}

/** Raw row shape as selected from survey_schedules (+ joined surveys.status). */
export interface ScheduleRow {
  survey_id: string;
  trigger_type: string;
  trigger_config: unknown;
  surveys?: { status: string } | { status: string }[] | null;
}

export interface NormalizedSchedule {
  survey_id: string;
  trigger_type: "time" | "event" | "completion" | "manual";
  timepoint: string | null;
  event: string | null;
  offset_days: number;
  expires_days: number;
  fallback: boolean;
}

function surveyStatus(row: ScheduleRow): string | null {
  const s = row.surveys;
  if (!s) return null;
  return Array.isArray(s) ? (s[0]?.status ?? null) : s.status;
}

/**
 * Normalize schedule rows, keeping only those whose survey is ACTIVE (draft
 * instruments never reach participants). Tolerates malformed trigger_config.
 */
export function normalizeSchedules(rows: ScheduleRow[]): NormalizedSchedule[] {
  const out: NormalizedSchedule[] = [];
  for (const row of rows) {
    if (surveyStatus(row) !== "active") continue;
    const cfg = (row.trigger_config && typeof row.trigger_config === "object"
      ? row.trigger_config
      : {}) as Record<string, unknown>;
    const type = row.trigger_type;
    if (type !== "time" && type !== "event" && type !== "completion" && type !== "manual") continue;
    out.push({
      survey_id: row.survey_id,
      trigger_type: type,
      timepoint: typeof cfg.timepoint === "string" ? cfg.timepoint : null,
      event: typeof cfg.event === "string" ? cfg.event : null,
      offset_days: typeof cfg.offset_days === "number" ? cfg.offset_days : 0,
      expires_days: typeof cfg.expires_days === "number" ? cfg.expires_days : DEFAULT_EXPIRES_DAYS,
      fallback: cfg.fallback === true,
    });
  }
  return out;
}

/** Event schedules whose configured event equals `eventName`. */
export function matchEventSchedules(
  schedules: NormalizedSchedule[],
  eventName: string
): NormalizedSchedule[] {
  return schedules.filter((s) => s.trigger_type === "event" && s.event === eventName);
}

/** Time schedules whose offset has elapsed for a participant `ageDays` into the study. */
export function matchDueTimeSchedules(
  schedules: NormalizedSchedule[],
  ageDays: number
): NormalizedSchedule[] {
  return schedules.filter((s) => s.trigger_type === "time" && ageDays >= s.offset_days);
}

/**
 * Drop schedules whose survey already has ANY delivery for this user (any
 * status — a submitted or expired T1 must not be re-issued), and collapse
 * duplicates within the batch so two schedules for one survey yield one row.
 */
export function dedupeBySurvey(
  schedules: NormalizedSchedule[],
  existingSurveyIds: Iterable<string>
): NormalizedSchedule[] {
  const seen = new Set(existingSurveyIds);
  const out: NormalizedSchedule[] = [];
  for (const s of schedules) {
    if (seen.has(s.survey_id)) continue;
    seen.add(s.survey_id);
    out.push(s);
  }
  return out;
}

export interface DeliveryInsert {
  survey_id: string;
  user_id: string;
  status: "pending";
  expires_at: string;
}

/** Rows to insert into survey_deliveries for the given schedules. */
export function buildDeliveryRows(
  schedules: NormalizedSchedule[],
  userId: string,
  nowMs: number
): DeliveryInsert[] {
  return schedules.map((s) => ({
    survey_id: s.survey_id,
    user_id: userId,
    status: "pending",
    expires_at: new Date(nowMs + s.expires_days * DAY_MS).toISOString(),
  }));
}

/** Timepoint label (e.g. "T1") for a survey, from any of its schedules. */
export function timepointForSurvey(
  schedules: NormalizedSchedule[],
  surveyId: string
): string | null {
  return schedules.find((s) => s.survey_id === surveyId && s.timepoint)?.timepoint ?? null;
}

export interface DeliveryStatusRow {
  id: string;
  survey_id: string;
  status: string;
  expires_at: string | null;
}

export interface PendingDelivery {
  delivery_id: string;
  survey_id: string;
  timepoint: string | null;
}

/**
 * A participant's still-answerable deliveries for the given surveys: status
 * pending/opened and not past expires_at. This is what the privacy-page gate
 * keys on, so it must be false for submitted, expired and abandoned deliveries.
 */
export function selectPendingDeliveries(
  deliveries: DeliveryStatusRow[],
  surveyIds: Iterable<string>,
  schedules: NormalizedSchedule[],
  nowMs: number
): PendingDelivery[] {
  const wanted = new Set(surveyIds);
  return deliveries
    .filter((d) => wanted.has(d.survey_id))
    .filter((d) => d.status === "pending" || d.status === "opened")
    .filter((d) => !d.expires_at || new Date(d.expires_at).getTime() > nowMs)
    .map((d) => ({
      delivery_id: d.id,
      survey_id: d.survey_id,
      timepoint: timepointForSurvey(schedules, d.survey_id),
    }));
}
