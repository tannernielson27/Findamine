import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";

/**
 * Manage a survey's questions in the normalized `survey_questions` table.
 *
 * `[id]` is the SURVEY id (matching the admin GET/PUT on /surveys/[id]). This is
 * the single source of truth for question content: the participant take-page and
 * the scoring engine both read `survey_questions`, so authoring here (rather than
 * the legacy `surveys.questions` JSONB) is what makes an authored survey actually
 * render and score. Admin/researcher only.
 */

const ALLOWED_TYPES = [
  "likert_5",
  "likert_7",
  "multiple_choice",
  "free_text",
  "slider",
  "ranking",
  "matrix",
];

interface IncomingQuestion {
  item_code?: unknown;
  question_text?: unknown;
  question_type?: unknown;
  subscale?: unknown;
  reverse_coded?: unknown;
  required?: unknown;
  scale_config?: unknown;
  options?: unknown;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: surveyId } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "admin", "researcher");

    const supabase = await createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("survey_questions")
      .select(
        "id, item_code, question_text, question_type, options, scale_config, reverse_coded, subscale, sort_order, required"
      )
      .eq("survey_id", surveyId)
      .order("sort_order");

    if (error) throw new ApiError(500, error.message);
    return Response.json({ questions: data || [] });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Replace the full question set for a survey (the editor saves the whole form).
 * Validates every item, then swaps atomically-ish: delete existing, insert new.
 * `sort_order` is assigned from array position, so the editor controls order.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: surveyId } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "admin", "researcher");

    const body = await request.json();
    const incoming: IncomingQuestion[] = Array.isArray(body.questions) ? body.questions : [];

    const seen = new Set<string>();
    const rows = incoming.map((q, i) => {
      const itemCode = String(q.item_code ?? "").trim();
      const questionText = String(q.question_text ?? "").trim();
      const questionType = String(q.question_type ?? "");

      if (!itemCode) throw new ApiError(400, `Question ${i + 1}: item_code is required`);
      if (!/^[a-zA-Z0-9_]+$/.test(itemCode)) {
        throw new ApiError(400, `Question ${i + 1}: item_code must be letters, numbers, or underscores`);
      }
      if (seen.has(itemCode)) throw new ApiError(400, `Duplicate item_code "${itemCode}"`);
      seen.add(itemCode);
      if (!questionText) throw new ApiError(400, `Question ${i + 1}: question_text is required`);
      if (!ALLOWED_TYPES.includes(questionType)) {
        throw new ApiError(400, `Question ${i + 1}: invalid question_type "${questionType}"`);
      }

      return {
        survey_id: surveyId,
        item_code: itemCode,
        question_text: questionText,
        question_type: questionType,
        options: Array.isArray(q.options) ? q.options : [],
        scale_config:
          q.scale_config && typeof q.scale_config === "object" ? q.scale_config : {},
        reverse_coded: Boolean(q.reverse_coded),
        subscale: q.subscale ? String(q.subscale).trim() : null,
        sort_order: i,
        required: q.required === undefined ? true : Boolean(q.required),
      };
    });

    const supabase = await createSupabaseServiceClient();

    // Verify the survey exists before mutating.
    const { data: survey } = await supabase
      .from("surveys")
      .select("id")
      .eq("id", surveyId)
      .maybeSingle();
    if (!survey) throw new ApiError(404, "Survey not found");

    const { error: delError } = await supabase
      .from("survey_questions")
      .delete()
      .eq("survey_id", surveyId);
    if (delError) throw new ApiError(500, delError.message);

    if (rows.length > 0) {
      const { error: insError } = await supabase.from("survey_questions").insert(rows);
      if (insError) throw new ApiError(500, insError.message);
    }

    return Response.json({ ok: true, count: rows.length });
  } catch (error) {
    return errorResponse(error);
  }
}
