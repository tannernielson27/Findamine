"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RATING_MAX, RATING_MIN, previewOrder, type Scheme } from "@/lib/utils/scheme-selection";
import { logPrivacyEvent } from "@/lib/utils/privacy-tracking";

export const SCHEME_COPY: Record<Scheme, { title: string; blurb: string }> = {
  simple: {
    title: "One switch",
    blurb: "A single setting decides who can see your whole profile.",
  },
  moderate: {
    title: "By category",
    blurb: "Three settings: who you are, how you're doing, and your connections.",
  },
  complex: {
    title: "Item by item",
    blurb: "A setting for each of the eight parts of your profile, plus rules for specific people.",
  },
};

const RATINGS = Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MIN + i);

export interface SchemePreviewSubmission {
  scheme?: Scheme;
  ratings: Record<Scheme, number>;
  display_order: Scheme[];
  dwell_ms: number;
}

interface SchemePreviewProps {
  /** Stable per participant (user id) so card order survives reloads. */
  seed: string;
  canChoose: boolean;
  submitting: boolean;
  error: string | null;
  /** Read at log time (the page keeps the session id in a ref). */
  getSessionId: () => string;
  onSubmit: (submission: SchemePreviewSubmission) => void;
}

/** Read-only sketch of a scheme's controls: rows of four level chips. */
function SchemeSketch({ scheme }: { scheme: Scheme }) {
  const rows = scheme === "simple" ? 1 : scheme === "moderate" ? 3 : 8;
  return (
    <div aria-hidden="true" className="rounded border border-gray-100 bg-gray-50 p-1.5 space-y-1">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-0.5">
          {scheme !== "simple" && <span className="h-1.5 w-5 rounded bg-gray-300" />}
          {[0, 1, 2, 3].map((c) => (
            <span
              key={c}
              className={`h-2 flex-1 rounded-sm ${c === 0 ? "bg-sky-200" : "border border-gray-200 bg-white"}`}
            />
          ))}
        </div>
      ))}
      {scheme === "complex" && <div className="h-2 rounded-sm border border-dashed border-gray-300" />}
    </div>
  );
}

/**
 * Storyline S2 (build plan C2): preview all three control schemes, rate the
 * expected utility of each, and — in the chosen arm — pick one.
 */
export default function SchemePreview({ seed, canChoose, submitting, error, getSessionId, onSubmit }: SchemePreviewProps) {
  const order = useMemo(() => previewOrder(seed), [seed]);
  const [ratings, setRatings] = useState<Partial<Record<Scheme, number>>>({});
  const [picked, setPicked] = useState<Scheme | null>(null);
  const shownAtRef = useRef(0);
  const submittedRef = useRef(false);
  const getSessionIdRef = useRef(getSessionId);

  // Dwell starts when the preview is on screen; leaving without submitting is logged.
  useEffect(() => {
    shownAtRef.current = Date.now();
    const readSessionId = getSessionIdRef.current;
    return () => {
      if (submittedRef.current) return;
      logPrivacyEvent({
        event_type: "privacy_field_touch",
        page: "settings_privacy",
        session_id: readSessionId(),
        metadata: { scope: "scheme_preview:left", fields: [], dwell_ms: Date.now() - shownAtRef.current },
      });
    };
  }, []);

  const allRated = order.every((s) => ratings[s] !== undefined);
  const ready = allRated && (!canChoose || picked !== null) && !submitting;

  function submit() {
    if (!ready) return;
    submittedRef.current = true;
    onSubmit({
      scheme: canChoose && picked ? picked : undefined,
      ratings: ratings as Record<Scheme, number>,
      display_order: order,
      dwell_ms: Date.now() - shownAtRef.current,
    });
  }

  return (
    <section aria-labelledby="scheme-preview-heading" className="mb-6">
      <h2 id="scheme-preview-heading" className="text-sm font-semibold text-gray-900 mb-1">
        {canChoose ? "How should your privacy controls work?" : "Three ways privacy controls can work"}
      </h2>
      <p className="text-xs text-gray-600 mb-3">
        Look at each option and rate how useful you expect it would be for you.
        {canChoose && " Then pick the one you want to use."}
      </p>

      <div className="space-y-3">
        {order.map((s) => {
          const copy = SCHEME_COPY[s];
          return (
            <fieldset
              key={s}
              className={`rounded-lg border p-3 transition ${
                canChoose && picked === s ? "border-sky-400 ring-2 ring-sky-100" : "border-gray-200"
              }`}
            >
              <legend className="sr-only">{copy.title}</legend>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">{copy.title}</p>
                  <p className="text-xs text-gray-600">{copy.blurb}</p>
                </div>
                <div className="w-20 shrink-0">
                  <SchemeSketch scheme={s} />
                </div>
              </div>

              <div className="mt-2" role="radiogroup" aria-label={`How useful would "${copy.title}" be for you?`}>
                <p className="text-[11px] text-gray-500 mb-1">How useful would these controls be for you?</p>
                <div className="flex gap-1">
                  {RATINGS.map((v) => (
                    <label key={v} className="flex-1">
                      <input
                        type="radio"
                        name={`rating-${s}`}
                        value={v}
                        checked={ratings[s] === v}
                        onChange={() => setRatings((prev) => ({ ...prev, [s]: v }))}
                        className="peer sr-only"
                      />
                      <span className="block cursor-pointer rounded border border-gray-200 bg-gray-50 py-1 text-center text-xs text-gray-700 transition hover:bg-gray-100 peer-checked:border-sky-300 peer-checked:bg-sky-100 peer-checked:text-sky-800 peer-focus-visible:ring-2 peer-focus-visible:ring-sky-300">
                        {v}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="mt-0.5 flex justify-between text-[10px] text-gray-500">
                  <span>Not at all useful</span>
                  <span>Extremely useful</span>
                </div>
              </div>

              {canChoose && (
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs font-medium text-gray-800">
                  <input
                    type="radio"
                    name="scheme-pick"
                    checked={picked === s}
                    onChange={() => setPicked(s)}
                    className="accent-sky-600"
                  />
                  Use these controls
                </label>
              )}
            </fieldset>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={!ready}
        className="mt-3 bg-brand text-white rounded-lg hover:bg-brand-dark transition-colors px-6 py-2 text-sm font-medium disabled:opacity-50"
      >
        {submitting ? "Saving..." : canChoose ? "Use the controls I picked" : "Continue"}
      </button>
    </section>
  );
}
