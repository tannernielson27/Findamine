/**
 * Pure onboarding configuration + role routing.
 *
 * Kept free of React/DOM so the first-run funnel logic (which steps a role sees,
 * where "get started" sends them, which milestone marks completion) is unit-testable.
 * Onboarding content is identical across privacy conditions — it is NOT a study
 * manipulation surface; only role tailors it.
 */

export interface OnboardingStep {
  title: string;
  body: string;
  icon: string;
}

/** Milestone the API (GET /api/v1/onboarding) reads to compute next steps. */
export const ONBOARDING_MILESTONE = "onboarding_completed";

const CREATOR_ROLES = new Set(["teacher", "hunt_creator", "admin"]);

export function isCreatorRole(role?: string | null): boolean {
  return role ? CREATOR_ROLES.has(role) : false;
}

/** Where the final "get started" CTA propels a user for their first fun moment. */
export function onboardingDestination(role?: string | null): string {
  return isCreatorRole(role) ? "/dashboard/hunts" : "/browse";
}

/** Label for the final CTA. */
export function finalCtaLabel(role?: string | null): string {
  return isCreatorRole(role) ? "Build a hunt →" : "Start exploring →";
}

const PLAYER_STEPS: OnboardingStep[] = [
  {
    title: "Welcome to findamine!",
    body: "It's a GPS treasure hunt — real places, real clues, real points. Let's get you out the door fast.",
    icon: "🗺️",
  },
  {
    title: "Follow the trail",
    body: "Each hunt is a string of stops. Read the clue, then let the hot/cold meter pull you in — it glows red when you're right on top of it.",
    icon: "🧭",
  },
  {
    title: "Crack the challenge",
    body: "Reach a stop and a challenge unlocks. Nail it for points; grab a hint if you're stuck (it costs a few). Snap a geo-selfie to remember the spot.",
    icon: "🧩",
  },
  {
    title: "Rack up points & badges",
    body: "Every find adds to your score. Finish hunts to earn badges and climb the board. Ready to find your first one?",
    icon: "🏆",
  },
];

const CREATOR_STEPS: OnboardingStep[] = [
  {
    title: "Welcome to findamine!",
    body: "You build GPS treasure hunts and watch players chase them through the real world. Here's the gist.",
    icon: "🗺️",
  },
  {
    title: "A hunt is a trail of stops",
    body: "Each stop pairs a location with a clue and a challenge. Players navigate by a hot/cold meter and earn points for solving.",
    icon: "📍",
  },
  {
    title: "Make it yours",
    body: "Add primers, hints, badges, and a dozen challenge types — multiple choice, photo, sketch, audio, and more.",
    icon: "🛠️",
  },
  {
    title: "Launch & track",
    body: "Publish a hunt, share it, and watch players light up the leaderboard. Let's build your first one.",
    icon: "🚀",
  },
];

export function stepsForRole(role?: string | null): OnboardingStep[] {
  return isCreatorRole(role) ? CREATOR_STEPS : PLAYER_STEPS;
}
