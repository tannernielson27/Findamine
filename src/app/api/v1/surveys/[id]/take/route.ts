import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";

/**
 * Load a survey delivery for the participant to take.
 *
 * `[id]` is the DELIVERY id (matching the sibling /respond route, not the survey
 * id used by the admin GET on /surveys/[id]). Returns the delivery, its survey,
 * and the survey's questions from the normalized `survey_questions` table —
 * the same source the scoring engine reads, so what a participant answers is
 * exactly what gets scored. Owner-only; no side effects (marking a delivery
 * `opened` is a separate POST /open so a prefetch/refresh never mutates state).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: deliveryId } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    const { data: delivery } = await supabase
      .from("survey_deliveries")
      .select("id, status, survey_id, expires_at, opened_at, surveys(id, title, description, status)")
      .eq("id", deliveryId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!delivery) throw new ApiError(404, "Delivery not found");

    const { data: questions } = await supabase
      .from("survey_questions")
      .select(
        "item_code, question_text, question_type, options, scale_config, subscale, sort_order, required"
      )
      .eq("survey_id", delivery.survey_id)
      .order("sort_order");

    return Response.json({
      delivery: {
        id: delivery.id,
        status: delivery.status,
        survey_id: delivery.survey_id,
        expires_at: delivery.expires_at,
        opened_at: delivery.opened_at,
      },
      survey: delivery.surveys,
      questions: questions || [],
    });
  } catch (error) {
    return errorResponse(error);
  }
}
