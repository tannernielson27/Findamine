/**
 * Re-engagement nudge logic (Workstream B / Task B4).
 *
 * RESEARCH-INTEGRITY GUARDRAIL — READ BEFORE EDITING:
 * Re-engagement nudges MUST be applied UNIFORMLY across all participants and
 * privacy conditions. Differential nudging by condition would confound the
 * experiment. This module enforces that structurally: the decision function
 * takes ONLY engagement signals (inactivity, cooldown, the user's own
 * notification preferences) — it has no access to `privacy_treatment`,
 * `profile_visibility`, or any condition-derived input. Do NOT add a condition
 * parameter or branch on condition here or in the cron that calls it.
 *
 * Pure + deterministic so the uniformity property is unit-testable.
 */

export const REENGAGEMENT_TYPE = "reengagement";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReengagementConfig {
  /** Days of inactivity before a nudge becomes eligible. */
  inactivityDays: number;
  /** Minimum days between nudges to the same participant. */
  cooldownDays: number;
}

export const DEFAULT_REENGAGEMENT_CONFIG: ReengagementConfig = {
  inactivityDays: 3,
  cooldownDays: 4,
};

export interface ParticipantEngagement {
  /** ISO timestamp the participant was last seen (last activity, or enrollment if never active). */
  lastSeenAt: string | null;
  /** ISO timestamp of the most recent re-engagement nudge, if any. */
  lastNudgeAt: string | null;
  /** The participant's own push setting (uniform opt-out, not condition). */
  pushEnabled: boolean;
  /** The participant's own muted notification types. */
  disabledTypes: string[];
}

export type ReengagementReason =
  | "no_baseline"
  | "still_active"
  | "in_cooldown"
  | "opted_out"
  | "eligible";

export interface ReengagementDecision {
  shouldNudge: boolean;
  reason: ReengagementReason;
  daysInactive: number | null;
}

function daysBetween(laterMs: number, earlierIso: string): number {
  return Math.floor((laterMs - new Date(earlierIso).getTime()) / DAY_MS);
}

/**
 * Decide whether to nudge a participant. Deliberately accepts NO condition input.
 */
export function decideReengagement(
  p: ParticipantEngagement,
  nowMs: number,
  config: ReengagementConfig = DEFAULT_REENGAGEMENT_CONFIG
): ReengagementDecision {
  // Respect the participant's own preference — applied identically to everyone.
  if (!p.pushEnabled || p.disabledTypes.includes(REENGAGEMENT_TYPE)) {
    return { shouldNudge: false, reason: "opted_out", daysInactive: null };
  }

  if (!p.lastSeenAt) {
    return { shouldNudge: false, reason: "no_baseline", daysInactive: null };
  }

  const daysInactive = daysBetween(nowMs, p.lastSeenAt);
  if (daysInactive < config.inactivityDays) {
    return { shouldNudge: false, reason: "still_active", daysInactive };
  }

  if (p.lastNudgeAt && daysBetween(nowMs, p.lastNudgeAt) < config.cooldownDays) {
    return { shouldNudge: false, reason: "in_cooldown", daysInactive };
  }

  return { shouldNudge: true, reason: "eligible", daysInactive };
}

export interface ReengagementMessage {
  title: string;
  body: string;
}

/**
 * Pick the nudge copy. Tiered ONLY by how long the participant has been away —
 * never by condition. Same inactivity → same message for every participant.
 */
export function reengagementMessage(daysInactive: number): ReengagementMessage {
  if (daysInactive >= 7) {
    return {
      title: "We miss you on the trail!",
      body: "Your crew is still out exploring. Pick up where you left off and climb the board.",
    };
  }
  return {
    title: "Your next find is waiting",
    body: "Jump back into a hunt — points and badges are up for grabs.",
  };
}
