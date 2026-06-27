import { NextRequest } from "next/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { getStudyHealth, getDefaultStudyId } from "@/lib/services/research-dashboard";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "admin", "researcher");

    const { searchParams } = new URL(request.url);
    const studyId = searchParams.get("study_id") || (await getDefaultStudyId());
    if (!studyId) throw new ApiError(404, "No study found");

    const health = await getStudyHealth(studyId);
    return Response.json(health);
  } catch (error) {
    return errorResponse(error);
  }
}
