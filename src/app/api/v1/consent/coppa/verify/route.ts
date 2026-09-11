import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { errorResponse, ApiError } from "@/lib/utils/api-auth";
import { authLimiter } from "@/lib/utils/rate-limit";

/**
 * Verify parental consent via email link.
 * Parent clicks link with token -> consent verified -> child account activated.
 */
export async function GET(request: NextRequest) {
  try {
    await authLimiter.check(request);
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");
    const childId = searchParams.get("child_id");

    if (!token || !childId) {
      throw new ApiError(400, "Missing token or child_id");
    }

    const supabase = await createSupabaseServiceClient();

    // Find consent record scoped to THIS child with matching token
    const { data: consent } = await supabase
      .from("consent_records")
      .select("id, user_id, granted, verified_at")
      .eq("consent_type", "parental")
      .eq("child_id", childId)
      .eq("verification_token", token)
      .is("revoked_at", null)
      .maybeSingle();

    if (!consent) {
      throw new ApiError(404, "Consent record not found or invalid token");
    }

    // Prevent re-verification
    if (consent.verified_at) {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://findamine.app";
      return Response.redirect(`${siteUrl}/consent-verified?already=true`);
    }

    // Mark consent as granted and verified
    await supabase
      .from("consent_records")
      .update({
        granted: true,
        verified_at: new Date().toISOString(),
      })
      .eq("id", consent.id);

    // Verify the parent-child link
    await supabase
      .from("parent_child_links")
      .update({ verified: true })
      .eq("parent_id", consent.user_id)
      .eq("child_id", childId);

    // Activate the child's account
    await supabase
      .from("users")
      .update({ status: "active" })
      .eq("id", childId)
      .eq("status", "pending_consent"); // Only activate if still pending

    // Redirect to success page
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://findamine.app";
    return Response.redirect(`${siteUrl}/consent-verified?success=true`);
  } catch (error) {
    return errorResponse(error);
  }
}
