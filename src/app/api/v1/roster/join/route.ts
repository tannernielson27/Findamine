import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";

/**
 * Student self-enroll into a class by join code. Any authenticated user can join;
 * this creates the roster_entry (and thus the "class" viewer relationship). Study
 * enrollment/randomization is separate (per-user, on load, gated on consent).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body = await request.json();
    const code = String(body.code || "").trim().toUpperCase();
    if (!code) throw new ApiError(400, "code required");

    const supabase = await createSupabaseServiceClient();

    const { data: roster } = await supabase
      .from("rosters")
      .select("id, name")
      .eq("join_code", code)
      .is("deleted_at", null)
      .maybeSingle();
    if (!roster) throw new ApiError(404, "That class code isn't valid");

    const { error } = await supabase
      .from("roster_entries")
      .upsert(
        { roster_id: roster.id, student_id: user.id },
        { onConflict: "roster_id,student_id", ignoreDuplicates: true }
      );
    if (error) throw new ApiError(500, "Could not join the class");

    return Response.json({ ok: true, roster: { id: roster.id, name: roster.name } });
  } catch (error) {
    return errorResponse(error);
  }
}
