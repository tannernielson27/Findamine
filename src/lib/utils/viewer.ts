/**
 * Viewer relationship resolution (Workstream A / Task A5).
 *
 * Determines a viewer's relationship to a target user so profile-field visibility
 * (see canViewField/visibleFields in privacy.ts) can be enforced at read paths.
 *
 *   self   → same user
 *   team   → share an active team (team_members)
 *   class  → share a roster/class (roster_entries)
 *   public → no shared team or class
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { ViewerRelationship } from "@/lib/utils/privacy";

export async function getViewerRelationship(
  viewerId: string,
  targetUserId: string
): Promise<ViewerRelationship> {
  if (viewerId === targetUserId) return "self";

  const supabase = await createSupabaseServiceClient();

  // Shared active team?
  const { data: viewerTeams } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", viewerId)
    .eq("status", "active");

  const teamIds = (viewerTeams || []).map((t) => t.team_id);
  if (teamIds.length > 0) {
    const { data: shared } = await supabase
      .from("team_members")
      .select("team_id")
      .eq("user_id", targetUserId)
      .eq("status", "active")
      .in("team_id", teamIds)
      .limit(1);
    if (shared && shared.length > 0) return "team";
  }

  // Shared roster/class?
  const { data: viewerRosters } = await supabase
    .from("roster_entries")
    .select("roster_id")
    .eq("student_id", viewerId);

  const rosterIds = (viewerRosters || []).map((r) => r.roster_id);
  if (rosterIds.length > 0) {
    const { data: sharedRoster } = await supabase
      .from("roster_entries")
      .select("roster_id")
      .eq("student_id", targetUserId)
      .in("roster_id", rosterIds)
      .limit(1);
    if (sharedRoster && sharedRoster.length > 0) return "class";
  }

  return "public";
}

/**
 * Bulk variant: resolve the viewer's relationship to many target users in a fixed
 * number of queries (not N). Returns a Map keyed by target user id. "self" is
 * included for the viewer's own id if present.
 */
export async function getViewerRelationships(
  viewerId: string,
  targetIds: string[]
): Promise<Map<string, ViewerRelationship>> {
  const result = new Map<string, ViewerRelationship>();
  const targets = [...new Set(targetIds)].filter((id) => id);
  if (targets.length === 0) return result;

  const supabase = await createSupabaseServiceClient();

  // Default everyone to public; upgrade below.
  for (const id of targets) result.set(id, id === viewerId ? "self" : "public");

  // Shared teams → "class" is weaker than "team", so resolve team last to win.
  const { data: viewerRosters } = await supabase
    .from("roster_entries")
    .select("roster_id")
    .eq("student_id", viewerId);
  const rosterIds = (viewerRosters || []).map((r) => r.roster_id);
  if (rosterIds.length > 0) {
    const { data: classmates } = await supabase
      .from("roster_entries")
      .select("student_id")
      .in("roster_id", rosterIds)
      .in("student_id", targets);
    for (const c of classmates || []) {
      if (c.student_id !== viewerId) result.set(c.student_id, "class");
    }
  }

  const { data: viewerTeams } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", viewerId)
    .eq("status", "active");
  const teamIds = (viewerTeams || []).map((t) => t.team_id);
  if (teamIds.length > 0) {
    const { data: teammates } = await supabase
      .from("team_members")
      .select("user_id")
      .eq("status", "active")
      .in("team_id", teamIds)
      .in("user_id", targets);
    for (const t of teammates || []) {
      if (t.user_id !== viewerId) result.set(t.user_id, "team");
    }
  }

  return result;
}
