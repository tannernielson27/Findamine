import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    const consent = await supabase
      .from("consent_records")
      .select("*")
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });

    return Response.json({
      consent_records: consent.data || [],
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body = await request.json();
    const supabase = await createSupabaseServiceClient();

    // Record consent
    if (body.consent_type) {
      // COPPA: only parents/teachers/admins can create parental consent records
      if (body.consent_type === "parental") {
        if (!["parent", "teacher", "admin"].includes(user.role)) {
          throw new ApiError(403, "Only parents, teachers, or admins can grant parental consent");
        }
      }

      // Children cannot create any consent records for themselves
      if (["child"].includes(user.role) && body.consent_type !== "terms") {
        throw new ApiError(403, "Consent must be granted by a parent or teacher");
      }

      const { data, error } = await supabase
        .from("consent_records")
        .insert({
          user_id: user.id,
          consent_type: body.consent_type,
          form_version: body.form_version || "1.0",
          granted: body.granted ?? true,
          signature_name: body.signature_name || null,
          ip_address: request.headers.get("x-forwarded-for") || null,
          metadata: body.metadata || {},
        })
        .select()
        .single();

      if (error) throw new ApiError(500, error.message);
      return Response.json({ consent: data }, { status: 201 });
    }

    throw new ApiError(400, "Provide consent_type");
  } catch (error) {
    return errorResponse(error);
  }
}
