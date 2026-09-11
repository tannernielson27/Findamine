import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";

/**
 * Mark a survey delivery as opened (the participant started it).
 *
 * `[id]` is the DELIVERY id. Idempotent: only a `pending` delivery transitions to
 * `opened` (stamping `opened_at`); an already-opened or submitted delivery is a
 * no-op. Capturing open-without-submit lets the researcher distinguish
 * never-seen from seen-but-abandoned deliveries.
 */
export async function POST(
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
      .select("id, status")
      .eq("id", deliveryId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!delivery) throw new ApiError(404, "Delivery not found");

    if (delivery.status === "pending") {
      await supabase
        .from("survey_deliveries")
        .update({ status: "opened", opened_at: new Date().toISOString() })
        .eq("id", deliveryId)
        .eq("status", "pending"); // guard against a concurrent submit
    }

    return Response.json({ ok: true, status: delivery.status });
  } catch (error) {
    return errorResponse(error);
  }
}
