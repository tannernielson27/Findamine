import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import {
  parseNoticeEventBody,
  noticeEventUpdate,
  type NoticeEventRow,
} from "@/lib/services/privacy-notice";

// Report display / dismissal / link click for one just-in-time privacy notice
// (storyline S6, migration 063). Owner-only; first write wins per timestamp.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const { id } = await params;
    const input = parseNoticeEventBody(await request.json().catch(() => null));
    if (!input) throw new ApiError(400, "Invalid notice event");

    const supabase = await createSupabaseServiceClient();
    const { data: row } = await supabase
      .from("notice_events")
      .select("id, displayed_at, dismissed_at, link_clicked_at, dwell_ms")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!row) throw new ApiError(404, "Notice not found");

    const update = noticeEventUpdate(row as NoticeEventRow, input, new Date().toISOString());
    if (update) {
      const { error } = await supabase
        .from("notice_events")
        .update(update)
        .eq("id", id)
        .eq("user_id", user.id);
      if (error) throw new ApiError(500, "Failed to record notice event");
    }

    return Response.json({ ok: true, recorded: update !== null });
  } catch (error) {
    return errorResponse(error);
  }
}
