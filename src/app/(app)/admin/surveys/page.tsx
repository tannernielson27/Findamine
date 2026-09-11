"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Survey {
  id: string;
  title: string;
  description: string | null;
  status: string;
  target_roles: string[] | null;
  survey_questions: { count: number }[] | null;
  survey_schedules: { trigger_type: string; trigger_config: Record<string, unknown>; active: boolean }[] | null;
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-green-50 text-green-700 border-green-200",
  draft: "bg-gray-50 text-gray-600 border-gray-200",
  paused: "bg-amber-50 text-amber-700 border-amber-200",
  closed: "bg-red-50 text-red-600 border-red-200",
};

function questionCount(s: Survey): number {
  return s.survey_questions?.[0]?.count ?? 0;
}

function timepointLabel(s: Survey): string | null {
  const sched = s.survey_schedules?.[0];
  if (!sched) return null;
  const cfg = sched.trigger_config || {};
  const tp = typeof cfg.timepoint === "string" ? cfg.timepoint : null;
  const offset = typeof cfg.offset_days === "number" ? cfg.offset_days : null;
  if (tp && offset !== null) return `${tp} · day ${offset}`;
  if (tp) return tp;
  if (offset !== null) return `day ${offset}`;
  return sched.trigger_type;
}

export default function AdminSurveysPage() {
  const [surveys, setSurveys] = useState<Survey[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/v1/surveys");
    if (res.ok) {
      const data = await res.json();
      setSurveys(data.surveys || []);
    } else {
      setError("Could not load surveys (admin/researcher only).");
      setSurveys([]);
    }
  }

  useEffect(() => {
    // Inline fetch (not the async load()) so setState runs in a callback, not
    // synchronously in the effect body.
    fetch("/api/v1/surveys")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("forbidden"))))
      .then((data) => setSurveys(data.surveys || []))
      .catch(() => {
        setError("Could not load surveys (admin/researcher only).");
        setSurveys([]);
      });
  }, []);

  async function createSurvey() {
    if (!newTitle.trim()) return;
    setCreating(true);
    setError(null);
    const res = await fetch("/api/v1/surveys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle.trim(), target_roles: ["teen", "parent", "teacher", "hunt_creator"] }),
    });
    setCreating(false);
    if (res.ok) {
      setNewTitle("");
      load();
    } else {
      setError("Failed to create survey.");
    }
  }

  async function setStatus(s: Survey, status: string) {
    setBusyId(s.id);
    setError(null);
    // Guard: don't activate a survey with no questions — it would deliver an empty form.
    if (status === "active" && questionCount(s) === 0) {
      setError(`"${s.title}" has no questions yet. Add questions before activating.`);
      setBusyId(null);
      return;
    }
    const res = await fetch(`/api/v1/surveys/${s.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusyId(null);
    if (res.ok) load();
    else setError("Failed to update status.");
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-4">
      <Link href="/admin" className="text-sm text-brand hover:underline mb-4 inline-block">
        &larr; Admin
      </Link>
      <h1 className="text-lg font-semibold text-gray-900 mb-1">Surveys</h1>
      <p className="text-sm text-gray-500 mb-4">
        Author instruments and activate them. Only <strong>active</strong> surveys are delivered to
        participants; questions are stored per-item so responses score correctly.
      </p>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Create */}
      <div className="mb-6 flex gap-2">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createSurvey()}
          placeholder="New survey title..."
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
        <button
          onClick={createSurvey}
          disabled={creating || !newTitle.trim()}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {creating ? "Creating..." : "Create"}
        </button>
      </div>

      {surveys === null ? (
        <div className="animate-pulse space-y-2">
          {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-lg" />)}
        </div>
      ) : surveys.length === 0 ? (
        <p className="text-sm text-gray-500">No surveys yet. Create one above.</p>
      ) : (
        <ul className="space-y-2">
          {surveys.map((s) => {
            const qc = questionCount(s);
            const tp = timepointLabel(s);
            return (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-4"
              >
                <div className="flex-1 min-w-[180px]">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900">{s.title}</p>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                        STATUS_STYLES[s.status] || STATUS_STYLES.draft
                      }`}
                    >
                      {s.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {qc} question{qc === 1 ? "" : "s"}
                    {tp && <> · {tp}</>}
                    {qc === 0 && <span className="text-amber-600"> · needs questions</span>}
                  </p>
                </div>

                <Link
                  href={`/admin/surveys/${s.id}`}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Edit questions
                </Link>

                {s.status === "active" ? (
                  <button
                    onClick={() => setStatus(s, "paused")}
                    disabled={busyId === s.id}
                    className="rounded-md border border-amber-300 px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                  >
                    Pause
                  </button>
                ) : (
                  <button
                    onClick={() => setStatus(s, "active")}
                    disabled={busyId === s.id}
                    className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    Activate
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
