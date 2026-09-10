"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ClipboardList, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";

type AnswerValue = number | string;

interface Question {
  item_code: string;
  question_text: string;
  question_type: string;
  options: unknown;
  scale_config: Record<string, unknown> | null;
  subscale: string | null;
  sort_order: number;
  required: boolean;
}

interface Survey {
  id: string;
  title: string;
  description: string | null;
}

interface TakeData {
  delivery: { id: string; status: string };
  survey: Survey | null;
  questions: Question[];
}

/** Normalize a multiple_choice `options` value into {value,label} pairs. */
function normalizeOptions(options: unknown): { value: string; label: string }[] {
  if (!Array.isArray(options)) return [];
  return options.map((o) => {
    if (o && typeof o === "object" && "value" in o) {
      const obj = o as { value: unknown; label?: unknown };
      return { value: String(obj.value), label: String(obj.label ?? obj.value) };
    }
    return { value: String(o), label: String(o) };
  });
}

function scaleBounds(q: Question): { min: number; max: number } {
  const cfg = q.scale_config || {};
  const min = typeof cfg.min === "number" ? cfg.min : 1;
  const fallbackMax = q.question_type === "likert_7" ? 7 : 5;
  const max = typeof cfg.max === "number" ? cfg.max : fallbackMax;
  return { min, max };
}

