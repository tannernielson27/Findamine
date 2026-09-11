import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const { searchParams } = new URL(request.url);
    const pending = searchParams.get("pending");

    const supabase = await createSupabaseServiceClient();

    if (pending === "true") {
      // A participant's "to-do" list: not-yet-submitted deliveries. Include
      // `opened` (started but not finished) alongside `pending` so a survey the
      // user began doesn't silently vanish from their list.
      const { data } = await supabase
        .from("survey_deliveries")
        .select("*, surveys(id, title, description, status)")
        .eq("user_id", user.id)
        .in("status", ["pending", "opened"])
        .order("created_at");
      return Response.json({ deliveries: data || [] });
    }

    // Admin/researcher: list all surveys with question counts + schedule info so
    // the authoring UI can show what's ready to activate at a glance.
    if (["admin", "researcher", "teacher"].includes(user.role)) {
      const { data } = await supabase
        .from("surveys")
        .select(
          "*, survey_questions(count), survey_schedules(trigger_type, trigger_config, active)"
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      return Response.json({ surveys: data || [] });
    }

    throw new ApiError(403, "Forbidden");
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "admin", "researcher");

    const body = await request.json();
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from("surveys")
      .insert({
        title: body.title,
        description: body.description || null,
        questions: body.questions || [],
        target_roles: body.target_roles || [],
        created_by: user.id,
      })
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);
    return Response.json({ survey: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
