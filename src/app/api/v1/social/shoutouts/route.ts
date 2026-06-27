import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, blockChildren, errorResponse, ApiError } from "@/lib/utils/api-auth";
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

    const supabase = await createSupabaseServiceClient();

    const { data } = await supabase
      .from("shoutouts")
      .select("*, sender:users!sender_id(id, display_name, avatar_url, profile_visibility), receiver:users!receiver_id(id, display_name, avatar_url, profile_visibility)")
      .eq("receiver_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    const rows = data || [];

    // receiver is always the viewer; filter the embedded sender by relationship.
    const senderIds = rows.flatMap((r) => {
      const s = r.sender as EmbeddedUser | null;
      return s?.id ? [s.id] : [];
    });
    const rels = await getViewerRelationships(user.id, senderIds);

    const applyFilter = (u: EmbeddedUser | null) => {
      if (!u?.id) return u;
      const rel = u.id === user.id ? "self" : rels.get(u.id) ?? "public";
      return { id: u.id, ...filterProfileForViewer(u, rel) };
    };

    const shoutouts = rows.map((r) => ({
      ...r,
      sender: applyFilter(r.sender as EmbeddedUser | null),
      receiver: applyFilter(r.receiver as EmbeddedUser | null),
    }));

    return Response.json({ shoutouts });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    blockChildren(user, "shoutouts");

    const body = await request.json();
    if (!body.receiver_id) throw new ApiError(400, "receiver_id required");
    if (!body.message || typeof body.message !== "string") throw new ApiError(400, "message required");
    if (body.message.length > 1000) throw new ApiError(400, "Message must be 1000 characters or fewer");
    if (body.receiver_id === user.id) throw new ApiError(400, "Cannot send a shoutout to yourself");

    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from("shoutouts")
      .insert({
        sender_id: user.id,
        receiver_id: body.receiver_id,
        message: body.message.slice(0, 1000),
        hunt_id: body.hunt_id || null,
      })
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);

    return Response.json({ shoutout: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
