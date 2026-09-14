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

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "received";

    const supabase = await createSupabaseServiceClient();

    const column = type === "sent" ? "sender_id" : "receiver_id";
    const { data } = await supabase
      .from("kudos")
      .select("*, sender:users!sender_id(id, display_name, avatar_url, profile_visibility), receiver:users!receiver_id(id, display_name, avatar_url, profile_visibility)")
      .eq(column, user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    const rows = data || [];

    // Enforce profile-field visibility on embedded counterpart users.
    const otherIds = rows.flatMap((r) => {
      const other = (r.sender_id === user.id ? r.receiver : r.sender) as EmbeddedUser | null;
      return other?.id ? [other.id] : [];
    });
    const rels = await getViewerRelationships(user.id, otherIds);

    const applyFilter = (u: EmbeddedUser | null) => {
      if (!u?.id) return u;
      const rel = u.id === user.id ? "self" : rels.get(u.id) ?? "public";
      return { id: u.id, ...filterProfileForViewer(u, rel) };
    };

    const kudos = rows.map((r) => ({
      ...r,
      sender: applyFilter(r.sender as EmbeddedUser | null),
      receiver: applyFilter(r.receiver as EmbeddedUser | null),
    }));

    return Response.json({ kudos });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    blockChildren(user, "kudos");

    const body = await request.json();
    if (!body.receiver_id || !body.message) {
      throw new ApiError(400, "receiver_id and message required");
    }
    if (typeof body.message !== "string" || body.message.length > 1000) {
      throw new ApiError(400, "Message must be a string of 1000 characters or fewer");
    }
    if (body.receiver_id === user.id) {
      throw new ApiError(400, "Cannot send kudos to yourself");
    }

    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from("kudos")
      .insert({
        sender_id: user.id,
        receiver_id: body.receiver_id,
        message_type: body.message_type || "custom",
        message: body.message.slice(0, 1000),
        hunt_id: body.hunt_id || null,
      })
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);

    return Response.json({ kudos: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
