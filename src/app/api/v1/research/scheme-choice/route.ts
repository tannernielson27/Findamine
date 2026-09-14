import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { conditionsFromMetadata } from "@/lib/utils/conditions";
import {
  applySchemeChoice,
  schemeSelectionState,
  validateSchemeChoice,
  type SchemeChoiceRecord,
} from "@/lib/utils/scheme-selection";

const RECORD_COLUMNS = "source, selection_arm, scheme_before, scheme_after, ratings, display_order, dwell_ms";

/**
 * Record a scheme preview or a one-time scheme switch (storyline S2,
 * migration 060). The scheme in force is written to users.metadata here and
 * only here; the profile PUT refuses those keys from clients.
 *
 * Body: { source: "preview", ratings: {simple, moderate, complex}, scheme?, display_order?, dwell_ms? }
 *     | { source: "switch", scheme, dwell_ms? }
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body: unknown = await request.json().catch(() => null);
    const supabase = await createSupabaseServiceClient();

    const { data: row } = await supabase.from("users").select("metadata").eq("id", user.id).maybeSingle();
    const meta = (row?.metadata || {}) as Record<string, unknown>;

    const result = validateSchemeChoice(body, schemeSelectionState(meta));
    if (!result.ok) throw new ApiError(result.status, result.error);
    let record: SchemeChoiceRecord = result.record;

    const { error: insertError } = await supabase
      .from("scheme_selections")
      .insert({ user_id: user.id, ...record, conditions: conditionsFromMetadata(meta) });
    if (insertError) {
      if (insertError.code !== "23505") throw new ApiError(500, "Failed to record scheme choice");
      // Already recorded: a double submit, or an earlier metadata write that
      // failed. Re-apply the stored row so the participant is never stuck.
      const { data: existing } = await supabase
        .from("scheme_selections")
        .select(RECORD_COLUMNS)
        .eq("user_id", user.id)
        .eq("source", record.source)
        .maybeSingle();
      if (!existing) throw new ApiError(409, "Scheme choice already recorded");
      record = existing as SchemeChoiceRecord;
    }

    const nextMeta = applySchemeChoice(meta, record, new Date().toISOString());
    const { error: updateError } = await supabase.from("users").update({ metadata: nextMeta }).eq("id", user.id);
    if (updateError) throw new ApiError(500, "Failed to apply scheme choice");

    return Response.json({ scheme: record.scheme_after, state: schemeSelectionState(nextMeta) });
  } catch (error) {
    return errorResponse(error);
  }
}
