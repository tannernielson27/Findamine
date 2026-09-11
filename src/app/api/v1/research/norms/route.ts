import { NextRequest } from "next/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { serveNormExposure } from "@/lib/services/class-norms";

const CONTEXT_RE = /^[a-z_:]{1,64}$/;

/**
 * Serve the descriptive norm line for storyline S5 (migration 062) and log the
 * exposure. Participants without a `norm_line` level, or in the `none` arm,
 * get `{ norm: null }` and nothing is logged.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const context =
      typeof body.context === "string" && CONTEXT_RE.test(body.context) ? body.context : "settings_privacy";

    return Response.json(await serveNormExposure(user.id, context));
  } catch (error) {
    return errorResponse(error);
  }
}
