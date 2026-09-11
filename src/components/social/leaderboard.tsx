"use client";

import { useState, useEffect, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Trophy } from "lucide-react";
import {
  summarizeViewerStanding,
  standingCaption,
  type ServerMe,
} from "@/lib/social/standing";

interface LeaderboardEntry {
  user_id: string;
  score: number;
  display_name: string | null;
  avatar_url: string | null;
  codename?: string | null;
  hunts_completed?: number;
}

interface LeaderboardProps {
  huntId?: string;
}

export default function Leaderboard({ huntId }: LeaderboardProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [identityMode, setIdentityMode] = useState("codename_assigned");
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [serverMe, setServerMe] = useState<ServerMe | null>(null);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function fetchLeaderboard() {
    const params = huntId ? `?hunt_id=${huntId}` : "";
    const res = await fetch(`/api/v1/leaderboard${params}`);
    if (res.ok) {
      const data = await res.json();
      setEntries(data.entries || []);
      if (data.identity_mode) setIdentityMode(data.identity_mode);
      setViewerId(data.viewer_id ?? null);
      setServerMe(data.me ?? null);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchLeaderboard();
  }, [huntId]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const filter = huntId ? `hunt_id=eq.${huntId}` : undefined;

    const channel = supabase
      .channel("leaderboard-updates")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "play_sessions",
          ...(filter ? { filter } : {}),
        },
        (payload) => {
          if (payload.new.status === "completed" || payload.new.total_score !== payload.old?.total_score) {
            if (refetchTimer.current) clearTimeout(refetchTimer.current);
            refetchTimer.current = setTimeout(() => {
              refetchTimer.current = null;
              fetchLeaderboard();
            }, 3000);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (refetchTimer.current) {
        clearTimeout(refetchTimer.current);
        refetchTimer.current = null;
      }
    };
  }, [huntId]);

  const medals = ["🥇", "🥈", "🥉"];
  const podiumColors = [
    "from-amber-50 to-yellow-50 border-amber-200",
    "from-gray-50 to-slate-50 border-gray-200",
    "from-orange-50 to-amber-50 border-orange-200",
  ];

  const { standing, pinned } = summarizeViewerStanding(entries, viewerId, serverMe);
  const caption = standingCaption(standing);

  return (
    <div className="rounded-2xl border border-themed-border bg-white overflow-hidden">
      <div className="border-b border-gray-100 px-5 py-3 flex items-center justify-between bg-gradient-to-r from-brand-light/30 to-transparent">
        <h3 className="font-[family-name:var(--font-display)] font-semibold text-gray-900 flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" />
          {huntId ? "Hunt Leaderboard" : "Leaderboard"}
        </h3>
        <span className="text-xs text-green-600 flex items-center gap-1.5 font-medium">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          Live
        </span>
      </div>

      {loading ? (
        <div className="p-5 space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 animate-pulse">
              <div className="w-8 h-8 rounded-full bg-gray-100" />
              <div className="h-4 bg-gray-100 rounded-lg flex-1" />
              <div className="h-4 bg-gray-100 rounded-lg w-14" />
            </div>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="p-10 text-center">
          <div className="text-3xl mb-2">🏅</div>
          <p className="font-[family-name:var(--font-display)] font-semibold text-gray-500">No scores yet</p>
          <p className="font-[family-name:var(--font-handwritten)] text-lg text-gray-400">Be the first explorer!</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-50">
          {entries.map((entry, i) => {
            const isViewer = viewerId != null && entry.user_id === viewerId;
            return (
              <div
                key={entry.user_id}
                className={`flex items-center gap-3 px-5 py-3 transition-colors ${
                  isViewer
                    ? "bg-brand-light/40 ring-1 ring-inset ring-brand/40"
                    : i < 3
                    ? `bg-gradient-to-r ${podiumColors[i]}`
                    : "hover:bg-gray-50/50"
                }`}
              >
                {/* Rank */}
                <div className="w-8 text-center shrink-0">
                  {i < 3 ? (
                    <span className="text-xl">{medals[i]}</span>
                  ) : (
                    <span className="font-[family-name:var(--font-display)] text-sm font-bold text-gray-400">{i + 1}</span>
                  )}
                </div>

                {/* Avatar */}
                <div className="w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center shrink-0">
                  <span className="font-[family-name:var(--font-display)] text-xs font-bold text-brand">
                    {(entry.display_name || "?")[0].toUpperCase()}
                  </span>
                </div>

                {/* Name */}
                <div className="flex-1 min-w-0">
                  <p className="font-[family-name:var(--font-display)] text-sm font-semibold text-gray-900 truncate">
                    {entry.display_name || "Anonymous"}
                    {isViewer && (
                      <span className="ml-2 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold text-white align-middle">You</span>
                    )}
                  </p>
                  {isViewer && caption ? (
                    <p className="text-xs font-medium text-brand-dark">{caption}</p>
                  ) : entry.hunts_completed != null ? (
                    <p className="text-xs text-gray-400">{entry.hunts_completed} hunts</p>
                  ) : null}
                </div>

                {/* Score */}
                <div className="text-right shrink-0">
                  <span className="font-[family-name:var(--font-display)] text-base font-bold text-brand">{entry.score}</span>
                  <span className="text-[10px] text-gray-400 ml-1">pts</span>
                </div>
              </div>
            );
          })}

          {/* Viewer's standing pinned when they're off the visible board */}
          {pinned && standing && (
            <div className="flex items-center gap-3 border-t-2 border-dashed border-brand/30 bg-brand-light/40 px-5 py-3">
              <div className="w-8 text-center shrink-0">
                <span className="font-[family-name:var(--font-display)] text-sm font-bold text-brand-dark">{standing.rank}</span>
              </div>
              <div className="w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center shrink-0">
                <span className="font-[family-name:var(--font-display)] text-xs font-bold text-brand">★</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-[family-name:var(--font-display)] text-sm font-semibold text-gray-900">
                  You
                </p>
                {caption && <p className="text-xs font-medium text-brand-dark">{caption}</p>}
              </div>
              <div className="text-right shrink-0">
                <span className="font-[family-name:var(--font-display)] text-base font-bold text-brand">{standing.score}</span>
                <span className="text-[10px] text-gray-400 ml-1">pts</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
