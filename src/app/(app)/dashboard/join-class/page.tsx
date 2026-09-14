"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Users, CheckCircle2 } from "lucide-react";

export default function JoinClassPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [error, setError] = useState("");
  const [joined, setJoined] = useState<string | null>(null);

  async function join() {
    const trimmed = code.trim();
    if (!trimmed) return;
    setState("working");
    setError("");
    const res = await fetch("/api/v1/roster/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: trimmed }),
    });
    if (res.ok) {
      const data = await res.json();
      setJoined(data.roster?.name || "your class");
      setState("idle");
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not join. Check the code and try again.");
      setState("error");
    }
  }

  if (joined) {
    return (
      <main className="mx-auto max-w-md px-4 py-10 text-center">
        <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-gray-900">
          You joined {joined}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          You&apos;ll now see your classmates and class activities.
        </p>
        <button
          onClick={() => router.push("/dashboard")}
          className="mt-5 rounded-xl bg-brand px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark transition-all"
        >
          Go to dashboard
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-gray-900 flex items-center gap-2 mb-1">
        <Users className="w-6 h-6 text-brand" />
        Join a class
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        Enter the class code your teacher shared to join their roster.
      </p>

      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6">
        <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">
          Class code
        </label>
        <input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && join()}
          placeholder="e.g. K7P2QX"
          maxLength={12}
          className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-lg font-mono tracking-widest uppercase focus:bg-white focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 transition-all"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button
          onClick={join}
          disabled={state === "working" || !code.trim()}
          className="mt-4 w-full rounded-xl bg-brand px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50 transition-all"
        >
          {state === "working" ? "Joining..." : "Join class"}
        </button>
      </div>
    </main>
  );
}
