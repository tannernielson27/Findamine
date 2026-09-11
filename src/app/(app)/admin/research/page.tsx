import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { getStudyHealth, getDefaultStudyId } from "@/lib/services/research-dashboard";

export const dynamic = "force-dynamic";

function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

export default async function ResearchPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) redirect("/login");

  const serviceClient = await createSupabaseServiceClient();
  const { data: profile } = await serviceClient
    .from("users")
    .select("role")
    .eq("auth_id", authUser.id)
    .single();
  if (!profile || !["admin", "researcher"].includes(profile.role)) {
    redirect("/dashboard");
  }

  const studyId = await getDefaultStudyId();
  const health = studyId ? await getStudyHealth(studyId) : null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-4">
      <Link href="/admin" className="text-sm text-brand hover:underline mb-4 inline-block">
        &larr; Admin
      </Link>
      <h1 className="text-lg font-semibold text-gray-900 mb-2">Research Dashboard</h1>

      {!health || !health.study ? (
        <div className="rounded-lg border-2 border-dashed border-gray-200 p-12 text-center text-gray-500">
          No active study found. Seed one (migration 044) and enroll participants.
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-500 mb-6">
            {health.study.name} <span className="text-gray-400">({health.study.study_code} · {health.study.status})</span>
          </p>

          {/* Enrollment + logging completeness */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 mb-8">
            <Stat label="Enrolled" value={`${health.study.current_sample_size}${health.study.target_sample_size ? ` / ${health.study.target_sample_size}` : ""}`} />
            <Stat
              label="Enrollment failures (7d)"
              value={health.enrollment_failures_7d}
              tone={health.enrollment_failures_7d > 0 ? "alert" : "default"}
            />
            <Stat label="With privacy events" value={`${health.logging.with_privacy_events} (${pct(health.logging.with_privacy_events, health.logging.participants)})`} />
            <Stat label="With snapshots" value={`${health.logging.with_snapshots} (${pct(health.logging.with_snapshots, health.logging.participants)})`} />
            <Stat label="Events (24h)" value={health.logging.events_last_24h} />
          </div>

          {/* Cell balance */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold text-gray-900 mb-2">
              Cell balance{" "}
              <span className={health.balance.balanced ? "text-green-600" : "text-amber-600"}>
                {health.balance.balanced ? "✓ balanced" : "⚠ check"}
              </span>
            </h2>
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Dimension</th>
                    <th className="px-3 py-2 font-medium">Level</th>
                    <th className="px-3 py-2 font-medium text-right">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {health.balance.cells.map((c, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-3 py-2 text-gray-700">{c.dimension}</td>
                      <td className="px-3 py-2 text-gray-700">{c.level}</td>
                      <td className="px-3 py-2 text-right text-gray-900 font-medium">{c.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Survey delivery/submission funnel (pilot validation check c) */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold text-gray-900 mb-2">Survey funnel</h2>
            {health.surveys.length === 0 ? (
              <p className="text-sm text-gray-500">No time-scheduled surveys found (seed migrations 047/051).</p>
            ) : (
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-left">
                    <tr>
                      <th className="px-3 py-2 font-medium">Timepoint</th>
                      <th className="px-3 py-2 font-medium">Survey</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium text-right">Delivered</th>
                      <th className="px-3 py-2 font-medium text-right">Opened</th>
                      <th className="px-3 py-2 font-medium text-right">Submitted</th>
                      <th className="px-3 py-2 font-medium text-right">Expired</th>
                    </tr>
                  </thead>
                  <tbody>
                    {health.surveys.map((s, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-medium text-gray-900">{s.timepoint}</td>
                        <td className="px-3 py-2 text-gray-700">{s.survey_title}</td>
                        <td className="px-3 py-2">
                          <span className={s.survey_status === "active" ? "text-green-600" : "text-amber-600"}>
                            {s.survey_status}
                            {s.survey_status !== "active" && " (not delivering)"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-gray-900">{s.delivered}</td>
                        <td className="px-3 py-2 text-right text-gray-900">{s.opened}</td>
                        <td className="px-3 py-2 text-right text-gray-900">
                          {s.submitted} <span className="text-gray-400">({pct(s.submitted, s.delivered)})</span>
                        </td>
                        <td className="px-3 py-2 text-right text-gray-500">{s.expired}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Referral mechanic */}
          <section className="mb-8">
            <h2 className="text-sm font-semibold text-gray-900 mb-2">Referral economy</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Minion links" value={health.referral.minion_links} />
              <Stat label="Referral points awarded" value={health.referral.referral_points_total} />
              <Stat label="Privacy events (total)" value={health.logging.privacy_events_total} />
            </div>
          </section>

          <p className="text-xs text-gray-400">
            Validation checklist: balanced cells, &gt;0 events per participant, snapshots present, surveys delivering, referral links flowing.
          </p>
        </>
      )}
    </main>
  );
}

interface StatProps {
  label: string;
  value: string | number;
  /** "alert" highlights a value that needs attention (e.g. enrollment failures > 0). */
  tone?: "default" | "alert";
}

function Stat({ label, value, tone = "default" }: StatProps) {
  const alert = tone === "alert";
  return (
    <div
      className={
        alert
          ? "rounded-lg border border-red-300 bg-red-50 p-3"
          : "rounded-lg border border-gray-200 bg-white p-3"
      }
    >
      <div className={alert ? "text-xl font-bold text-red-700" : "text-xl font-bold text-gray-900"}>
        {value}
      </div>
      <div className={alert ? "text-[11px] text-red-600" : "text-[11px] text-gray-500"}>{label}</div>
    </div>
  );
}
