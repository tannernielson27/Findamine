import { NextRequest } from "next/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { getParticipantConditions } from "@/lib/services/participant-conditions";

/**
 * The CURRENT user's experimental conditions (Workstream B / Task B9): the
 * dimensions linked to the active study plus this user's assigned level on each.
 * Participant-facing (any authenticated user) and strictly self-scoped — there is
 * no user_id parameter, so it can never expose another participant's assignment.
 * Backs the condition-aware debrief.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const { study, dimensions } = await getParticipantConditions(user.id);
    return Response.json({
      study,
      dimensions: dimensions.map((d) => ({
        name: d.name,
        description: d.description,
        levels: d.levels,
        assigned_level: d.assigned_level,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
