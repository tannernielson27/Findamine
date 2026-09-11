import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { filterProfileForViewer, type ViewerRelationship } from "@/lib/utils/privacy";
import { getViewerRelationships } from "@/lib/utils/viewer";

type EmbeddedUser = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_visibility?: Record<string, string>;
};

// Filter the embedded `users` on each team_member of a team object.
function filterTeamMembers(team: unknown, relFor: (userId: string) => ViewerRelationship) {
  const t = team as { team_members?: Array<{ user_id: string; users: EmbeddedUser | null }> } | null;
  if (!t?.team_members) return team;
  return {
    ...t,
    team_members: t.team_members.map((m) => {
      const u = m.users;
      if (!u?.id) return m;
      return { ...m, users: { id: u.id, ...filterProfileForViewer(u, relFor(u.id)) } };
    }),
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const huntId = searchParams.get("hunt_id");
    const mine = searchParams.get("mine");

    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    if (mine === "true") {
      const { data } = await supabase
        .from("team_members")
        .select("team_id, role, teams(*, team_members(user_id, role, users(id, display_name, avatar_url, profile_visibility)))")
        .eq("user_id", user.id)
        .eq("status", "active");

      // These are the viewer's own teams → all members are teammates (or self).
      const relFor = (id: string): ViewerRelationship => (id === user.id ? "self" : "team");
      const teams = (data || []).map((d: { teams: unknown }) => filterTeamMembers(d.teams, relFor));
      return Response.json({ teams });
    }

    if (huntId) {
      const { data } = await supabase
        .from("teams")
        .select("*, team_members(user_id, role, users(id, display_name, avatar_url, profile_visibility))")
        .eq("hunt_id", huntId)
        .order("created_at");

      // Respect each member's display_name/avatar visibility for this viewer,
      // just like the mine=true branch (previously this branch leaked both).
      const memberIds = (data || []).flatMap(
        (t: { team_members?: Array<{ user_id: string }> }) =>
          (t.team_members || []).map((m) => m.user_id)
      );
      const rels = await getViewerRelationships(user.id, memberIds);
      const relFor = (id: string): ViewerRelationship =>
        id === user.id ? "self" : rels.get(id) ?? "public";
      const teams = (data || []).map((t) => filterTeamMembers(t, relFor));

      return Response.json({ teams });
    }

    throw new ApiError(400, "Provide hunt_id or mine=true");
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body = await request.json();
    if (!body.hunt_id) throw new ApiError(400, "hunt_id is required");

    const supabase = await createSupabaseServiceClient();

    const { data: team, error } = await supabase
      .from("teams")
      .insert({
        hunt_id: body.hunt_id,
        name: body.name || `Team ${Date.now().toString(36)}`,
        max_size: body.max_size || 6,
        formation_method: body.formation_method || "self_select",
      })
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);

    // Creator becomes captain
    await supabase.from("team_members").insert({
      team_id: team.id,
      user_id: user.id,
      role: "captain",
    });

    return Response.json({ team }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
