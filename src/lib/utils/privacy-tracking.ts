/**
 * Privacy interaction tracking (Workstream A / Task A3).
 *
 * Pure helpers for classifying privacy-setting changes (tighten/loosen) and
 * computing per-field diffs, plus a fire-and-forget client logger that posts to
 * /api/v1/research/privacy-events. The pure helpers are unit tested; the logger is
 * intentionally side-effecting and never throws.
 */

import { type VisibilityLevel } from "@/lib/utils/privacy";

// Ordinal restrictiveness: higher = more private. Unset is treated as "everyone".
const ORDINAL: Record<VisibilityLevel, number> = {
  everyone: 0,
  class: 1,
  team: 2,
  nobody: 3,
};

export type ChangeDirection = "tighten" | "loosen" | "mixed" | "none";

export interface FieldDelta {
  field: string;
  from: string | null;
  to: string | null;
}

function rank(level: string | null | undefined): number {
  return ORDINAL[level as VisibilityLevel] ?? 0;
}

/** Per-field diff over the union of keys; only fields whose value changed. */
export function diffVisibility(
  oldV: Record<string, string> | undefined,
  newV: Record<string, string> | undefined
): FieldDelta[] {
  const a = oldV || {};
  const b = newV || {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const deltas: FieldDelta[] = [];
  for (const field of keys) {
    const from = a[field] ?? null;
    const to = b[field] ?? null;
    if (from !== to) deltas.push({ field, from, to });
  }
  return deltas;
}

/** Classify a set of field deltas by overall direction. */
export function classifyChange(deltas: FieldDelta[]): ChangeDirection {
  let tighten = false;
  let loosen = false;
  for (const d of deltas) {
    const f = rank(d.from);
    const t = rank(d.to);
    if (t > f) tighten = true;
    else if (t < f) loosen = true;
  }
  if (tighten && loosen) return "mixed";
  if (tighten) return "tighten";
  if (loosen) return "loosen";
  return "none";
}

export interface PrivacyEventPayload {
  event_type: "privacy_change" | "privacy_abandon" | "privacy_view" | "privacy_field_touch";
  page?: string;
  old_value?: unknown;
  new_value?: unknown;
  duration_ms?: number;
  click_count?: number;
  session_id?: string;
  metadata?: Record<string, unknown>;
}

/** Fire-and-forget POST to the privacy-events endpoint. Never throws. */
export async function logPrivacyEvent(payload: PrivacyEventPayload): Promise<void> {
  try {
    await fetch("/api/v1/research/privacy-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true, // survive page unload (abandonment events)
    });
  } catch {
    // never block the UI on telemetry
  }
}
