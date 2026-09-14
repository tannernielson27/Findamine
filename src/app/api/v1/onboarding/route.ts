import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";

/**
 * Track onboarding progress and tutorial completion.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    // Get milestones
    const { data: milestones } = await supabase
      .from("user_milestones")
      .select("milestone_type, achieved_at")
      .eq("user_id", user.id);

    // Get tutorial progress
    const { data: tutorials } = await supabase
      .from("tutorials")
      .select("id, title, description, target_roles, sort_order")
      .order("sort_order");

    const { data: progress } = await supabase
      .from("tutorial_progress")
      .select("tutorial_id")
      .eq("user_id", user.id);

    const completedTutorials = new Set((progress || []).map((p) => p.tutorial_id));
    const milestoneSet = new Set((milestones || []).map((m) => m.milestone_type));

    const onboardingComplete = milestoneSet.has("onboarding_completed");

    // Determine next steps based on role
    const nextSteps: string[] = [];
    if (!milestoneSet.has("profile_completed")) nextSteps.push("Complete your profile");
    if (!milestoneSet.has("first_hunt_started") && ["child", "teen", "adult", "parent"].includes(user.role)) {
      nextSteps.push("Join your first hunt");
    }
    if (!milestoneSet.has("first_hunt_started") && ["teacher", "hunt_creator"].includes(user.role)) {
      nextSteps.push("Create your first hunt");
    }

    return Response.json({
      onboarding_complete: onboardingComplete,
      milestones: milestones || [],
      tutorials: (tutorials || []).map((t) => ({
        ...t,
        completed: completedTutorials.has(t.id),
      })),
      next_steps: nextSteps,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

// Record milestone or tutorial completion
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body = await request.json();
    const supabase = await createSupabaseServiceClient();

    if (body.milestone_type) {
      await supabase.from("user_milestones").upsert(
        { user_id: user.id, milestone_type: body.milestone_type },
        { onConflict: "user_id,milestone_type" }
      );
      return Response.json({ message: "Milestone recorded" });
    }

    if (body.tutorial_id) {
      await supabase.from("tutorial_progress").upsert(
        { user_id: user.id, tutorial_id: body.tutorial_id },
        { onConflict: "user_id,tutorial_id" }
      );
      return Response.json({ message: "Tutorial completed" });
    }

    throw new ApiError(400, "Provide milestone_type or tutorial_id");
  } catch (error) {
    return errorResponse(error);
  }
}
