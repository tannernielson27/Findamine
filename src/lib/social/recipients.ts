/**
 * Build the kudos recipient list from a user's social + referral network.
 *
 * B2 ties social recognition to the A6 referral loop: you can send kudos not just
 * to friends but to the minions you recruited and the recruiter who recruited you,
 * so engagement reinforces the incentive relationship. Pure + testable; respects
 * the privacy-filtered names handed in by the API (a null name → group fallback).
 */

export type RecipientGroup = "friend" | "minion" | "recruiter";

export interface KudosRecipient {
  id: string;
  label: string;
  group: RecipientGroup;
}

interface PersonRef {
  id: string;
  display_name?: string | null;
}

export interface RecipientSources {
  /** Accepted friends, shaped as { friend: { id, display_name } }. */
  friends?: { friend?: PersonRef | null }[];
  /** Recruited minions, shaped as { user: { id, display_name } | null }. */
  minions?: { user?: PersonRef | null }[];
  /** The recruiter, shaped as { user: { id, display_name } | null } | null. */
  recruiter?: { user?: PersonRef | null } | null;
  /** Viewer's own id, excluded from the list. */
  selfId?: string;
}

const FALLBACK: Record<RecipientGroup, string> = {
  friend: "Player",
  minion: "Your minion",
  recruiter: "Your recruiter",
};

function label(name: string | null | undefined, group: RecipientGroup): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? trimmed : FALLBACK[group];
}

/**
 * Returns a de-duplicated recipient list. When a person appears in more than one
 * relationship, the closest tie wins (friend > minion > recruiter). Self is excluded.
 */
export function buildKudosRecipients(sources: RecipientSources): KudosRecipient[] {
  const { friends = [], minions = [], recruiter = null, selfId } = sources;
  const out: KudosRecipient[] = [];
  const seen = new Set<string>();

  const add = (person: PersonRef | null | undefined, group: RecipientGroup) => {
    if (!person?.id) return;
    if (person.id === selfId) return;
    if (seen.has(person.id)) return;
    seen.add(person.id);
    out.push({ id: person.id, label: label(person.display_name, group), group });
  };

  for (const f of friends) add(f.friend, "friend");
  for (const m of minions) add(m.user, "minion");
  add(recruiter?.user, "recruiter");

  return out;
}
