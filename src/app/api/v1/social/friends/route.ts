import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, blockChildren, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { socialLimiter } from "@/lib/utils/rate-limit";
import { filterProfileForViewer } from "@/lib/utils/privacy";
import { getViewerRelationships } from "@/lib/utils/viewer";

type EmbeddedUser = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_visibility?: Record<string, string>;
};

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "accepted";

    const supabase = await createSupabaseServiceClient();

    const { data } = await supabase
      .from("friend_connections")
      .select("*, requester:users!requester_id(id, display_name, avatar_url, profile_visibility), addressee:users!addressee_id(id, display_name, avatar_url, profile_visibility)")
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .eq("status", status)
      .order("created_at", { ascending: false });

    const rows = data || [];

    // Enforce profile-field visibility on the embedded "other" user of each row.
    const otherIds = rows.flatMap((r) => {
      const other = (r.requester_id === user.id ? r.addressee : r.requester) as EmbeddedUser | null;
      return other?.id ? [other.id] : [];
    });
    const rels = await getViewerRelationships(user.id, otherIds);

    const applyFilter = (u: EmbeddedUser | null) => {
      if (!u?.id) return u;
      const rel = u.id === user.id ? "self" : rels.get(u.id) ?? "public";
      return { id: u.id, ...filterProfileForViewer(u, rel) };
    };

    const friends = rows.map((r) => ({
      ...r,
      requester: applyFilter(r.requester as EmbeddedUser | null),
      addressee: applyFilter(r.addressee as EmbeddedUser | null),
    }));

    return Response.json({ friends });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await socialLimiter.check(request);
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    blockChildren(user, "friend requests");

    const body = await request.json();
    if (!body.addressee_id) throw new ApiError(400, "addressee_id required");
    if (body.addressee_id === user.id) throw new ApiError(400, "Cannot friend yourself");

    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from("friend_connections")
      .insert({ requester_id: user.id, addressee_id: body.addressee_id })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") throw new ApiError(409, "Friend request already exists");
      throw new ApiError(500, error.message);
    }

    return Response.json({ connection: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
