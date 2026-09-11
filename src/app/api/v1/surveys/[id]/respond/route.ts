import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { findInvalidChoiceAnswers } from "@/lib/services/survey-answers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: deliveryId } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body = await request.json();
    const supabase = await createSupabaseServiceClient();

    // Get delivery
    const { data: delivery } = await supabase
      .from("survey_deliveries")
      .select("survey_id, status")
      .eq("id", deliveryId)
      .eq("user_id", user.id)
      .single();

    if (!delivery) throw new ApiError(404, "Delivery not found");
    if (delivery.status === "submitted") throw new ApiError(409, "Already submitted");

    const answers = (body.answers && typeof body.answers === "object" ? body.answers : {}) as Record<
      string,
      unknown
    >;

    // Choice items must carry one of their configured option values; a bad
    // value would otherwise be silently stored and skipped at analysis time.
    const { data: choiceQuestions } = await supabase
      .from("survey_questions")
      .select("item_code, options")
      .eq("survey_id", delivery.survey_id)
      .eq("question_type", "multiple_choice");
    const invalid = findInvalidChoiceAnswers(choiceQuestions || [], answers);
    if (invalid.length > 0) {
      throw new ApiError(400, `Invalid answer for: ${invalid.join(", ")}`);
    }

    // Save response
    const { data: response, error } = await supabase
      .from("survey_responses")
      .insert({
        delivery_id: deliveryId,
        survey_id: delivery.survey_id,
        user_id: user.id,
        answers,
      })
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);

    // Mark delivery as submitted
    await supabase
      .from("survey_deliveries")
      .update({ status: "submitted", submitted_at: new Date().toISOString() })
      .eq("id", deliveryId);

    return Response.json({ response }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