export default function TakeSurveyPage() {
  const params = useParams<{ deliveryId: string }>();
  const router = useRouter();
  const deliveryId = params.deliveryId;

  const [data, setData] = useState<TakeData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const openedRef = useRef(false);

  useEffect(() => {
    if (!deliveryId) return;
    fetch(`/api/v1/surveys/${deliveryId}/take`)
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(r.status === 404 ? "This survey isn't available." : "Could not load survey.");
        }
        return r.json();
      })
      .then((d: TakeData) => {
        setData(d);
        if (d.delivery.status === "submitted") setSubmitted(true);
        // Mark opened once (pending → opened). Fire-and-forget; never blocks the UI.
        if (!openedRef.current && d.delivery.status === "pending") {
          openedRef.current = true;
          fetch(`/api/v1/surveys/${deliveryId}/open`, { method: "POST" }).catch(() => {});
        }
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load survey."));
  }, [deliveryId]);

  function setAnswer(itemCode: string, value: AnswerValue) {
    setAnswers((prev) => ({ ...prev, [itemCode]: value }));
    setMissing((prev) => {
      if (!prev.has(itemCode)) return prev;
      const next = new Set(prev);
      next.delete(itemCode);
      return next;
    });
  }

  function isAnswered(q: Question): boolean {
    const v = answers[q.item_code];
    if (v === undefined || v === null) return false;
    if (typeof v === "string") return v.trim().length > 0;
    return true;
  }

  async function handleSubmit() {
    if (!data) return;
    const unanswered = data.questions.filter((q) => q.required && !isAnswered(q));
    if (unanswered.length > 0) {
      const codes = new Set(unanswered.map((q) => q.item_code));
      setMissing(codes);
      // Scroll to the first unanswered required question.
      const first = document.getElementById(`q-${unanswered[0].item_code}`);
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setSubmitting(true);
    const res = await fetch(`/api/v1/surveys/${deliveryId}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    setSubmitting(false);

    if (res.ok || res.status === 409) {
      setSubmitted(true);
    } else {
      setLoadError("Something went wrong submitting your answers. Please try again.");
    }
  }

  // ── States ──────────────────────────────────────────────────────
  if (loadError && !data) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 text-center">
        <AlertCircle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-700">{loadError}</p>
        <Link href="/surveys" className="inline-block mt-4 text-sm font-medium text-brand hover:underline">
          Back to surveys
        </Link>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-gray-100 rounded-xl" />
          <div className="h-32 bg-gray-100 rounded-2xl" />
          <div className="h-32 bg-gray-100 rounded-2xl" />
        </div>
      </main>
    );
  }

  if (submitted) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 text-center">
        <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-gray-900">
          Thank you!
        </h1>
        <p className="text-sm text-gray-500 mt-1">Your response has been recorded.</p>
        <button
          onClick={() => router.push("/surveys")}
          className="inline-block mt-5 rounded-xl bg-brand px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark transition-all"
        >
          Back to surveys
        </button>
      </main>
    );
  }

  const questions = [...data.questions].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Link
        href="/surveys"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Surveys
      </Link>

      <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-gray-900 flex items-center gap-2 mb-1">
        <ClipboardList className="w-6 h-6 text-brand" />
        {data.survey?.title || "Survey"}
      </h1>
      {data.survey?.description && (
        <p className="text-sm text-gray-500 mb-6">{data.survey.description}</p>
      )}

      {questions.length === 0 ? (
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 text-center text-sm text-gray-500">
          This survey has no questions yet. Please check back later.
        </div>
      ) : (
        <div className="space-y-4">
          {questions.map((q, i) => (
            <QuestionCard
              key={q.item_code}
              q={q}
              index={i + 1}
              value={answers[q.item_code]}
              missing={missing.has(q.item_code)}
              onChange={(v) => setAnswer(q.item_code, v)}
            />
          ))}

          {missing.size > 0 && (
            <p className="text-sm text-red-600 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4" />
              Please answer the highlighted question{missing.size === 1 ? "" : "s"} before submitting.
            </p>
          )}
          {loadError && (
            <p className="text-sm text-red-600 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4" />
              {loadError}
            </p>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50 transition-all"
          >
            {submitting ? "Submitting..." : "Submit response"}
          </button>
        </div>
      )}
    </main>
  );
}

// ── Question renderer ───────────────────────────────────────────────
function QuestionCard({
  q,
  index,
  value,
  missing,
  onChange,
}: {
  q: Question;
  index: number;
  value: AnswerValue | undefined;
  missing: boolean;
  onChange: (v: AnswerValue) => void;
}) {
  return (
    <div
      id={`q-${q.item_code}`}
      className={`rounded-2xl bg-white border shadow-sm p-5 transition-colors ${
        missing ? "border-red-300 ring-2 ring-red-100" : "border-gray-100"
      }`}
    >
      <p className="text-sm font-medium text-gray-900 mb-3">
        <span className="text-gray-400 mr-1.5">{index}.</span>
        {q.question_text}
        {q.required && <span className="text-red-400 ml-1" aria-hidden>*</span>}
      </p>
      <QuestionInput q={q} value={value} onChange={onChange} />
    </div>
  );
}

function QuestionInput({
  q,
  value,
  onChange,
}: {
  q: Question;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue) => void;
}) {
  const cfg = q.scale_config || {};

  if (q.question_type === "likert_5" || q.question_type === "likert_7") {
    const { min, max } = scaleBounds(q);
    const points: number[] = [];
    for (let n = min; n <= max; n++) points.push(n);
    const minLabel = typeof cfg.min_label === "string" ? cfg.min_label : "Strongly disagree";
    const maxLabel = typeof cfg.max_label === "string" ? cfg.max_label : "Strongly agree";
    return (
      <div>
        <div
          role="radiogroup"
          aria-label={q.question_text}
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
        >
          {points.map((n) => {
            const active = value === n;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange(n)}
                className={`rounded-lg border py-2.5 text-sm font-medium transition ${
                  active
                    ? "border-brand bg-brand text-white shadow-sm"
                    : "border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 hover:bg-gray-100"
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>
        <div className="flex justify-between text-[11px] text-gray-400 mt-1.5 px-0.5">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      </div>
    );
  }

  if (q.question_type === "multiple_choice") {
    const opts = normalizeOptions(q.options);
    return (
      <div role="radiogroup" aria-label={q.question_text} className="space-y-2">
        {opts.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                active
                  ? "border-brand bg-brand/5 text-gray-900"
                  : "border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300 hover:bg-gray-100"
              }`}
            >
              <span
                className={`grid h-4 w-4 place-items-center rounded-full border shrink-0 ${
                  active ? "border-brand" : "border-gray-300"
                }`}
              >
                {active && <span className="h-2 w-2 rounded-full bg-brand" />}
              </span>
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }

  if (q.question_type === "slider") {
    const { min, max } = scaleBounds(q);
    const step = typeof cfg.step === "number" ? cfg.step : 1;
    const current = typeof value === "number" ? value : Math.round((min + max) / 2);
    return (
      <div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={current}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full accent-brand"
          aria-label={q.question_text}
        />
        <div className="text-center text-sm font-medium text-gray-700 mt-1">{current}</div>
      </div>
    );
  }

  // free_text (and any other type fall back to a text box)
  return (
    <textarea
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      rows={3}
      aria-label={q.question_text}
      className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm focus:bg-white focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 transition-all"
      placeholder="Type your answer..."
    />
  );
}
