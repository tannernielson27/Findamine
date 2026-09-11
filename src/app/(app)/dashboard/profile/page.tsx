"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface ProfileData {
  id: string;
  display_name: string | null;
  email: string;
  role: string;
  avatar_url: string | null;
  created_at: string;
  profile_visibility: Record<string, string>;
  metadata?: { real_name?: string | null };
}

interface Stats {
  hunts_completed: number;
  total_score: number;
  badges_earned: number;
  current_streak: number;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [realName, setRealName] = useState("");
  const [savedRealName, setSavedRealName] = useState("");
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    fetch("/api/v1/auth/me")
      .then((r) => r.json())
      .then((d) => {
        setProfile(d.user);
        const existing = d.user?.metadata?.real_name || "";
        setRealName(existing);
        setSavedRealName(existing);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    // Fetch stats
    fetch("/api/v1/gamification/me")
      .then((r) => { if (r.ok) return r.json(); throw new Error(); })
      .then((d) => setStats(d))
      .catch(() => {});
  }, []);

  async function handleSaveRealName() {
    setSavingName(true);
    const res = await fetch("/api/v1/auth/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ real_name: realName }),
    });
    if (res.ok) setSavedRealName(realName.trim());
    setSavingName(false);
  }

  if (loading) return <main className="mx-auto max-w-2xl px-4 py-4"><p className="text-sm text-gray-500">Loading...</p></main>;
  if (!profile) return <main className="mx-auto max-w-2xl px-4 py-4"><p className="text-sm text-gray-500">Not found</p></main>;

  return (
    <main className="mx-auto max-w-2xl px-4 py-4">
      {/* Profile header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-16 h-16 rounded-full bg-sky-100 flex items-center justify-center text-2xl text-sky-600 font-bold">
          {profile.display_name?.[0]?.toUpperCase() || "?"}
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900">{profile.display_name || "Explorer"}</h1>
          <p className="text-xs text-gray-500">{profile.role} · joined {new Date(profile.created_at).toLocaleDateString()}</p>
          <Link href="/settings/privacy" className="text-[11px] text-sky-600 hover:underline">
            Privacy settings →
          </Link>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-2 mb-6">
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
          <div className="text-xl font-bold text-sky-600">{stats?.hunts_completed || 0}</div>
          <div className="text-[10px] text-gray-500">Hunts</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
          <div className="text-xl font-bold text-emerald-600">{stats?.total_score || 0}</div>
          <div className="text-[10px] text-gray-500">Total Score</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
          <div className="text-xl font-bold text-amber-600">{stats?.badges_earned || 0}</div>
          <div className="text-[10px] text-gray-500">Badges</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
          <div className="text-xl font-bold text-red-500">{stats?.current_streak || 0}🔥</div>
          <div className="text-[10px] text-gray-500">Streak</div>
        </div>
      </div>

      {/* Real name (optional — who can see it is controlled in Privacy Settings) */}
      <div className="rounded-lg border border-gray-200 bg-white p-3 mb-6">
        <label htmlFor="realName" className="block text-sm font-medium text-gray-900 mb-1">
          Real name <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <p className="text-xs text-gray-500 mb-2">
          Shown to others only if you allow it in{" "}
          <Link href="/settings/privacy" className="text-sky-600 hover:underline">
            privacy settings
          </Link>
          .
        </p>
        <div className="flex gap-2">
          <input
            id="realName"
            type="text"
            value={realName}
            onChange={(e) => setRealName(e.target.value)}
            maxLength={120}
            placeholder="First and last name"
            className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:bg-white focus:border-sky-300 focus:outline-none"
          />
          <button
            onClick={handleSaveRealName}
            disabled={savingName || realName.trim() === savedRealName}
            className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-40 transition"
          >
            {savingName ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Quick links */}
      <div className="space-y-2">
        <Link href="/dashboard/assessment" className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2.5 hover:border-sky-200 transition">
          <div>
            <p className="text-sm font-medium text-gray-900">Personality Assessment</p>
            <p className="text-[11px] text-gray-500">Big 5 + Growth Mindset</p>
          </div>
          <span className="text-gray-300">→</span>
        </Link>
        <Link href="/dashboard/badges" className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2.5 hover:border-sky-200 transition">
          <div>
            <p className="text-sm font-medium text-gray-900">My Badges</p>
            <p className="text-[11px] text-gray-500">View achievements</p>
          </div>
          <span className="text-gray-300">→</span>
        </Link>
        <Link href="/settings" className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2.5 hover:border-sky-200 transition">
          <div>
            <p className="text-sm font-medium text-gray-900">Account Settings</p>
            <p className="text-[11px] text-gray-500">Name, email, password</p>
          </div>
          <span className="text-gray-300">→</span>
        </Link>
        <Link href="/settings/privacy" className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2.5 hover:border-sky-200 transition">
          <div>
            <p className="text-sm font-medium text-gray-900">Privacy Settings</p>
            <p className="text-[11px] text-gray-500">Control who sees your information</p>
          </div>
          <span className="text-gray-300">→</span>
        </Link>
      </div>
    </main>
  );
}
