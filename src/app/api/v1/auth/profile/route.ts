import { NextRequest } from "next/server";
import {
  getAuthUser,
  requireRole,
  errorResponse,
  ApiError,
} from "@/lib/utils/api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { diffVisibility, classifyChange } from "@/lib/utils/privacy-tracking";
import { computePrivacyIndex } from "@/lib/utils/privacy-index";
import { recordPrivacyIndexSnapshot } from "@/lib/services/privacy-snapshots";
import { conditionsFromMetadata, DIMENSION_META_PREFIX } from "@/lib/utils/conditions";
import {
  sanitizeOverrides,
  overridesEqual,
  countOverrides,
  PROFILE_FIELD_KEYS,
  type VisibilityOverrides,
} from "@/lib/utils/privacy";

interface PrivacyMeta {
  duration_ms?: number;
  click_count?: number;
  session_id?: string;
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user);

    const body = await request.json();
    const supabase = await createSupabaseServiceClient();

    const visibilityChanged = body.profile_visibility !== undefined;
    const newVisibility = (body.profile_visibility || {}) as Record<string, string>;

    // Per-person overrides (migration 057): only accepted friends and the
    // user's own minions may be keyed; unknown fields and levels are dropped.
    const overridesTouched = body.profile_visibility_overrides !== undefined;
    let newOverrides: VisibilityOverrides = {};
    if (overridesTouched) {
      const [{ data: friendRows }, { data: minionRows }] = await Promise.all([
        supabase
          .from("friend_connections")
          .select("requester_id, addressee_id")
          .eq("status", "accepted")
          .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`),
        supabase.from("minion_links").select("minion_id").eq("recruiter_id", user.id),
      ]);
      const allowed = new Set<string>();
      for (const r of friendRows || []) {
        allowed.add(r.requester_id === user.id ? r.addressee_id : r.requester_id);
      }
      for (const m of minionRows || []) allowed.add(m.minion_id);
      newOverrides = sanitizeOverrides(body.profile_visibility_overrides, allowed, PROFILE_FIELD_KEYS);
    }

    const metadataTouched =
      visibilityChanged ||
      overridesTouched ||
      body.metadata !== undefined ||
      body.real_name !== undefined;

    // When privacy settings or metadata are part of this update, read the current
    // state first: privacy changes are logged authoritatively here (never lost to
    // best-effort client telemetry), and metadata is always MERGED — a partial
    // client payload must never wipe the assigned experimental condition.
    let oldVisibility: Record<string, string> = {};
    let oldOverrides: VisibilityOverrides = {};
    let existingMeta: Record<string, unknown> = {};
    if (metadataTouched) {
      const { data: existing } = await supabase
        .from("users")
        .select("profile_visibility, profile_visibility_overrides, metadata")
        .eq("id", user.id)
        .maybeSingle();
      oldVisibility = (existing?.profile_visibility || {}) as Record<string, string>;
      oldOverrides = (existing?.profile_visibility_overrides || {}) as VisibilityOverrides;
      existingMeta = (existing?.metadata || {}) as Record<string, unknown>;
    }

    const deltas = visibilityChanged ? diffVisibility(oldVisibility, newVisibility) : [];
    const overridesChanged = overridesTouched && !overridesEqual(oldOverrides, newOverrides);
    const changed = deltas.length > 0 || overridesChanged;
    const effectiveOverrides = overridesTouched ? newOverrides : oldOverrides;

    // Build the update set.
    const updates: Record<string, unknown> = {};
    if (body.display_name !== undefined) updates.display_name = body.display_name;
    if (body.avatar_url !== undefined) updates.avatar_url = body.avatar_url;
    if (visibilityChanged) updates.profile_visibility = newVisibility;
    if (overridesTouched) updates.profile_visibility_overrides = newOverrides;

    if (metadataTouched) {
      // Merge metadata (never clobber the assigned condition) and stamp the first
      // explicit privacy choice — this is what separates a NEUTRAL participant's
      // pre-choice state from later deliberate changes.
      // Experimental-condition keys are server-owned; a client payload can
      // never set or overwrite them.
      const PROTECTED_META_KEYS = [
        "privacy_treatment",
        "privacy_default",
        "privacy_friction",
        "privacy_first_choice_at",
      ];
      // `dim_<dimension>` keys are the generic condition convention written by
      // enrollment (read by conditionsFromMetadata) — equally server-owned.
      const clientMeta = Object.fromEntries(
        Object.entries((body.metadata as Record<string, unknown>) || {}).filter(
          ([key]) => !PROTECTED_META_KEYS.includes(key) && !key.startsWith(DIMENSION_META_PREFIX)
        )
      );
      const mergedMeta: Record<string, unknown> = {
        ...existingMeta,
        ...clientMeta,
      };
      if (body.real_name !== undefined) {
        mergedMeta.real_name =
          typeof body.real_name === "string" && body.real_name.trim()
            ? body.real_name.trim().slice(0, 120)
            : null;
      }
      if (changed && !mergedMeta.privacy_first_choice_at) {
        mergedMeta.privacy_first_choice_at = new Date().toISOString();
      }
      updates.metadata = mergedMeta;
    }

    if (Object.keys(updates).length === 0) {
      throw new ApiError(400, "No valid fields to update");
    }

    const { data: profile, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", user.id)
      .select("id, email, display_name, avatar_url, role, metadata")
      .single();

    if (error) {
      throw new ApiError(500, "Failed to update profile");
    }

    // Authoritative privacy-change record + index snapshot, with condition context.
    if (changed) {
      const treatment = (existingMeta.privacy_treatment as string) ?? null;
      const privacyDefault = (existingMeta.privacy_default as string) ?? null;
      const privacyFriction = (existingMeta.privacy_friction as string) ?? null;
      // Generic `{ dimension: level }` map (migration 053), from the server-owned
      // metadata read BEFORE this update so a client payload can never influence it.
      const conditions = conditionsFromMetadata(existingMeta);
      const meta = (body.privacy_meta || {}) as PrivacyMeta;

      await supabase.from("privacy_events").insert({
        user_id: user.id,
        event_type: "privacy_change",
        page: "settings_privacy",
        old_value: oldVisibility,
        new_value: newVisibility,
        duration_ms: typeof meta.duration_ms === "number" ? meta.duration_ms : null,
        click_count: typeof meta.click_count === "number" ? meta.click_count : null,
        session_id: meta.session_id || null,
        treatment,
        privacy_default: privacyDefault,
        conditions,
        metadata: {
          deltas,
          direction: classifyChange(deltas),
          index_before: computePrivacyIndex(oldVisibility),
          index_after: computePrivacyIndex(newVisibility),
          friction: privacyFriction,
          // Per-person layer (migration 057): usage is its own outcome.
          override_count_before: countOverrides(oldOverrides),
          override_count_after: countOverrides(effectiveOverrides),
          overrides_changed: overridesChanged,
          source: "server", // authoritative; distinguishes from client telemetry
        },
      });

      await recordPrivacyIndexSnapshot(user.id, visibilityChanged ? newVisibility : oldVisibility, "change", {
        treatment,
        privacyDefault,
        conditions,
        overrideCount: countOverrides(effectiveOverrides),
      });
    }

    return Response.json({ user: profile });
  } catch (error) {
    return errorResponse(error);
  }
}
