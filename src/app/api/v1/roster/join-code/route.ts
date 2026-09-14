import { NextRequest } from "next/server";
import { randomInt } from "crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";

/** Short, human-shareable class code from an unambiguous alphabet (no 0/O/1/I). */
function generateClassCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[randomInt(0, alphabet.length)];
  return code;
}

/**
 * Generate (or rotate) a roster's class join code. Teacher-owned rosters only.
 * Returns the existing code unless `rotate: true` is passed.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "admin");

    const body = await request.json();
    const rosterId = body.roster_id;
    if (!rosterId) throw new ApiError(400, "roster_id required");

    const supabase = await createSupabaseServiceClient();

    const { data: roster } = await supabase
      .from("rosters")
      .select("id, teacher_id, join_code")
      .eq("id", rosterId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!roster) throw new ApiError(404, "Roster not found");
    if (roster.teacher_id !== user.id && user.role !== "admin") {
      throw new ApiError(403, "Not your roster");
    }

    if (roster.join_code && !body.rotate) {
      return Response.json({ join_code: roster.join_code });
    }

    // Retry on the rare unique-collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateClassCode();
      const { data, error } = await supabase
        .from("rosters")
        .update({ join_code: code })
        .eq("id", rosterId)
        .select("join_code")
        .single();
      if (!error && data) return Response.json({ join_code: data.join_code });
      if (error?.code !== "23505") throw new ApiError(500, error?.message || "Failed to set code");
    }
    throw new ApiError(500, "Could not generate a unique code");
  } catch (error) {
    return errorResponse(error);
  }
}
