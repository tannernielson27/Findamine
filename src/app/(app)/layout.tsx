import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import Navbar from "@/components/layout/navbar";
import Onboarding from "@/components/layout/onboarding";
import ConsentGate from "@/components/layout/consent-gate";
import PrivacyFirstChoiceGate from "@/components/layout/privacy-first-choice-gate";
import { AgeBandProvider } from "@/lib/themes/age-band-provider";
import { enrollParticipant } from "@/lib/services/enrollment";
import type { AgeBand } from "@/lib/themes/tokens";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();

  let profile = null;
  let ageBand: AgeBand = "intermediate";
  let privacyFriction: "low" | "high" | null = null;

  if (authUser) {
    const serviceClient = await createSupabaseServiceClient();
    const { data } = await serviceClient
      .from("users")
      .select("id, display_name, role, avatar_url, metadata")
      .eq("auth_id", authUser.id)
      .is("deleted_at", null)
      .single();
    profile = data;

    // Auto-enroll into the active study (idempotent; never throws). This is the
    // canonical enrollment trigger — runs once the user is real and authenticated.
    if (profile) {
      const enrollment = await enrollParticipant(profile.id);
      const meta = (profile.metadata || {}) as Record<string, unknown>;
      const assigned = enrollment.frictionCondition ?? meta.privacy_friction;
      privacyFriction = assigned === "low" || assigned === "high" ? assigned : null;
    }

    // Get age band
    if (profile) {
      const { data: userProfile } = await serviceClient
        .from("user_profiles")
        .select("effective_band")
        .eq("user_id", profile.id)
        .maybeSingle();
      if (userProfile?.effective_band) {
        ageBand = userProfile.effective_band as AgeBand;
      }
    }
  }

  return (
    <AgeBandProvider initialBand={ageBand}>
      <Navbar user={profile ? { ...profile, privacy_friction: privacyFriction } : null} />
      {profile && <Onboarding role={profile.role} />}
      {/* Research-consent gate for study-eligible participants. Children can't
          self-consent and staff aren't participants, so they're excluded. */}
      {profile && !["child", "admin", "researcher"].includes(profile.role) && <ConsentGate />}
      {/* Neutral-default participants must make an explicit first privacy choice. */}
      {profile && !["child", "admin", "researcher"].includes(profile.role) && (
        <PrivacyFirstChoiceGate />
      )}
      {children}
    </AgeBandProvider>
  );
}
