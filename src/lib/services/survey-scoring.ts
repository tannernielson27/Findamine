/**
 * Survey Scoring Engine
 *
 * Computes subscale scores from validated survey instruments.
 * Supports: Likert scales, reverse-coded items, weighted subscales.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";

export interface SubscaleScore {
  subscale: string;
  score: number;
  itemCount: number;
  items: { itemCode: string; rawValue: number; scoredValue: number }[];
}

/** A survey question's scoring config (DB-shape subset needed for scoring). */
export interface ScorableQuestion {
  item_code: string;
  question_type: string | null;
  scale_config: Record<string, number> | null;
  reverse_coded: boolean | null;
  subscale: string | null;
}

/** Question types whose answers are numeric and belong in a subscale mean. */
export const SCORABLE_QUESTION_TYPES = new Set(["likert_5", "likert_7", "slider"]);

/** Whether a question's answers should enter Likert-style subscale means. */
export function isScorableQuestionType(questionType: string | null | undefined): boolean {
  // Legacy rows may have no type; treat them as Likert (historical behavior).
  if (!questionType) return true;
  return SCORABLE_QUESTION_TYPES.has(questionType);
}

/**
 * Pure survey scoring: group by subscale, apply reverse coding, average each
 * subscale. Extracted from the DB wrapper so the validity-critical math (a
 * classic source of ruined survey data when reverse coding is wrong) is
 * unit-testable without a database.
 *
 * Choice and free-text items (e.g. the `ideal_audience` block, migration 058)
 * are skipped so they can never contaminate a subscale mean.
 */
export function scoreAnswers(
  questions: ScorableQuestion[],
  answers: Record<string, number | string>
): SubscaleScore[] {
  // Group questions by subscale
  const subscales = new Map<string, ScorableQuestion[]>();
  for (const q of questions) {
    if (!isScorableQuestionType(q.question_type)) continue;
    const sub = q.subscale || "general";
    if (!subscales.has(sub)) subscales.set(sub, []);
    subscales.get(sub)!.push(q);
  }

  const results: SubscaleScore[] = [];

  for (const [subscale, items] of subscales) {
    const scoredItems: SubscaleScore["items"] = [];

    for (const item of items) {
      const rawValue = answers[item.item_code];
      if (rawValue === undefined || rawValue === null) continue;

      const numValue = typeof rawValue === "number" ? rawValue : parseFloat(String(rawValue));
      if (isNaN(numValue)) continue;

      // Handle reverse coding
      let scoredValue = numValue;
      if (item.reverse_coded) {
        const scaleConfig = item.scale_config as Record<string, number> | null;
        const maxScale = scaleConfig?.max || (item.question_type === "likert_7" ? 7 : 5);
        scoredValue = maxScale + 1 - numValue;
      }

      scoredItems.push({
        itemCode: item.item_code,
        rawValue: numValue,
        scoredValue,
      });
    }

    if (scoredItems.length === 0) continue;

    // Compute mean score for subscale
    const totalScore = scoredItems.reduce((sum, i) => sum + i.scoredValue, 0);
    const meanScore = totalScore / scoredItems.length;

    results.push({
      subscale,
      score: Math.round(meanScore * 100) / 100,
      itemCount: scoredItems.length,
      items: scoredItems,
    });
  }

  return results;
}

/**
 * Compute scored values for a survey response (DB wrapper around scoreAnswers).
 */
export async function scoreSurveyResponse(
  surveyId: string,
  userId: string,
  deliveryId: string
): Promise<SubscaleScore[]> {
  const supabase = await createSupabaseServiceClient();

  // Get survey questions with scoring config
  const { data: questions } = await supabase
    .from("survey_questions")
    .select("item_code, question_type, scale_config, reverse_coded, subscale, sort_order")
    .eq("survey_id", surveyId)
    .order("sort_order");

  if (!questions || questions.length === 0) return [];

  // Get user's response
  const { data: response } = await supabase
    .from("survey_responses")
    .select("answers")
    .eq("delivery_id", deliveryId)
    .eq("user_id", userId)
    .single();

  if (!response?.answers) return [];

  const answers = response.answers as Record<string, number | string>;
  return scoreAnswers(questions as ScorableQuestion[], answers);
}
