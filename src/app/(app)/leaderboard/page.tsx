import Leaderboard from "@/components/social/leaderboard";

export default function LeaderboardPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-5">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-themed-text">
          Leaderboard
        </h1>
        <p className="font-[family-name:var(--font-handwritten)] text-xl text-themed-muted">
          See where you stand — then go climb.
        </p>
      </div>
      <Leaderboard />
    </main>
  );
}
