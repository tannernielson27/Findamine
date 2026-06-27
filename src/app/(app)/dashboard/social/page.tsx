"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Friend {
  id: string;
  status: string;
  created_at: string;
  friend: { id: string; display_name: string | null; avatar_url: string | null } | null;
}

interface Kudos {
  id: string;
  message: string;
  created_at: string;
  sender: { display_name: string | null } | null;
  receiver: { display_name: string | null } | null;
}

interface ReferralInfo {
  code: string | null;
  minion_count: number;
  referral_points: number;
  minions: { users: { display_name: string | null } | null }[];
}

export default function SocialPage() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [kudos, setKudos] = useState<Kudos[]>([]);
  const [loading, setLoading] = useState(true);
  const [kudosMessage, setKudosMessage] = useState("");
  const [kudosReceiverId, setKudosReceiverId] = useState("");
  const [sending, setSending] = useState(false);
  const [referral, setReferral] = useState<ReferralInfo | null>(null);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemMsg, setRedeemMsg] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function load() {
      const [friendsRes, kudosRes, referralRes] = await Promise.all([
        fetch("/api/v1/social/friends"),
        fetch("/api/v1/social/kudos"),
        fetch("/api/v1/social/referrals"),
      ]);
      if (friendsRes.ok) {
        const data = await friendsRes.json();
        setFriends(data.friends || []);
      }
      if (kudosRes.ok) {
        const data = await kudosRes.json();
        setKudos(data.kudos || []);
      }
      if (referralRes.ok) {
        setReferral(await referralRes.json());
      }
      setLoading(false);
    }
    load();
  }, []);

  const handleRedeem = async () => {
    if (!redeemCode.trim()) return;
    setRedeemMsg("");
    const res = await fetch("/api/v1/social/referrals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: redeemCode.trim() }),
    });
    if (res.ok) {
      setRedeemMsg("You're now connected to your recruiter!");
      setRedeemCode("");
    } else {
      const err = await res.json().catch(() => ({}));
      setRedeemMsg(err.error === "self_referral" ? "You can't use your own code." :
        err.error === "already_recruited" ? "You already have a recruiter." :
        "That code didn't work.");
    }
  };

  const handleCopyCode = () => {
    if (!referral?.code) return;
    navigator.clipboard?.writeText(referral.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const handleSendKudos = async () => {
    if (!kudosMessage.trim() || !kudosReceiverId || sending) return;
    setSending(true);
    const res = await fetch("/api/v1/social/kudos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receiver_id: kudosReceiverId, message: kudosMessage }),
    });
    if (res.ok) {
      const data = await res.json();
      setKudos((prev) => [data.kudos, ...prev]);
      setKudosMessage("");
      setKudosReceiverId("");
    }
    setSending(false);
  };

  const acceptedFriends = friends.filter((f) => f.status === "accepted");
  const pendingFriends = friends.filter((f) => f.status === "pending");

  return (
    <main className="mx-auto max-w-4xl px-4 py-4">
      <Link href="/dashboard" className="text-sm text-brand hover:underline mb-4 inline-block">
        &larr; Dashboard
      </Link>
      <h1 className="text-base font-semibold text-gray-900 mb-6">Social</h1>

      {loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-gray-100 rounded-lg" />
          <div className="h-48 bg-gray-100 rounded-lg" />
        </div>
      ) : (
        <>
        {/* Referral economy — recruit minions, earn when they score */}
        <div className="rounded-lg border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4 mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="font-semibold text-sm text-gray-900 mb-1">Recruit & Earn</h2>
              <p className="text-xs text-gray-500 mb-3 max-w-md">
                Share your code. When someone joins with it, they become your minion —
                and you earn points every time they score.
              </p>
              {referral?.code && (
                <button
                  onClick={handleCopyCode}
                  className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-mono font-semibold text-amber-700 hover:bg-amber-50"
                >
                  {referral.code}
                  <span className="text-[10px] font-sans text-amber-500">{copied ? "copied!" : "tap to copy"}</span>
                </button>
              )}
            </div>
            <div className="flex gap-4">
              <div className="text-center">
                <div className="text-xl font-bold text-amber-600">{referral?.minion_count ?? 0}</div>
                <div className="text-[10px] text-gray-500">Minions</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-emerald-600">{referral?.referral_points ?? 0}</div>
                <div className="text-[10px] text-gray-500">Points earned</div>
              </div>
            </div>
          </div>

          {/* Redeem someone else's code (only if not already recruited) */}
          <div className="mt-3 pt-3 border-t border-amber-100 flex gap-2 items-center flex-wrap">
            <input
              value={redeemCode}
              onChange={(e) => setRedeemCode(e.target.value.toUpperCase().slice(0, 8))}
              placeholder="Got a code? Enter it"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-mono w-44 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            <button
              onClick={handleRedeem}
              disabled={!redeemCode.trim()}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              Redeem
            </button>
            {redeemMsg && <span className="text-xs text-gray-600">{redeemMsg}</span>}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Friends */}
          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="font-semibold text-sm text-gray-900">
                Friends ({acceptedFriends.length})
              </h2>
            </div>
            {acceptedFriends.length === 0 ? (
              <p className="p-6 text-center text-sm text-gray-500">No friends yet.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {acceptedFriends.map((f) => (
                  <div key={f.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center text-xs font-medium text-sky-700">
                      {(f.friend?.display_name || "?")[0].toUpperCase()}
                    </div>
                    <span className="text-sm text-gray-900">{f.friend?.display_name || "Player"}</span>
                  </div>
                ))}
              </div>
            )}
            {pendingFriends.length > 0 && (
              <>
                <div className="border-t border-gray-100 px-4 py-2 bg-yellow-50">
                  <p className="text-xs font-medium text-yellow-700">
                    {pendingFriends.length} pending request{pendingFriends.length > 1 ? "s" : ""}
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Kudos */}
          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="font-semibold text-sm text-gray-900">Kudos</h2>
            </div>

            {/* Send kudos form */}
            {acceptedFriends.length > 0 && (
              <div className="p-4 border-b border-gray-50">
                <select
                  value={kudosReceiverId}
                  onChange={(e) => setKudosReceiverId(e.target.value)}
                  className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm mb-2"
                >
                  <option value="">Send kudos to...</option>
                  {acceptedFriends.map((f) => (
                    <option key={f.friend?.id} value={f.friend?.id || ""}>
                      {f.friend?.display_name || "Player"}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <input
                    value={kudosMessage}
                    onChange={(e) => setKudosMessage(e.target.value.slice(0, 200))}
                    placeholder="Great teamwork today!"
                    className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                    onKeyDown={(e) => e.key === "Enter" && handleSendKudos()}
                  />
                  <button
                    onClick={handleSendKudos}
                    disabled={!kudosMessage.trim() || !kudosReceiverId || sending}
                    className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
              </div>
            )}

            {kudos.length === 0 ? (
              <p className="p-6 text-center text-sm text-gray-500">No kudos yet.</p>
            ) : (
              <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
                {kudos.map((k) => (
                  <div key={k.id} className="px-4 py-3">
                    <p className="text-sm text-gray-900">&ldquo;{k.message}&rdquo;</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {k.sender?.display_name || "Someone"} &rarr; {k.receiver?.display_name || "Someone"}
                      {" "}&middot;{" "}
                      {new Date(k.created_at).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        </>
      )}
    </main>
  );
}
