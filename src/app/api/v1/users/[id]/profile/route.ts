import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import {
  filterFullProfileForViewer,
  filterProfileForViewer,
  visibleFields,
  type FullProfile,
  type ViewerRelationship,
  type ViewerContext,
  type VisibilityOverrides,
} from "@/lib/utils/privacy";
import { getViewerRelationship, getViewerRelationships } from "@/lib/utils/viewer";
import { sumLedger } from "@/lib/utils/points";

interface FriendRow {
  requester_id: string;
  addressee_id: string;
  requester?: EmbeddedUser | null;
  addressee?: EmbeddedUser | null;
}

interface EmbeddedUser {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_visibility?: Record<string, string>;
}

/**
 * GET /api/v1/users/[id]/profile — another user's profile, with every one of
 * the 8 logical profile fields enforced through filterFullProfileForViewer.
 * Hidden fields come back as null plus a `hidden_fields` list so the UI can
 * show that something exists but is private (disclosure must be visible to be
 * consequential — Workstream A / A5+E2).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const viewer = await getAuthUser(request);
    if (!viewer) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    const { data: target, error } = await supabase
      .from("users")
      .select("id, display_name, avatar_url, role, metadata, profile_visibility, profile_visibility_overrides, deleted_at")
      .eq("id", id)
      .maybeSingle();

    if (error || !target || target.deleted_at) {
      throw new ApiError(404, "User not found");
    }

    const relationship: ViewerRelationship =
      viewer.id === target.id ? "self" : await getViewerRelationship(viewer.id, target.id);
    const visibility = (target.profile_visibility || {}) as Record<string, string>;
    // Per-person overrides (migration 057) apply to THIS viewer specifically.
    const viewerCtx: ViewerContext = {
      viewerId: viewer.id,
      overrides: (target.profile_visibility_overrides || {}) as VisibilityOverrides,
    };

    // Assemble the full profile (only fetch what could be visible to keep this cheap).
    const allowed = new Set(visibleFields(visibility, relationship, viewerCtx));

    const [assessments, badges, points, sessions, friends] = await Promise.all([
      allowed.has("personality_scores")
        ? supabase
            .from("player_assessments")
            .select("assessment_type, scores, assessed_at")
            .eq("user_id", target.id)
            .order("assessed_at", { ascending: false })
        : Promise.resolve({ data: null }),
      allowed.has("badges")
        ? supabase
            .from("user_badges")
            .select("earned_at, badge_types(code, name, description, icon_url)")
            .eq("user_id", target.id)
            .order("earned_at", { ascending: false })
        : Promise.resolve({ data: null }),
      allowed.has("total_score")
        ? supabase.from("points_ledger").select("amount").eq("user_id", target.id)
        : Promise.resolve({ data: null }),
      allowed.has("hunt_history")
        ? supabase
            .from("play_sessions")
            .select("hunt_id, status, total_score, completed_at, hunts(title)")
            .eq("user_id", target.id)
            .eq("status", "completed")
            .order("completed_at", { ascending: false })
            .limit(20)
        : Promise.resolve({ data: null }),
      allowed.has("friends_list")
        ? supabase
            .from("friend_connections")
            .select(
              "requester_id, addressee_id, requester:users!requester_id(id, display_name, avatar_url, profile_visibility), addressee:users!addressee_id(id, display_name, avatar_url, profile_visibility)"
            )
            .or(`requester_id.eq.${target.id},addressee_id.eq.${target.id}`)
            .eq("status", "accepted")
        : Promise.resolve({ data: null }),
    ]);

    // Latest score set per assessment type; never expose raw item responses.
    const personalityScores: Record<string, unknown> = {};
    for (const a of assessments.data || []) {
      if (!(a.assessment_type in personalityScores)) {
        personalityScores[a.assessment_type] = a.scores;
      }
    }

    // Each friend in the list is ALSO a profile — filter them by their own
    // settings relative to this viewer (a private friend stays anonymous).
    let friendsList: unknown[] | null = null;
    if (friends.data) {
      const rows = friends.data as unknown as FriendRow[];
      const others = rows
        .map((r) => (r.requester_id === target.id ? r.addressee : r.requester))
        .filter((u): u is EmbeddedUser => Boolean(u?.id));
      const rels = await getViewerRelationships(viewer.id, others.map((u) => u.id));
      friendsList = others.map((u) => {
        const rel: ViewerRelationship = u.id === viewer.id ? "self" : rels.get(u.id) ?? "public";
        return { id: u.id, ...filterProfileForViewer(u, rel) };
      });
    }

    const meta = (target.metadata || {}) as Record<string, unknown>;
    const full: FullProfile = {
      display_name: target.display_name ?? null,
      avatar_url: target.avatar_url ?? null,
      real_name: typeof meta.real_name === "string" ? meta.real_name : null,
      personality_scores: Object.keys(personalityScores).length > 0 ? personalityScores : null,
      badges: badges.data || null,
      total_score: points.data ? sumLedger(points.data) : null,
      hunt_history: sessions.data || null,
      friends_list: friendsList,
    };

    const filtered = filterFullProfileForViewer(full, visibility, relationship, viewerCtx);
    const hiddenFields =
      relationship === "self"
        ? []
        : ["display_name", "avatar", "real_name", "personality_scores", "badges", "total_score", "hunt_history", "friends_list"].filter(
            (f) => !allowed.has(f)
          );

    return Response.json({
      profile: { id: target.id, role: target.role, ...filtered },
      relationship,
      hidden_fields: hiddenFields,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
