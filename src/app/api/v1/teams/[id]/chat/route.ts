import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { socialLimiter } from "@/lib/utils/rate-limit";
import { filterProfileForViewer } from "@/lib/utils/privacy";

interface ChatSender {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_visibility?: Record<string, string>;
}

/**
 * Chat access is team-gated, so every viewer's relationship to a sender is
 * "team" (or "self"). A member who restricts display_name/avatar beyond team
 * stays hidden even inside the chat.
 */
function filterSender(sender: ChatSender | null, viewerId: string) {
  if (!sender?.id) return sender;
  const rel = sender.id === viewerId ? ("self" as const) : ("team" as const);
  return { id: sender.id, ...filterProfileForViewer(sender, rel) };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    // Verify user is a member of this team
    if (!["admin", "researcher"].includes(user.role)) {
      const { data: membership } = await supabase
        .from("team_members")
        .select("id")
        .eq("team_id", id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!membership) throw new ApiError(403, "Not a member of this team");
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50") || 50, 200);

    const { data, error } = await supabase
      .from("team_messages")
      .select("*, users(id, display_name, avatar_url, profile_visibility)")
      .eq("team_id", id)
      .neq("moderation_status", "removed")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw new ApiError(500, error.message);

    const messages = (data || [])
      .reverse()
      .map((m) => ({ ...m, users: filterSender(m.users as ChatSender | null, user.id) }));

    return Response.json({ messages });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await socialLimiter.check(request);
    const { id } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body = await request.json();
    if (!body.message || body.message.length > 280) {
      throw new ApiError(400, "Message required (max 280 chars)");
    }

    const supabase = await createSupabaseServiceClient();

    // Verify user is a member of this team
    if (!["admin", "researcher"].includes(user.role)) {
      const { data: membership } = await supabase
        .from("team_members")
        .select("id")
        .eq("team_id", id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!membership) throw new ApiError(403, "Not a member of this team");
    }

    const { data: msg, error } = await supabase
      .from("team_messages")
      .insert({ team_id: id, user_id: user.id, message: body.message })
      .select("*, users(id, display_name, avatar_url)")
      .single();

    if (error) throw new ApiError(500, error.message);

    // Sender is the viewer here — no filtering needed on their own message.
    return Response.json({ message: msg }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
