"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";

/**
 * Informed-consent gate for the research study (IRB requirement).
 *
 * Shown once, on first authenticated load, to study-eligible participants who
 * have not yet made a research-consent decision. Consent is the server-side
 * precondition for enrollment/randomization (see lib/services/enrollment.ts),
 * so nothing about the study happens until the participant decides here.
 *
 * ⚠️ The consent + debrief text below is PLACEHOLDER copy. Replace it with the
 * IRB-approved informed-consent language before running the study, and bump
 * CONSENT_FORM_VERSION whenever the approved wording changes.
 */

const CONSENT_FORM_VERSION = "0.1-placeholder";

interface ConsentRecord {
  consent_type: string;
  granted: boolean;
}

export default function ConsentGate() {
  const router = useRouter();
  const [needsDecision, setNeedsDecision] = useState<boolean | null>(null);
  const [signature, setSignature] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decidedRef = useRef(false);

  useEffect(() => {
    fetch("/api/v1/consent")
      .then((r) => (r.ok ? r.json() : { consent_records: [] }))
      .then((data) => {
        const records: ConsentRecord[] = data.consent_records || [];
        const hasResearchDecision = records.some((r) => r.consent_type === "research");
        setNeedsDecision(!hasResearchDecision);
      })
      .catch(() => setNeedsDecision(false)); // fail open: never trap the user in a broken gate
  }, []);

  async function decide(granted: boolean) {
    if (decidedRef.current) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/v1/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        consent_type: "research",
        granted,
        form_version: CONSENT_FORM_VERSION,
        signature_name: granted ? signature.trim() || null : null,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError("Something went wrong recording your choice. Please try again.");
      return;
    }
    decidedRef.current = true;
    setNeedsDecision(false);
    // A grant makes the user enrollment-eligible; refresh so the server layout
    // re-runs enrollment and assigns their condition.
    if (granted) router.refresh();
  }

  if (needsDecision !== true) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-title"
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="p-6">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="w-6 h-6 text-brand" />
            <h2 id="consent-title" className="text-lg font-bold text-gray-900">
              Research participation
            </h2>
          </div>

          {/* PLACEHOLDER consent copy — replace with IRB-approved language. */}
          <div className="space-y-3 text-sm text-gray-600">
            <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
              Draft notice for the study team: this is placeholder consent text. Replace it with the
              IRB-approved informed-consent form before the study runs.
            </p>
            <p>
              Findamine is part of a research study on how people manage privacy settings over time.
              If you take part, the app will record how you use its privacy controls and will ask you
              to complete a few short surveys.
            </p>
            <p>
              Participation is voluntary and open to adults (18+). You may withdraw at any time, and
              your choice will not affect your standing in any class. Your data are stored securely
              and reported only in aggregate, de-identified form.
            </p>
            <p>
              By selecting <strong>I consent</strong>, you confirm that you are 18 or older and agree
              to take part. If you select <strong>I do not consent</strong>, you can still use
              Findamine normally and no study data will be collected about you.
            </p>
          </div>

          <label className="mt-4 block text-xs text-gray-500">
            Type your name to sign (optional)
            <input
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:bg-white focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              placeholder="Your name"
            />
          </label>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button
              onClick={() => decide(false)}
              disabled={submitting}
              className="rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              I do not consent
            </button>
            <button
              onClick={() => decide(true)}
              disabled={submitting}
              className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
            >
              {submitting ? "Saving..." : "I consent"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
