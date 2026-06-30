import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, blockChildren, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { socialLimiter } from "@/lib/utils/rate-limit";
import { filterProfileForViewer } from "@/lib/utils/privacy";

type EmbeddedUser = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_visibility?: Record<string, string>;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get("team_id");
    if (!teamId) throw new ApiError(400, "team_id required");

    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    const { data } = await supabase
      .from("wall_posts")
      .select("*, users(id, display_name, avatar_url, profile_visibility)")
      .eq("team_id", teamId)
      .neq("moderation_status", "removed")
      .order("created_at", { ascending: false })
      .limit(50);

    // Wall is team-scoped: authors are teammates, so the viewer relationship is
    // "team" (or "self"). Honors fields set to "nobody". Anonymous posts already
    // hide identity client-side via is_anonymous; filtering is layered, not replaced.
    const posts = (data || []).map((r) => {
      const author = r.users as EmbeddedUser | null;
      if (!author?.id) return r;
      const rel = author.id === user.id ? "self" : "team";
      return { ...r, users: { id: author.id, ...filterProfileForViewer(author, rel) } };
    });

    return Response.json({ posts });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await socialLimiter.check(request);
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    blockChildren(user, "wall posts");

    const body = await request.json();
    if (!body.team_id || !body.content) {
      throw new ApiError(400, "team_id and content required");
    }
    if (typeof body.content !== "string" || body.content.length > 2000) {
      throw new ApiError(400, "Content must be a string of 2000 characters or fewer");
    }

    const supabase = await createSupabaseServiceClient();

    // Verify user is a member of this team
    const { data: membership } = await supabase
      .from("team_members")
      .select("id")
      .eq("team_id", body.team_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      throw new ApiError(403, "You must be a member of this team to post");
    }

    const { data, error } = await supabase
      .from("wall_posts")
      .insert({
        team_id: body.team_id,
        user_id: user.id,
        post_type: body.post_type || "general",
        content: body.content.slice(0, 2000),
        is_anonymous: body.is_anonymous || false,
      })
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);

    return Response.json({ post: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
