import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { conditionsFromMetadata } from "@/lib/utils/conditions";
import { ownsNormExposure } from "@/lib/services/class-norms";

// Log privacy-related events (Studies 1-3)
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body = await request.json();

    const ALLOWED_EVENT_TYPES = [
      "privacy_change",
      "privacy_abandon",
      "privacy_view",
      "privacy_field_touch",
    ];
    if (!ALLOWED_EVENT_TYPES.includes(body.event_type)) {
      throw new ApiError(400, "Invalid event_type");
    }

    const supabase = await createSupabaseServiceClient();

    // Stamp the participant's assigned condition server-side (never trusted from
    // the client): legacy columns + the generic `conditions` map (migration 053).
    const { data: userRow } = await supabase
      .from("users")
      .select("metadata")
      .eq("id", user.id)
      .maybeSingle();
    const meta = (userRow?.metadata || {}) as Record<string, unknown>;
    const conditions = conditionsFromMetadata(meta);
    // Only the caller's own norm exposure (S5, migration 062) may be stamped.
    const normExposureId = (await ownsNormExposure(user.id, body.norm_exposure_id))
      ? (body.norm_exposure_id as string)
      : null;

    const { data, error } = await supabase
      .from("privacy_events")
      .insert({
        user_id: user.id,
        event_type: body.event_type,
        treatment: (meta.privacy_treatment as string) ?? null,
        privacy_default: (meta.privacy_default as string) ?? null,
        conditions,
        page: body.page || null,
        old_value: body.old_value || null,
        new_value: body.new_value || null,
        duration_ms: body.duration_ms || null,
        click_count: body.click_count || null,
        session_id: body.session_id || null,
        norm_exposure_id: normExposureId,
        metadata: body.metadata || {},
      })
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);

    // Note: the authoritative privacy_change event + index snapshot (with
    // condition context) are written server-side by PUT /api/v1/auth/profile.
    // This endpoint now handles the ephemeral interaction signals only
    // (privacy_view, privacy_abandon, privacy_field_touch), so it no longer
    // snapshots — that avoids double-counting the trajectory.

    return Response.json({ event: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

// Get privacy events for research (admin/researcher)
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user || !["admin", "researcher"].includes(user.role)) {
      throw new ApiError(403, "Forbidden");
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");
    const eventType = searchParams.get("event_type");
    const limit = parseInt(searchParams.get("limit") || "100");

    const supabase = await createSupabaseServiceClient();

    let query = supabase
      .from("privacy_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (userId) query = query.eq("user_id", userId);
    if (eventType) query = query.eq("event_type", eventType);

    const { data } = await query;

    return Response.json({ events: data || [] });
  } catch (error) {
    return errorResponse(error);
  }
}
