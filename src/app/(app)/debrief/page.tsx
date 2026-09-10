import Link from "next/link";
import { BookOpen, ArrowLeft } from "lucide-react";
import WithdrawButton from "@/components/research/withdraw-button";

/**
 * Study debrief surface.
 *
 * ⚠️ PLACEHOLDER copy. Replace with the IRB-approved debrief that discloses the
 * study's manipulations — the privacy default starting position (private/neutral/
 * public) and the change-friction condition (low/high: navigation prominence and
 * the confirmation step with discouraging framing on protective changes) — and
 * its purpose, after data collection. Linked from Settings so participants can
 * revisit it.
 */
export default function DebriefPage() {
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
          Thank you for taking part in this research study. The study looks at how people manage
          their privacy settings over time, and how the way those settings are first presented
          affects the choices people make.
        </p>
        <p>
          To study this fairly, different participants saw slightly different versions of the
          privacy experience: your settings started from a randomly assigned position (more private,
          more public, or unset), and for some participants the settings were easier or harder to
          reach and change — for example, an extra confirmation step, or wording that gently
          discouraged hiding information. These differences were assigned at random and are the
          same kinds of variation real apps use. They never changed what you were able to control —
          only how the options were presented.
        </p>
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
