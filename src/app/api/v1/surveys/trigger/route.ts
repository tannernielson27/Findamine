import { NextRequest } from "next/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { createEventDeliveriesForUser } from "@/lib/services/survey-delivery";
import { isAllowedTriggerEvent } from "@/lib/services/survey-triggers";

/**
 * Event-triggered survey delivery (Workstream B / Task B2).
 *
 * The client reports a named event (allowlisted — currently only `privacy_view`)
 * and any active `event` schedules for that name are materialized as pending
 * deliveries for the CURRENT user. Idempotent: deliveries are deduped per survey,
 * so repeat calls create nothing and simply return the still-answerable
 * deliveries, which the privacy page uses to decide whether the T1 gate applies.
 * Non-participants always get `{ created: 0, pending: [] }`.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body = await request.json().catch(() => ({}));
    const event = body?.event;
    if (!isAllowedTriggerEvent(event)) throw new ApiError(400, "Invalid event");

    const result = await createEventDeliveriesForUser(user.id, event);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
