import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { generalLimiter } from "@/lib/utils/rate-limit";
import { canViewField } from "@/lib/utils/privacy";
import { getViewerRelationships } from "@/lib/utils/viewer";

// Roles whose names are never shown publicly on leaderboards
const PROTECTED_ROLES = ["child", "teen"];

interface LeaderboardUser {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  profile_visibility?: Record<string, string>;
}

/**
 * Redact display info for protected users based on the hunt's identity_mode.
 * - codename_assigned / codename_chosen: always show codename
 * - real_name: show real name for adults, initials for children/teens
 */
function redactEntry(
  user: LeaderboardUser | null,
  codename: string | null,
  identityMode: string
) {
  if (!user) return { display_name: "Anonymous", avatar_url: null };

  // If hunt uses codenames, always show the codename
  if (identityMode !== "real_name" && codename) {
    return { display_name: codename, avatar_url: null };
  }

  // real_name mode: protect children/teens with initials
  if (PROTECTED_ROLES.includes(user.role)) {
    const initials = (user.display_name || "?")
      .split(" ")
      .map((w: string) => w[0])
      .join("")
      .toUpperCase();
    return { display_name: initials || "?", avatar_url: null };
  }

  return { display_name: user.display_name, avatar_url: user.avatar_url };
}

export async function GET(request: NextRequest) {
  try {
    await generalLimiter.check(request);
    const { searchParams } = new URL(request.url);
    const huntId = searchParams.get("hunt_id");
    const entryType = searchParams.get("type") || "user";
    const period = searchParams.get("period") || "all_time";
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "25") || 25, 1), 100);

    const supabase = await createSupabaseServiceClient();

    // Check if the requesting user is a teacher/admin for this hunt
    // (teachers can see real names for their own hunts)
    const currentUser = await getAuthUser(request);
    let isHuntOwner = false;

    if (huntId) {
      // Get hunt's identity_mode
      const { data: hunt } = await supabase
        .from("hunts")
        .select("identity_mode, created_by")
        .eq("id", huntId)
        .single();

      const identityMode = hunt?.identity_mode || "codename_assigned";

      if (
        currentUser &&
        hunt &&
        (hunt.created_by === currentUser.id ||
          ["admin", "researcher"].includes(currentUser.role))
      ) {
        isHuntOwner = true;
      }

      // Hunt-specific: join play_sessions for codenames
      const { data } = await supabase
        .from("play_sessions")
        .select(
          "user_id, total_score, codename, users(id, display_name, avatar_url, role, profile_visibility)"
        )
        .eq("hunt_id", huntId)
        .eq("status", "completed")
        .order("total_score", { ascending: false })
        .limit(limit);

      // In real_name mode, respect each player's display_name visibility: if the
      // viewer isn't permitted to see the name, redact it (keep them on the board).
      let relMap = new Map<string, "self" | "team" | "class" | "public">();
      if (identityMode === "real_name" && !isHuntOwner) {
        const targetIds = (data || []).map((r) => r.user_id as string);
        relMap = currentUser
          ? await getViewerRelationships(currentUser.id, targetIds)
          : new Map(targetIds.map((id) => [id, "public" as const]));
      }

      const entries = (data || []).map(
        (row: Record<string, unknown>) => {
          // Supabase returns joined users as array or object depending on relation type
          const rawUsers = row.users;
          const user: LeaderboardUser | null = Array.isArray(rawUsers)
            ? (rawUsers[0] as LeaderboardUser) ?? null
            : (rawUsers as LeaderboardUser) ?? null;

          const codename = row.codename as string | null;

          // Hide the name when the viewer lacks display_name permission.
          const rel = relMap.get(row.user_id as string) ?? "public";
          const nameAllowed =
            identityMode !== "real_name" ||
            canViewField(user?.profile_visibility, rel, "display_name");
          const effectiveMode = nameAllowed ? identityMode : "codename_assigned";

          const identity = isHuntOwner
            ? {
                display_name: user?.display_name ?? null,
                avatar_url: user?.avatar_url ?? null,
                codename,
              }
            : redactEntry(user, codename, effectiveMode);

          return {
            user_id: row.user_id as string,
            score: row.total_score as number,
            ...identity,
          };
        }
      );

      return Response.json({ entries, identity_mode: identityMode });
    }

    // Overall leaderboard: aggregated per user via RPC, always protect children
    const { data } = await supabase.rpc("overall_leaderboard", {
      p_limit: limit,
    });

    const entries = (data || []).map(
      (row: {
        user_id: string;
        total_score: number;
        hunts_completed: number;
        display_name: string | null;
        avatar_url: string | null;
        role: string;
        best_codename: string | null;
      }) => {
        const user: LeaderboardUser = {
          id: row.user_id,
          display_name: row.display_name,
          avatar_url: row.avatar_url,
          role: row.role,
        };
        const identity = redactEntry(
          user,
          row.best_codename,
          "codename_assigned"
        );
        return {
          user_id: row.user_id,
          score: row.total_score,
          hunts_completed: row.hunts_completed,
          ...identity,
        };
      }
    );

    return Response.json({ entries, identity_mode: "codename_assigned" });
  } catch (error) {
    return errorResponse(error);
  }
}
