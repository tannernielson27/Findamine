/**
 * Pure logic for "where do I stand?" leaderboard motivation (B5).
 *
 * Computes the viewer's rank, score, and the gap to the next rank up — from a
 * server-provided summary when available (precise, even outside the visible
 * top-N) or derived from the visible entries as a fallback. Display-only; it
 * reads scores already returned by the privacy-aware leaderboard API and never
 * affects scoring or the A5 name-redaction applied to other players.
 */

export interface StandingEntry {
  user_id: string;
  score: number;
}

/** Server-computed standing (snake_case as returned by the API). */
export interface ServerMe {
  rank: number;
  score: number;
  gap_to_next: number | null;
}

export interface ViewerStanding {
  rank: number;
  score: number;
  /** Points needed to reach the next rank up; null when already #1. */
  gapToNext: number | null;
}

export interface StandingSummary {
  standing: ViewerStanding | null;
  /** True when the viewer appears in the visible entries (highlight in place). */
  inList: boolean;
  /** True when we should pin a separate "your position" row (viewer off-screen). */
  pinned: boolean;
}

export function summarizeViewerStanding(
  entries: StandingEntry[],
  viewerId: string | null | undefined,
  serverMe?: ServerMe | null
): StandingSummary {
  const idx = viewerId ? entries.findIndex((e) => e.user_id === viewerId) : -1;
  const inList = idx >= 0;

  let standing: ViewerStanding | null = null;
  if (serverMe) {
    standing = { rank: serverMe.rank, score: serverMe.score, gapToNext: serverMe.gap_to_next };
  } else if (inList) {
    const gap = idx > 0 ? entries[idx - 1].score - entries[idx].score : null;
    standing = { rank: idx + 1, score: entries[idx].score, gapToNext: gap };
  }

  return { standing, inList, pinned: Boolean(standing) && !inList };
}

/** Short, encouraging caption for a viewer's standing. */
export function standingCaption(standing: ViewerStanding | null): string {
  if (!standing) return "";
  if (standing.rank === 1) return "You're in the lead! 🏆";
  if (standing.gapToNext == null) return `You're #${standing.rank}.`;
  if (standing.gapToNext <= 0) return `You're tied for #${standing.rank}!`;
  const pts = standing.gapToNext === 1 ? "1 point" : `${standing.gapToNext} points`;
  return `${pts} to reach #${standing.rank - 1}`;
}
