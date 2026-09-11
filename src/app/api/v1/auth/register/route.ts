import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { ApiError } from "@/lib/utils/api-auth";
import { authLimiter } from "@/lib/utils/rate-limit";
import { withLogging } from "@/lib/utils/with-logging";
import { botGuard } from "@/lib/utils/bot-guard";
import { trackEvent } from "@/lib/utils/track-event";
import { enrollParticipant } from "@/lib/services/enrollment";
import { redeemReferral } from "@/lib/services/referral";

export const POST = withLogging("POST /api/v1/auth/register", async (request: NextRequest) => {
  const blocked = await botGuard(request);
  if (blocked) return blocked;

  await authLimiter.check(request);
  const body = await request.json();
  const { email, password, display_name, role, date_of_birth } = body;

  if (!email || !password) {
    throw new ApiError(400, "Email and password are required");
  }
  if (password.length < 8) {
    throw new ApiError(400, "Password must be at least 8 characters");
  }

  // Validate DOB if provided for any role
  if (date_of_birth) {
    const dob = new Date(date_of_birth);
    if (isNaN(dob.getTime())) {
      throw new ApiError(400, "Invalid date of birth");
    }
    if (dob.getTime() > Date.now()) {
      throw new ApiError(400, "Date of birth cannot be in the future");
    }
  }

  const selfRegisterRoles = ["teen", "parent", "teacher", "hunt_creator"];
  let userRole = selfRegisterRoles.includes(role) ? role : "parent";

  // If registering as teen, require DOB and verify age >= 13
  if (userRole === "teen") {
    if (!date_of_birth) {
      throw new ApiError(400, "Date of birth is required for teen accounts");
    }
    const age = Math.floor(
      (Date.now() - new Date(date_of_birth).getTime()) /
        (365.25 * 24 * 60 * 60 * 1000)
    );
    if (age < 13) {
      throw new ApiError(
        403,
        "You must be 13 or older to create your own account. Ask a parent or teacher to create an account for you."
      );
    }
    if (age >= 18) {
      userRole = "parent";
    }
  }

  const supabase = await createSupabaseServiceClient();

  const { data: authData, error: authError } =
    await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
    });

  if (authError) {
    if (authError.message.includes("already")) {
      throw new ApiError(409, "An account with this email already exists");
    }
    throw new ApiError(400, authError.message);
  }

  const { data: user, error: userError } = await supabase
    .from("users")
    .insert({
      auth_id: authData.user.id,
      email,
      display_name: display_name || null,
      role: userRole,
      date_of_birth: date_of_birth || null,
    })
    .select()
    .single();

  if (userError) {
    await supabase.auth.admin.deleteUser(authData.user.id);
    throw new ApiError(500, "Failed to create user profile");
  }

  // Assign treatment + enroll at signup (idempotent; never throws). The (app)
  // layout re-runs this on first authenticated load as a safety net.
  await enrollParticipant(user.id);

  // Optional: if the user arrived via a referral link, link them to the recruiter.
  if (body.referral_code && typeof body.referral_code === "string") {
    await redeemReferral(user.id, body.referral_code);
  }

  return Response.json(
    {
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        role: user.role,
      },
      message: "Account created. Please check your email to verify.",
    },
    { status: 201 }
  );
});
