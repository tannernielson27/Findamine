/**
 * Privacy visibility system — controls who can see profile fields.
 *
 * Three treatment levels (from pilot research):
 * - simple: one master toggle (Private/Friends/Public)
 * - moderate: 3 categories × 3 levels (Identity/Performance/Social)
 * - complex: per-field × 4 levels (Nobody/Team/Class/Everyone)
 */

export type VisibilityLevel = "nobody" | "team" | "class" | "everyone";
export type PrivacyTreatment = "simple" | "moderate" | "complex";

export interface ProfileField {
  key: string;
  label: string;
  category: "identity" | "performance" | "social";
  description: string;
  educationalTip: string;
  defaultKids: VisibilityLevel;
  defaultTeens: VisibilityLevel;
  defaultAdults: VisibilityLevel;
}

export const PROFILE_FIELDS: ProfileField[] = [
  {
    key: "display_name",
    label: "Display Name",
    category: "identity",
    description: "The name others see on leaderboards and in teams",
    educationalTip: "Your display name helps teammates identify you. If you use a codename, only your team sees it.",
    defaultKids: "team",
    defaultTeens: "class",
    defaultAdults: "everyone",
  },
  {
    key: "avatar",
    label: "Avatar / Profile Picture",
    category: "identity",
    description: "Your profile picture or avatar icon",
    educationalTip: "Avatars make profiles fun! But remember: a photo of you is personal information.",
    defaultKids: "team",
    defaultTeens: "class",
    defaultAdults: "everyone",
  },
  {
    key: "real_name",
    label: "Real Name",
    category: "identity",
    description: "Your actual first and last name",
    educationalTip: "Your real name is private by default. Only share it if you want people outside your team to know who you are.",
    defaultKids: "nobody",
    defaultTeens: "nobody",
    defaultAdults: "class",
  },
  {
    key: "personality_scores",
    label: "Personality Profile",
    category: "performance",
    description: "Your Big 5 and Growth Mindset assessment results",
    educationalTip: "Your personality scores help form balanced teams. Sharing them is optional — they don't affect your grade.",
    defaultKids: "nobody",
    defaultTeens: "nobody",
    defaultAdults: "team",
  },
  {
    key: "badges",
    label: "Achievement Badges",
    category: "performance",
    description: "Badges you've earned from completing hunts and challenges",
    educationalTip: "Badges show your accomplishments! Sharing them can inspire others.",
    defaultKids: "team",
    defaultTeens: "class",
    defaultAdults: "everyone",
  },
  {
    key: "total_score",
    label: "Total Score",
    category: "performance",
    description: "Your cumulative score across all hunts",
    educationalTip: "Your score reflects effort, not just correctness. Sharing it is up to you.",
    defaultKids: "team",
    defaultTeens: "class",
    defaultAdults: "everyone",
  },
  {
    key: "hunt_history",
    label: "Hunt History",
    category: "social",
    description: "Which hunts you've played and your results",
    educationalTip: "Hunt history shows your learning journey. Some students prefer to keep this private.",
    defaultKids: "nobody",
    defaultTeens: "team",
    defaultAdults: "class",
  },
  {
    key: "friends_list",
    label: "Friends List",
    category: "social",
    description: "Who you've connected with on findamine",
    educationalTip: "Your friends list shows who you interact with. Think about whether you want everyone to see this.",
    defaultKids: "nobody",
    defaultTeens: "team",
    defaultAdults: "everyone",
  },
];

export const VISIBILITY_LABELS: Record<VisibilityLevel, { label: string; icon: string; description: string }> = {
  nobody: { label: "Only Me", icon: "🔒", description: "Nobody else can see this" },
  team: { label: "My Team", icon: "👥", description: "Only your current team members" },
  class: { label: "My Class", icon: "🏫", description: "Everyone in your class/roster" },
  everyone: { label: "Everyone", icon: "🌍", description: "All findamine users" },
};

export const CATEGORIES = [
  { key: "identity" as const, label: "Who I Am", fields: PROFILE_FIELDS.filter((f) => f.category === "identity") },
  { key: "performance" as const, label: "How I'm Doing", fields: PROFILE_FIELDS.filter((f) => f.category === "performance") },
  { key: "social" as const, label: "My Connections", fields: PROFILE_FIELDS.filter((f) => f.category === "social") },
];

/**
 * Get default visibility settings.
 *
 * With a `defaultCondition` (the experiment's privacy_default treatment):
 *   private → every field "nobody"
 *   public  → every field "everyone"
 *   neutral → empty map (no pre-selection; user must choose on first use)
 * Without one (or "age_band"), falls back to age-band defaults.
 */
export function getDefaults(
  ageBand: string,
  defaultCondition?: "private" | "neutral" | "public" | "age_band" | null
): Record<string, VisibilityLevel> {
  if (defaultCondition === "private") {
    return Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, "nobody" as VisibilityLevel]));
  }
  if (defaultCondition === "public") {
    return Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, "everyone" as VisibilityLevel]));
  }
  if (defaultCondition === "neutral") {
    return {};
  }

  const defaults: Record<string, VisibilityLevel> = {};
  for (const field of PROFILE_FIELDS) {
    if (ageBand === "primary" || ageBand === "intermediate") {
      defaults[field.key] = field.defaultKids;
    } else if (ageBand === "teen") {
      defaults[field.key] = field.defaultTeens;
    } else {
      defaults[field.key] = field.defaultAdults;
    }
  }
  return defaults;
}

