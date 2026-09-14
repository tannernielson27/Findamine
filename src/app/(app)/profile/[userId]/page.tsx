"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";

interface BadgeRow {
  earned_at: string;
  badge_types: { code: string; name: string; description: string | null; icon_url: string | null } | null;
}

interface HuntRow {
  hunt_id: string;
  total_score: number | null;
  completed_at: string | null;
  hunts: { title: string | null } | null;
}

interface FriendEntry {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface PeerProfile {
  id: string;
  role: string;
  display_name: string | null;
  avatar_url: string | null;
  real_name: string | null;
  personality_scores: Record<string, Record<string, number>> | null;
  badges: BadgeRow[] | null;
  total_score: number | null;
  hunt_history: HuntRow[] | null;
  friends_list: FriendEntry[] | null;
}

interface ProfileResponse {
  profile: PeerProfile;
  relationship: "self" | "team" | "class" | "public";
  hidden_fields: string[];
}

const RELATIONSHIP_LABEL: Record<string, string> = {
  self: "This is you",
  team: "Your teammate",
  class: "In your class",
  public: "Explorer",
};

function HiddenNote({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-gray-400">
      <Lock className="w-3.5 h-3.5" />
      <span>{label} is private</span>
    </div>
  );
}

export default function PeerProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/v1/users/${userId}/profile`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error || "Could not load profile");
        return r.json();
      })
      .then((d: ProfileResponse) => setData(d))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load profile"))
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) {
    return <main className="mx-auto max-w-2xl px-4 py-4"><p className="text-sm text-gray-500">Loading...</p></main>;
  }
  if (error || !data) {
    return <main className="mx-auto max-w-2xl px-4 py-4"><p className="text-sm text-gray-500">{error || "Not found"}</p></main>;
  }

  const { profile, relationship, hidden_fields } = data;
  const hidden = new Set(hidden_fields);
  const name = profile.display_name || "Anonymous Explorer";

  return (
    <main className="mx-auto max-w-2xl px-4 py-4">
      {/* Header */}
      <div className="flex items-center gap-4 mb-2">
        <div className="w-16 h-16 rounded-full bg-sky-100 flex items-center justify-center text-2xl text-sky-600 font-bold overflow-hidden">
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
          ) : hidden.has("display_name") ? (
            <Lock className="w-6 h-6 text-gray-300" />
          ) : (
            name[0]?.toUpperCase() || "?"
          )}
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900">{name}</h1>
          {profile.real_name && <p className="text-sm text-gray-600">{profile.real_name}</p>}
          <p className="text-xs text-gray-500">{RELATIONSHIP_LABEL[relationship]}</p>
        </div>
      </div>

      {relationship === "self" && (
        <p className="mb-4 text-xs text-gray-500">
          Viewing your public profile.{" "}
          <Link href="/settings/privacy" className="text-sky-600 hover:underline">
            Control what others see →
          </Link>
        </p>
      )}

      <div className="space-y-3 mt-4">
        {/* Score */}
        {profile.total_score !== null ? (
          <div className="rounded-lg border border-gray-200 bg-white p-3 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-900">Total Score</span>
            <span className="text-lg font-bold text-emerald-600">{profile.total_score}</span>
          </div>
        ) : hidden.has("total_score") ? (
          <HiddenNote label="Total score" />
        ) : null}

        {/* Badges */}
        {profile.badges && profile.badges.length > 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-sm font-medium text-gray-900 mb-2">Badges</p>
            <div className="flex flex-wrap gap-2">
              {profile.badges.map((b, i) => (
                <span
                  key={`${b.badge_types?.code || i}`}
                  title={b.badge_types?.description || undefined}
                  className="rounded-full bg-amber-50 border border-amber-100 px-2.5 py-1 text-xs text-amber-800"
                >
                  {b.badge_types?.name || "Badge"}
                </span>
              ))}
            </div>
          </div>
        ) : hidden.has("badges") ? (
          <HiddenNote label="Badge collection" />
        ) : null}

        {/* Personality */}
        {profile.personality_scores ? (
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-sm font-medium text-gray-900 mb-2">Personality Profile</p>
            {Object.entries(profile.personality_scores).map(([type, scores]) => (
              <div key={type} className="mb-1.5">
                <p className="text-xs font-medium text-gray-600 capitalize">{type.replace(/_/g, " ")}</p>
                <p className="text-xs text-gray-500">
                  {Object.entries(scores || {})
                    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "number" ? Math.round(v) : v}`)
                    .join(" · ")}
                </p>
              </div>
            ))}
          </div>
        ) : hidden.has("personality_scores") ? (
          <HiddenNote label="Personality profile" />
        ) : null}

        {/* Hunt history */}
        {profile.hunt_history && profile.hunt_history.length > 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-sm font-medium text-gray-900 mb-2">Hunt History</p>
            <ul className="space-y-1.5">
              {profile.hunt_history.map((h, i) => (
                <li key={`${h.hunt_id}-${i}`} className="flex items-center justify-between text-xs">
                  <span className="text-gray-700">{h.hunts?.title || "Hunt"}</span>
                  <span className="text-gray-500">
                    {h.total_score ?? 0} pts
                    {h.completed_at ? ` · ${new Date(h.completed_at).toLocaleDateString()}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : hidden.has("hunt_history") ? (
          <HiddenNote label="Hunt history" />
        ) : null}

        {/* Friends */}
        {profile.friends_list && profile.friends_list.length > 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-sm font-medium text-gray-900 mb-2">Friends</p>
            <div className="flex flex-wrap gap-2">
              {profile.friends_list.map((f) => (
                <Link
                  key={f.id}
                  href={`/profile/${f.id}`}
                  className="rounded-full bg-sky-50 border border-sky-100 px-2.5 py-1 text-xs text-sky-800 hover:bg-sky-100 transition"
                >
                  {f.display_name || "Anonymous Explorer"}
                </Link>
              ))}
            </div>
          </div>
        ) : hidden.has("friends_list") ? (
          <HiddenNote label="Friends list" />
        ) : null}

        {hidden.has("real_name") && <HiddenNote label="Real name" />}
      </div>
    </main>
  );
}
