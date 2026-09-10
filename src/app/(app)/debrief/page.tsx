import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, ArrowLeft } from "lucide-react";
import WithdrawButton from "@/components/research/withdraw-button";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  getParticipantConditions,
  type ConditionDimension,
} from "@/lib/services/participant-conditions";

/**
 * Study debrief surface (condition-aware — Workstream B / Task B9).
 *
 * ⚠️ PLACEHOLDER copy. The framing paragraphs are draft text pending IRB
 * approval. The manipulation disclosure itself is NOT hard-coded: it is
 * generated from the dimensions linked to the active study (name, description,
 * levels) plus this participant's own assigned level on each, so it stays
 * truthful if the factor structure changes (e.g. re-crossing complexity, or
 * dropping friction). Linked from Settings so participants can revisit it.
 */
export default async function DebriefPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) redirect("/login");

  const serviceClient = await createSupabaseServiceClient();
  const { data: profile } = await serviceClient
    .from("users")
    .select("id")
    .eq("auth_id", authUser.id)
    .is("deleted_at", null)
    .maybeSingle();

  const conditions = profile
    ? await getParticipantConditions(profile.id)
    : { study: null, dimensions: [] };

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Settings
      </Link>

      <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-gray-900 flex items-center gap-2 mb-4">
        <BookOpen className="w-6 h-6 text-brand" />
        About this research study
      </h1>

      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 space-y-4 text-sm text-gray-600">
        <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          Draft notice for the study team: this is placeholder debrief text. Replace it with the
          IRB-approved debrief before the study concludes.
        </p>
        <p>
          Thank you for taking part in this research study
          {conditions.study ? <> (<em>{conditions.study.name}</em>)</> : null}. The study looks at
          how people manage their privacy settings over time, and how the way those settings are
          first presented affects the choices people make.
        </p>
        <p>
          To study this fairly, different participants saw slightly different versions of the
          privacy experience. Each difference below was assigned at random and is the same kind of
          variation real apps use. None of them changed what you were able to control — only how
          the options were presented.
        </p>

        {conditions.dimensions.length > 0 ? (
          <section aria-labelledby="debrief-conditions-heading" className="space-y-3">
            <h2 id="debrief-conditions-heading" className="text-sm font-semibold text-gray-900">
              What varied, and which version you saw
            </h2>
            <ul className="space-y-3">
              {conditions.dimensions.map((d) => (
                <DimensionDisclosure key={d.name} dimension={d} />
              ))}
            </ul>
          </section>
        ) : (
          <p className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-600">
            We couldn&apos;t find a study condition linked to your account, so there is nothing
            specific to disclose here. If you believe you took part in the study, please contact
            the research team.
          </p>
        )}

        <p>
          Your individual responses are confidential and are reported only in aggregate,
          de-identified form. If you have questions about the study or wish to withdraw your data,
          please contact the research team.
        </p>

        <div className="border-t border-gray-100 pt-4">
          <WithdrawButton />
        </div>
      </div>
    </main>
  );
}

function DimensionDisclosure({ dimension }: { dimension: ConditionDimension }) {
  return (
    <li className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-2">
      <p className="font-semibold text-gray-900">{dimension.label}</p>
      {dimension.description && <p className="text-xs text-gray-600">{dimension.description}</p>}
      {dimension.levels.length > 0 && (
        <p className="text-xs text-gray-500">
          <span className="font-medium text-gray-700">Versions:</span>{" "}
          {dimension.levels.join(", ")}
        </p>
      )}
      <p className="text-sm text-gray-800">
        {dimension.assigned_level ? (
          <>
            You were in the <strong>{dimension.assigned_level}</strong> group.
          </>
        ) : (
          <>You were not assigned to a group for this factor.</>
        )}
      </p>
    </li>
  );
}
