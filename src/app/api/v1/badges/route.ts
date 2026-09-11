import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { canViewField } from "@/lib/utils/privacy";
import { getViewerRelationship } from "@/lib/utils/viewer";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");
    const types = searchParams.get("types");

    const supabase = await createSupabaseServiceClient();

    // List badge types
    if (types === "true") {
      const { data } = await supabase
        .from("badge_types")
        .select("*")
        .order("name");

      return Response.json({ badge_types: data || [] });
    }

    // User's badges
    const auth = await getAuthUser(request);
    const targetUserId = userId || auth?.id;
    if (!targetUserId) throw new ApiError(401, "Not authenticated");

    // Enforce the `badges` visibility field when viewing someone else's badges.
    // A restricted user's badges are hidden from viewers who lack permission
    // (returns an empty list rather than 403 so the profile UI degrades cleanly).
    if (targetUserId !== auth?.id) {
      const { data: target } = await supabase
        .from("users")
        .select("profile_visibility")
        .eq("id", targetUserId)
        .maybeSingle();
      const rel = auth ? await getViewerRelationship(auth.id, targetUserId) : "public";
      if (!canViewField(target?.profile_visibility as Record<string, string> | undefined, rel, "badges")) {
        return Response.json({ badges: [] });
      }
    }

    const { data } = await supabase
      .from("user_badges")
      .select("*, badge_types(*)")
      .eq("user_id", targetUserId)
      .order("earned_at", { ascending: false });

    return Response.json({ badges: data || [] });
  } catch (error) {
    return errorResponse(error);
  }
}
