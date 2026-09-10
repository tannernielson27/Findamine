import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { filterProfileForViewer, type ViewerRelationship } from "@/lib/utils/privacy";
import { getViewerRelationships } from "@/lib/utils/viewer";

interface TeamMemberRow {
  user_id: string;
  users?: { id: string; display_name: string | null; avatar_url: string | null; role?: string; profile_visibility?: Record<string, string> } | null;
  [k: string]: unknown;
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

    const { data, error } = await supabase
      .from("teams")
      .select("*, team_members(*, users(id, display_name, avatar_url, role, profile_visibility))")
      .eq("id", id)
      .single();

    if (error || !data) throw new ApiError(404, "Team not found");

    // Admins/researchers can view any team; others must be a member or
    // the creator of the hunt this team belongs to
    const isStaff = ["admin", "researcher"].includes(user.role);
    if (!isStaff) {
      const isMember = data.team_members?.some(
        (m: { user_id: string }) => m.user_id === user.id
      );
      if (!isMember) {
        // Check if user owns the hunt
        const { data: hunt } = await supabase
          .from("hunts")
          .select("created_by")
          .eq("id", data.hunt_id)
          .single();
        if (!hunt || hunt.created_by !== user.id) {
          throw new ApiError(403, "Not authorized to view this team");
        }
      }

      // Enforce each member's display_name/avatar visibility for this viewer
      // (a teammate who set them to "nobody" must stay hidden). Staff see raw.
      const members = (data.team_members || []) as TeamMemberRow[];
      const rels = await getViewerRelationships(user.id, members.map((m) => m.user_id));
      data.team_members = members.map((m) => {
        const u = m.users;
        if (!u?.id) return m;
        const rel: ViewerRelationship = u.id === user.id ? "self" : rels.get(u.id) ?? "public";
        return { ...m, users: { id: u.id, role: u.role, ...filterProfileForViewer(u, rel) } };
      });
    }

    return Response.json({ team: data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body = await request.json();
    const supabase = await createSupabaseServiceClient();

    // Verify ownership: must be team member, hunt owner, or admin
    const { data: team } = await supabase
      .from("teams")
      .select("hunt_id, team_members(user_id)")
      .eq("id", id)
      .single();

    if (!team) throw new ApiError(404, "Team not found");

    const isMember = (team.team_members as { user_id: string }[])?.some((m) => m.user_id === user.id);
    if (!isMember && !["admin", "researcher"].includes(user.role)) {
      const { data: hunt } = await supabase.from("hunts").select("created_by").eq("id", team.hunt_id).single();
      if (!hunt || hunt.created_by !== user.id) {
        throw new ApiError(403, "Not authorized to update this team");
      }
    }

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = String(body.name).slice(0, 100);
    if (body.status !== undefined) {
      const validStatuses = ["forming", "ready", "active", "completed", "disbanded"];
      if (!validStatuses.includes(body.status)) throw new ApiError(400, "Invalid status");
      updates.status = body.status;
    }
    if (body.max_size !== undefined) updates.max_size = Math.max(2, Math.min(20, parseInt(body.max_size) || 6));

    const { data, error } = await supabase
      .from("teams")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);

    return Response.json({ team: data });
  } catch (error) {
    return errorResponse(error);
  }
}