/**
 * Check if a viewer can see a specific field for a user.
 */
export function canView(
  viewerRelationship: "self" | "team" | "class" | "public",
  fieldVisibility: VisibilityLevel
): boolean {
  // Closer viewers have higher access; each field requires a minimum closeness.
  // Ordering: public < class < team < self. A field set to "team" is visible to
  // teammates and self only; "everyone" is the lowest bar; "nobody" is self-only.
  const viewerAccess: Record<"self" | "team" | "class" | "public", number> = {
    public: 1,
    class: 2,
    team: 3,
    self: 4,
  };
  const requiredAccess: Record<VisibilityLevel, number> = {
    everyone: 1,
    class: 2,
    team: 3,
    nobody: 4,
  };
  return viewerAccess[viewerRelationship] >= requiredAccess[fieldVisibility];
}

/**
 * Strip profile fields the viewer should not see based on the target user's
 * profile_visibility settings. Returns a new object with hidden fields removed.
 *
 * @param profile - The user profile object (must include profile_visibility)
 * @param viewerRelationship - The viewer's relationship to the profile owner
 */
export function filterProfileForViewer(
  profile: { display_name?: string | null; avatar_url?: string | null; profile_visibility?: Record<string, string> },
  viewerRelationship: "self" | "team" | "class" | "public"
): { display_name: string | null; avatar_url: string | null } {
  if (viewerRelationship === "self") {
    return { display_name: profile.display_name ?? null, avatar_url: profile.avatar_url ?? null };
  }

  const vis = profile.profile_visibility || {};

  const displayNameLevel = (vis.display_name as VisibilityLevel) || "everyone";
  const avatarLevel = (vis.avatar as VisibilityLevel) || "everyone";

  return {
    display_name: canView(viewerRelationship, displayNameLevel) ? (profile.display_name ?? null) : null,
    avatar_url: canView(viewerRelationship, avatarLevel) ? (profile.avatar_url ?? null) : null,
  };
}

export type ViewerRelationship = "self" | "team" | "class" | "public";

/**
 * A fully-assembled profile payload keyed by the 8 logical profile fields.
 * Assembly (joins across badges/sessions/friends tables) happens at the call
 * site; this type is what filterFullProfileForViewer enforces over.
 */
export interface FullProfile {
  display_name: string | null;
  avatar_url: string | null;
  real_name: string | null;
  personality_scores: Record<string, unknown> | null;
  badges: unknown[] | null;
  total_score: number | null;
  hunt_history: unknown[] | null;
  friends_list: unknown[] | null;
}

/** Maps each logical field key to its FullProfile property. */
const FIELD_TO_PROP: Record<string, keyof FullProfile> = {
  display_name: "display_name",
  avatar: "avatar_url",
  real_name: "real_name",
  personality_scores: "personality_scores",
  badges: "badges",
  total_score: "total_score",
  hunt_history: "hunt_history",
  friends_list: "friends_list",
};

/**
 * Enforce all 8 profile fields at once: hidden fields come back as null.
 * Returns a new object; never mutates the input. This is the single filter
 * every "view another user's profile" surface must route through so that
 * restricting a field provably removes it from responses (Workstream A / A5).
 */
export function filterFullProfileForViewer(
  profile: FullProfile,
  visibility: Record<string, string> | undefined,
  viewerRelationship: ViewerRelationship
): FullProfile {
  if (viewerRelationship === "self") return { ...profile };

  const result = { ...profile };
  for (const [fieldKey, prop] of Object.entries(FIELD_TO_PROP)) {
    if (!canViewField(visibility, viewerRelationship, fieldKey)) {
      result[prop] = null as never;
    }
  }
  return result;
}

/** The visibility key used by avatar settings (the field key is "avatar", the column is avatar_url). */
export const PROFILE_FIELD_KEYS: string[] = PROFILE_FIELDS.map((f) => f.key);

/**
 * Whether a viewer may see a single logical profile field, given the owner's settings.
 * Unset fields default to "everyone" (matches filterProfileForViewer). Pure + testable.
 */
export function canViewField(
  visibility: Record<string, string> | undefined,
  viewerRelationship: ViewerRelationship,
  fieldKey: string
): boolean {
  if (viewerRelationship === "self") return true;
  const level = ((visibility || {})[fieldKey] as VisibilityLevel) || "everyone";
  return canView(viewerRelationship, level);
}

/**
 * The set of profile field keys a viewer may see, given the owner's settings.
 * Call sites use this to decide which fields/joins to include in a response. Pure.
 */
export function visibleFields(
  visibility: Record<string, string> | undefined,
  viewerRelationship: ViewerRelationship
): string[] {
  if (viewerRelationship === "self") return [...PROFILE_FIELD_KEYS];
  return PROFILE_FIELD_KEYS.filter((key) => canViewField(visibility, viewerRelationship, key));
}
