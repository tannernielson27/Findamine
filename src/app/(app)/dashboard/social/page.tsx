"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import StreakDisplay from "@/components/gamification/streak-display";
import { buildKudosRecipients, type RecipientGroup } from "@/lib/social/recipients";

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

interface ReferralPerson {
  created_at: string;
  user: { id: string; display_name: string | null; avatar_url: string | null } | null;
}

interface ReferralEarning {
  amount: number;
  created_at: string;
  description: string | null;
}

interface ReferralInfo {
  code: string | null;
  minion_count: number;
  referral_points: number;
  minions: ReferralPerson[];
  recruiter: ReferralPerson | null;
  recent_earnings: ReferralEarning[];
  /** Storyline S3: "silent" omits the gate fields below entirely. */
  forfeit_notice?: "shown" | "silent";
  disclosure_eligible?: boolean;
  forfeited_points?: number;
}

const GROUP_LABELS: Record<RecipientGroup, string> = {
  friend: "Friends",
  minion: "Your crew",
  recruiter: "Your recruiter",
};

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function initial(name: string | null | undefined): string {
  return (name || "?").trim()[0]?.toUpperCase() || "?";
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
      if (friendsRes.ok) setFriends((await friendsRes.json()).friends || []);
      if (kudosRes.ok) setKudos((await kudosRes.json()).kudos || []);
      if (referralRes.ok) setReferral(await referralRes.json());
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
      setRedeemMsg(
        err.error === "self_referral" ? "You can't use your own code." :
        err.error === "already_recruited" ? "You already have a recruiter." :
        "That code didn't work."
      );
    }
  };

  const handleShare = async () => {
    if (!referral?.code) return;
    const text = `Join my crew on findamine! Enter my code ${referral.code} under Social → Redeem and we team up — I earn a little every time you score.`;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "Join me on findamine", text });
        return;
      } catch {
        /* user cancelled — fall through to copy */
      }
    }
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

  const recipients = buildKudosRecipients({
    friends: acceptedFriends,
    minions: referral?.minions,
    recruiter: referral?.recruiter,
  });
  const recipientGroups: RecipientGroup[] = ["friend", "minion", "recruiter"];

  return (
    <main className="mx-auto max-w-4xl px-4 py-5">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div>
          <Link href="/dashboard" className="text-sm text-brand hover:underline">
            &larr; Dashboard
          </Link>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-themed-text mt-1">
            Your crew
          </h1>
        </div>
        <StreakDisplay />
      </div>

      {loading ? (
        <div className="animate-pulse space-y-4">
          <div className="h-40 bg-themed-bg rounded-2xl" />
          <div className="h-48 bg-themed-bg rounded-2xl" />
        </div>
      ) : (
        <>
          {/* ── Referral economy: the incentive engine, made visible ── */}
          <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand via-brand to-brand-dark p-6 mb-6 text-white shadow-lg">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="max-w-md">
                <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold">Recruit &amp; earn</h2>
                <p className="text-sm text-white/85 mt-1">
                  Share your code. Whoever joins with it becomes part of your crew — and
                  you earn a share of points every time they score.
                </p>
                {referral?.code && (
                  <div className="mt-4 flex items-center gap-2">
                    <code className="rounded-xl bg-white/15 px-4 py-2 font-mono text-xl font-bold tracking-widest backdrop-blur">
                      {referral.code}
                    </code>
                    <button
                      onClick={handleShare}
                      className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-brand-dark shadow-sm transition-transform active:scale-95 hover:bg-white/90"
                    >
                      {copied ? "Copied!" : "Share code"}
                    </button>
                  </div>
                )}
              </div>

              <div className="flex gap-6">
                <div className="text-center">
                  <div className="font-[family-name:var(--font-display)] text-4xl font-bold">{referral?.minion_count ?? 0}</div>
                  <div className="text-xs text-white/75 mt-0.5">in your crew</div>
                </div>
                <div className="text-center">
                  <div className="font-[family-name:var(--font-display)] text-4xl font-bold">{referral?.referral_points ?? 0}</div>
                  <div className="text-xs text-white/75 mt-0.5">points earned</div>
                </div>
              </div>
            </div>

            {/* Crew avatars */}
            {referral && referral.minions.length > 0 && (
              <div className="mt-5 flex items-center gap-2">
                <div className="flex -space-x-2">
                  {referral.minions.slice(0, 8).map((m, i) => (
                    <div
                      key={m.user?.id ?? i}
                      title={m.user?.display_name ?? "Crew member"}
                      className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-brand-dark bg-white/90 text-sm font-bold text-brand-dark"
                    >
                      {initial(m.user?.display_name)}
                    </div>
                  ))}
                </div>
                {referral.minion_count > 8 && (
                  <span className="text-sm text-white/80">+{referral.minion_count - 8} more</span>
                )}
              </div>
            )}

            {/* Recruited-by */}
            {referral?.recruiter?.user && (
              <p className="mt-4 text-sm text-white/80">
                Recruited by <span className="font-semibold text-white">{referral.recruiter.user.display_name ?? "your recruiter"}</span> — score well to reward them.
              </p>
            )}

            {/* Redeem someone else's code (only meaningful if not yet recruited) */}
            {!referral?.recruiter && (
              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/20 pt-4">
                <input
                  value={redeemCode}
                  onChange={(e) => setRedeemCode(e.target.value.toUpperCase().slice(0, 8))}
                  placeholder="Got a code?"
                  className="w-40 rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-sm font-mono text-white placeholder-white/60 focus:bg-white/20 focus:outline-none"
                />
                <button
                  onClick={handleRedeem}
                  disabled={!redeemCode.trim()}
                  className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-brand-dark hover:bg-white/90 disabled:opacity-50"
                >
                  Join a crew
                </button>
                {redeemMsg && <span className="text-sm text-white/90">{redeemMsg}</span>}
              </div>
            )}
          </section>

          {/* Disclosure gate — hidden profiles don't collect crew bonuses. The
              cost of privacy is shown, not just applied (prospectus §3.2) —
              unless the participant is in the S3 "silent" arm. */}
          {referral && referral.forfeit_notice !== "silent" && referral.disclosure_eligible === false && (
            <section className="rounded-2xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-4 mb-6">
              <p className="text-sm font-medium text-themed-text mb-1">
                Your crew bonuses are paused
              </p>
              <p className="text-sm text-themed-muted">
                Your name or score is hidden, so crew points aren&apos;t being
                collected{referral.forfeited_points ? (
                  <> — you&apos;ve missed <strong>{referral.forfeited_points} points</strong> so far</>
                ) : null}.{" "}
                <Link href="/settings/privacy" className="text-brand hover:underline font-medium">
                  Review privacy settings
                </Link>
              </p>
            </section>
          )}

          {/* Recent earnings feed — passive income, made tangible */}
          {referral && referral.recent_earnings.length > 0 && (
            <section className="rounded-2xl border border-themed-border bg-surface p-4 mb-6">
              <h3 className="font-[family-name:var(--font-display)] text-sm font-bold text-themed-text mb-3">
                Crew activity
              </h3>
              <ul className="space-y-2">
                {referral.recent_earnings.map((e, i) => (
                  <li key={i} className="flex items-center justify-between text-sm">
                    <span className="text-themed-muted">
                      {e.description || "Referral bonus from a crew member's find"}
                    </span>
                    <span className="flex items-center gap-3 whitespace-nowrap">
                      <span className="font-[family-name:var(--font-display)] font-bold text-[var(--color-success)]">+{e.amount}</span>
                      <span className="text-xs text-themed-muted">{timeAgo(e.created_at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Friends */}
            <section className="rounded-2xl border border-themed-border bg-surface overflow-hidden">
              <div className="border-b border-themed-border px-5 py-3.5">
                <h2 className="font-[family-name:var(--font-display)] font-bold text-themed-text">
                  Friends ({acceptedFriends.length})
                </h2>
              </div>
              {acceptedFriends.length === 0 ? (
                <p className="p-8 text-center text-sm text-themed-muted">No friends yet — add some to send kudos.</p>
              ) : (
                <div className="divide-y divide-themed-border">
                  {acceptedFriends.map((f) =>
                    f.friend?.id ? (
                      <Link
                        key={f.id}
                        href={`/profile/${f.friend.id}`}
                        className="flex items-center gap-3 px-5 py-3 hover:bg-themed-border/20 transition"
                      >
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-light text-sm font-bold text-brand-dark">
                          {initial(f.friend.display_name)}
                        </div>
                        <span className="text-sm text-themed-text">{f.friend.display_name || "Player"}</span>
                      </Link>
                    ) : (
                      <div key={f.id} className="flex items-center gap-3 px-5 py-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-light text-sm font-bold text-brand-dark">
                          {initial(f.friend?.display_name)}
                        </div>
                        <span className="text-sm text-themed-text">{f.friend?.display_name || "Player"}</span>
                      </div>
                    )
                  )}
                </div>
              )}
              {pendingFriends.length > 0 && (
                <div className="border-t border-themed-border bg-[var(--color-warning)]/10 px-5 py-2.5">
                  <p className="text-xs font-medium text-[var(--color-warning)]">
                    {pendingFriends.length} pending request{pendingFriends.length > 1 ? "s" : ""}
                  </p>
                </div>
              )}
            </section>

            {/* Kudos */}
            <section className="rounded-2xl border border-themed-border bg-surface overflow-hidden">
              <div className="border-b border-themed-border px-5 py-3.5">
                <h2 className="font-[family-name:var(--font-display)] font-bold text-themed-text">Kudos</h2>
                <p className="text-xs text-themed-muted mt-0.5">Cheer on friends, crew, and your recruiter.</p>
              </div>

              {recipients.length > 0 && (
                <div className="p-5 border-b border-themed-border space-y-2">
                  <select
                    value={kudosReceiverId}
                    onChange={(e) => setKudosReceiverId(e.target.value)}
                    className="block w-full rounded-xl border border-themed-border bg-surface px-3 py-2 text-sm text-themed-text focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  >
                    <option value="">Send kudos to…</option>
                    {recipientGroups.map((g) => {
                      const inGroup = recipients.filter((r) => r.group === g);
                      if (inGroup.length === 0) return null;
                      return (
                        <optgroup key={g} label={GROUP_LABELS[g]}>
                          {inGroup.map((r) => (
                            <option key={r.id} value={r.id}>{r.label}</option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                  <div className="flex gap-2">
                    <input
                      value={kudosMessage}
                      onChange={(e) => setKudosMessage(e.target.value.slice(0, 200))}
                      placeholder="Great teamwork today!"
                      className="flex-1 rounded-xl border border-themed-border bg-surface px-3 py-2 text-sm text-themed-text focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                      onKeyDown={(e) => e.key === "Enter" && handleSendKudos()}
                    />
                    <button
                      onClick={handleSendKudos}
                      disabled={!kudosMessage.trim() || !kudosReceiverId || sending}
                      className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
                    >
                      Send
                    </button>
                  </div>
                </div>
              )}

              {kudos.length === 0 ? (
                <p className="p-8 text-center text-sm text-themed-muted">No kudos yet.</p>
              ) : (
                <div className="divide-y divide-themed-border max-h-72 overflow-y-auto">
                  {kudos.map((k) => (
                    <div key={k.id} className="px-5 py-3">
                      <p className="text-sm text-themed-text">&ldquo;{k.message}&rdquo;</p>
                      <p className="text-xs text-themed-muted mt-1">
                        {k.sender?.display_name || "Someone"} &rarr; {k.receiver?.display_name || "Someone"}
                        {" · "}
                        {timeAgo(k.created_at)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
