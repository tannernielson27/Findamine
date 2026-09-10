"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList, ChevronRight, CheckCircle2 } from "lucide-react";

interface Delivery {
  id: string;
  status: string;
  expires_at: string | null;
  surveys: { id: string; title: string; description: string | null } | null;
}

function daysLeft(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / (24 * 3_600_000)));
}

export default function SurveysPage() {
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);

  useEffect(() => {
    fetch("/api/v1/surveys?pending=true")
      .then((r) => (r.ok ? r.json() : { deliveries: [] }))
      .then((data) => setDeliveries(data.deliveries || []))
      .catch(() => setDeliveries([]));
  }, []);

  if (deliveries === null) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-40 bg-gray-100 rounded-xl" />
          <div className="h-24 bg-gray-100 rounded-2xl" />
          <div className="h-24 bg-gray-100 rounded-2xl" />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-gray-900 flex items-center gap-2 mb-1">
        <ClipboardList className="w-6 h-6 text-brand" />
        Surveys
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        A few short check-ins help us understand your experience. Your answers are private and
        never affect your score.
      </p>

      {deliveries.length === 0 ? (
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-8 text-center">
          <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
          <p className="font-semibold text-gray-900">You&apos;re all caught up</p>
          <p className="text-sm text-gray-500 mt-1">
            There are no surveys waiting for you right now. We&apos;ll let you know when the next
            one is ready.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {deliveries.map((d) => {
            const dl = daysLeft(d.expires_at);
            return (
              <li key={d.id}>
                <Link
                  href={`/surveys/${d.id}`}
                  className="group flex items-center gap-4 rounded-2xl bg-white border border-gray-100 shadow-sm p-5 hover:border-brand/40 hover:shadow-md transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900 truncate">
                        {d.surveys?.title || "Survey"}
                      </p>
                      {d.status === "opened" && (
                        <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                          In progress
                        </span>
                      )}
                    </div>
                    {d.surveys?.description && (
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                        {d.surveys.description}
                      </p>
                    )}
                    {dl !== null && (
                      <p className="text-xs text-gray-400 mt-1">
                        {dl === 0 ? "Closes today" : `${dl} day${dl === 1 ? "" : "s"} left`}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-brand transition-colors shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
