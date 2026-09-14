/**
 * Daily privacy-index snapshot cron (Workstream A / Task A4).
 *
 * For each enrolled, non-withdrawn participant, records a "scheduled" snapshot of
 * their current restrictiveness so the trajectory exists even when settings are
 * untouched. Authenticated with CRON_SECRET (same pattern as cluster-threats).
 */

import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { buildSnapshotRow } from "@/lib/services/privacy-snapshots";
import { countOverrides, type VisibilityOverrides } from "@/lib/utils/privacy";
import { conditionsFromMetadata } from "@/lib/utils/conditions";
import { fetchAllByIds, fetchAllRows } from "@/lib/utils/paginate";

export const maxDuration = 60; // seconds

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || !auth || !safeCompare(auth, `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createSupabaseServiceClient();

  // Distinct enrolled, non-withdrawn participants across active studies.
  // Paginated and chunked: a capped read would silently skip participants,
  // leaving holes in the trajectory that look like missing data.
  const enrollments = await fetchAllRows<{ user_id: string }>((from, to) =>
    supabase
      .from("study_enrollments")
      .select("user_id")
      .is("withdrawn_at", null)
      .order("user_id", { ascending: true })
      .range(from, to)
  );

  const userIds = [...new Set(enrollments.map((e) => e.user_id))];
  if (userIds.length === 0) {
    return Response.json({ participants: 0, snapshots: 0 });
  }

  // Current visibility + assigned condition for each participant.
  const users = await fetchAllByIds<{
    id: string;
    profile_visibility: unknown;
    profile_visibility_overrides: unknown;
    metadata: unknown;
  }>(userIds, (ids, from, to) =>
    supabase
      .from("users")
      .select("id, profile_visibility, profile_visibility_overrides, metadata")
      .in("id", ids)
      .order("id", { ascending: true })
      .range(from, to)
  );

  // Same row shape as the single-snapshot path, including the generic
  // `conditions` map (migration 053) alongside the two legacy columns.
  const rows = users.map((u) => {
    const visibility = (u.profile_visibility || {}) as Record<string, string>;
    const metadata = (u.metadata || {}) as Record<string, unknown>;
    return buildSnapshotRow(u.id, visibility, "scheduled", {
      treatment: (metadata.privacy_treatment as string) ?? null,
      privacyDefault: (metadata.privacy_default as string) ?? null,
      conditions: conditionsFromMetadata(metadata),
      overrideCount: countOverrides(u.profile_visibility_overrides as VisibilityOverrides | null),
    });
  });

  let written = 0;
  // Insert in chunks to stay well under payload limits.
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase.from("privacy_index_snapshots").insert(chunk);
    if (!error) written += chunk.length;
  }

  return Response.json({ participants: userIds.length, snapshots: written });
}
