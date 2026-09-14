export type UserRole =
  | "child"
  | "teen"
  | "adult"
  | "parent"
  | "teacher"
  | "hunt_creator"
  | "admin"
  | "researcher";

export type UserStatus = "active" | "inactive" | "suspended" | "banned" | "pending_consent";

export type HuntStatus =
  | "draft"
  | "published"
  | "enrollment_open"
  | "in_progress"
  | "ended";

export type PlayMode =
  | "solo"
  | "team_assigned"
  | "team_self_select"
  | "team_random"
  | "team_ai_smart"
  | "team_custom_multi_dim";

export type TargetAudience = "kids" | "teens" | "adults" | "family" | "all";

export type SubjectDomain =
  | "science_nature"
  | "math_real_world"
  | "geography_maps"
  | "critical_thinking"
  | "reading_writing"
  | "history_community";

export type ChallengeType =
  | "multiple_choice"
  | "numeric_entry"
  | "short_text"
  | "photo_observation"
  | "sketch_draw"
  | "audio_response"
  | "sorting_ordering"
  | "team_debate"
  | "data_collection"
  | "creative_writing";

export type TeamStatus =
  | "forming"
  | "ready"
  | "active"
  | "completed"
  | "disbanded";

export type TeamMemberRole = "captain" | "member";

export type ModerationStatus = "pending" | "approved" | "rejected";

export type IdentityMode = "codename_assigned" | "codename_chosen" | "real_name";
