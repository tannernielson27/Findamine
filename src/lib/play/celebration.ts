/**
 * Pure logic for play-loop reward moments.
 *
 * Maps a graded answer result to a celebration *presentation* (headline, tone,
 * confetti intensity, and the points to surface immediately). This is display
 * logic only — it never changes scoring, points, or any logged research event.
 * Kept pure and deterministic so it is unit-testable in the node test env.
 */

export type CelebrationTone = "perfect" | "success" | "partial" | "effort";
export type CelebrationIntensity = "high" | "medium" | "low";

export interface AnswerResultLike {
  /** Scoring feedback type from the answer API: "correct" | "partial" | anything else = miss. */
  feedbackType: string;
  /** Points earned on this stop (already computed server-side). */
  score: number;
  /** 1-based attempt number this answer landed on. */
  attempt?: number;
  /** Scoring breakdown; only `hintPenalty` is read, to detect a clean (no-hint) solve. */
  breakdown?: { hintPenalty?: number } | null;
}

export interface CelebrationPresentation {
  tone: CelebrationTone;
  intensity: CelebrationIntensity;
  /** Primary celebratory line. */
  headline: string;
  /** Points to show in the celebration, or null when scores are hidden. */
  points: number | null;
}

// Deterministic message pools keyed by tone. We pick by `score` (not random) so
// the same result always celebrates the same way — stable for tests and avoids
// jarring re-rolls if a component re-renders.
const HEADLINES: Record<CelebrationTone, readonly string[]> = {
  perfect: ["Perfect — first try!", "Flawless! Nailed it cold.", "Bullseye on the first shot!"],
  success: ["You got it!", "Nice find!", "Solved it!", "That's the one!"],
  partial: ["So close — partial credit!", "Almost! Points banked.", "Good thinking — partway there!"],
  effort: ["Good effort — every try counts.", "Nice perseverance! On to the next.", "That was a tricky one — keep going."],
};

function pick(pool: readonly string[], seed: number): string {
  const idx = Math.abs(Math.trunc(seed)) % pool.length;
  return pool[idx];
}

/**
 * Decide how to celebrate a completed stop.
 *
 * @param result   graded answer result (from the answer API response)
 * @param hideScores  when true (anxiety-sensitive hunts) points are not surfaced
 */
export function celebrationForResult(
  result: AnswerResultLike,
  hideScores = false
): CelebrationPresentation {
  const { feedbackType, score } = result;
  const attempt = result.attempt ?? 1;
  const usedHints = (result.breakdown?.hintPenalty ?? 0) > 0;

  let tone: CelebrationTone;
  let intensity: CelebrationIntensity;

  if (feedbackType === "correct") {
    const clean = attempt <= 1 && !usedHints;
    tone = clean ? "perfect" : "success";
    intensity = clean ? "high" : "medium";
  } else if (feedbackType === "partial") {
    tone = "partial";
    intensity = "medium";
  } else {
    tone = "effort";
    intensity = "low";
  }

  return {
    tone,
    intensity,
    headline: pick(HEADLINES[tone], score),
    points: hideScores ? null : score,
  };
}

/** Celebration shown the moment a player reaches the GPS location. */
export function arrivalCelebration(): CelebrationPresentation {
  return { tone: "success", intensity: "medium", headline: "You found it!", points: null };
}
