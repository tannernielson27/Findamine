/**
 * Leaderboard field-visibility resolution (privacy enforcement, Task A5 follow-up).
 *
 * Leaderboards are the surface where two otherwise-unexposed profile fields reach
 * other users: `total_score` and `display_name`. This resolves, for a set of
 * ranked users, whether the viewer may see each one's score and name — so a user
 * who restricts `total_score` is omitted from boards others see (a real social
 * cost, which is the privacy↔visibility tension the study measures), and a
 * restricted `display_name` is redacted.
 *
 * One users query + the bulk relationship resolver → no N+1.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { canViewField } from "@/lib/utils/privacy";
import { getViewerRelationships } from "@/lib/utils/viewer";

export interface LeaderboardVisibility {
  /** Users whose total_score the viewer may NOT see → omit from score boards. */
  drop: Set<string>;
  /** Per-user: may the viewer see the display_name? (else redact). */
  nameAllowed: Map<string, boolean>;
}

export async function resolveLeaderboardVisibility(
  viewerId: string | null,
  userIds: string[]
): Promise<LeaderboardVisibility> {
  const drop = new Set<string>();
  const nameAllowed = new Map<string, boolean>();
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return { drop, nameAllowed };

  const supabase = await createSupabaseServiceClient();
  const { data: rows } = await supabase
    .from("users")
    .select("id, profile_visibility")
    .in("id", ids);

  const visById = new Map<string, Record<string, string>>();
  for (const r of rows || []) {
    visById.set(r.id, (r.profile_visibility || {}) as Record<string, string>);
  }

  const rels = viewerId
    ? await getViewerRelationships(viewerId, ids)
    : new Map<string, "public">(ids.map((id) => [id, "public"]));

  for (const id of ids) {
    const rel = rels.get(id) ?? "public";
    if (rel === "self") {
      nameAllowed.set(id, true);
      continue; // always see your own row
    }
    const vis = visById.get(id);
    if (!canViewField(vis, rel, "total_score")) drop.add(id);
    nameAllowed.set(id, canViewField(vis, rel, "display_name"));
  }

  return { drop, nameAllowed };
}
