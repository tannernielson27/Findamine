"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";

const QUESTION_TYPES = [
  { value: "likert_5", label: "Likert (1–5)" },
  { value: "likert_7", label: "Likert (1–7)" },
  { value: "multiple_choice", label: "Multiple choice" },
  { value: "slider", label: "Slider" },
  { value: "free_text", label: "Free text" },
];

interface ScaleConfig {
  min?: number;
  max?: number;
  min_label?: string;
  max_label?: string;
  step?: number;
}

interface EditQ {
  item_code: string;
  question_text: string;
  question_type: string;
  subscale: string;
  reverse_coded: boolean;
  required: boolean;
  scale_config: ScaleConfig;
  options: string[];
}

interface SurveyMeta {
  id: string;
  title: string;
  description: string | null;
  status: string;
}

function normalizeOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options.map((o) =>
    o && typeof o === "object" && "value" in o ? String((o as { value: unknown }).value) : String(o)
  );
}

function blankQuestion(index: number): EditQ {
  return {
    item_code: `item_${index + 1}`,
    question_text: "",
    question_type: "likert_5",
    subscale: "",
    reverse_coded: false,
    required: true,
    scale_config: { min: 1, max: 5, min_label: "Strongly disagree", max_label: "Strongly agree" },
    options: [],
  };
}

const isScale = (t: string) => t === "likert_5" || t === "likert_7" || t === "slider";

export default function SurveyEditorPage() {
  const params = useParams<{ id: string }>();
  const surveyId = params.id;

  const [meta, setMeta] = useState<SurveyMeta | null>(null);
  const [questions, setQuestions] = useState<EditQ[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (!surveyId) return;
    Promise.all([
      fetch(`/api/v1/surveys/${surveyId}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/v1/surveys/${surveyId}/questions`).then((r) => (r.ok ? r.json() : { questions: [] })),
    ])
      .then(([surveyData, qData]) => {
        if (surveyData?.survey) setMeta(surveyData.survey);
        const loaded: EditQ[] = (qData.questions || []).map((q: Record<string, unknown>) => ({
          item_code: String(q.item_code ?? ""),
          question_text: String(q.question_text ?? ""),
          question_type: String(q.question_type ?? "likert_5"),
          subscale: q.subscale ? String(q.subscale) : "",
          reverse_coded: Boolean(q.reverse_coded),
          required: q.required === undefined ? true : Boolean(q.required),
          scale_config: (q.scale_config as ScaleConfig) || {},
          options: normalizeOptions(q.options),
        }));
        setQuestions(loaded);
      })
      .catch(() => setQuestions([]));
  }, [surveyId]);

  function update(i: number, patch: Partial<EditQ>) {
    setQuestions((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
    setMessage(null);
  }

  function updateScale(i: number, patch: Partial<ScaleConfig>) {
    setQuestions((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[i] = { ...next[i], scale_config: { ...next[i].scale_config, ...patch } };
      return next;
    });
  }

  function addQuestion() {
    setQuestions((prev) => [...(prev || []), blankQuestion((prev || []).length)]);
  }

  function removeQuestion(i: number) {
    setQuestions((prev) => (prev ? prev.filter((_, idx) => idx !== i) : prev));
  }

  function move(i: number, dir: -1 | 1) {
    setQuestions((prev) => {
      if (!prev) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    if (!questions) return;
    setSaving(true);
    setMessage(null);
    const payload = {
      questions: questions.map((q) => ({
        item_code: q.item_code.trim(),
        question_text: q.question_text.trim(),
        question_type: q.question_type,
        subscale: q.subscale.trim() || null,
        reverse_coded: q.reverse_coded,
        required: q.required,
        scale_config: isScale(q.question_type) ? q.scale_config : {},
        options: q.question_type === "multiple_choice" ? q.options.filter((o) => o.trim()) : [],
      })),
    };
    const res = await fetch(`/api/v1/surveys/${surveyId}/questions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (res.ok) {
      setMessage({ kind: "ok", text: "Saved." });
    } else {
      const err = await res.json().catch(() => ({}));
      setMessage({ kind: "err", text: err.error || "Failed to save." });
    }
  }

  if (questions === null) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-4">
        <div className="animate-pulse space-y-3">
          <div className="h-6 w-48 bg-gray-100 rounded" />
          <div className="h-40 bg-gray-100 rounded-lg" />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-4">
      <Link href="/admin/surveys" className="text-sm text-brand hover:underline mb-4 inline-block">
        &larr; Surveys
      </Link>

      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-lg font-semibold text-gray-900">{meta?.title || "Survey"}</h1>
        {meta && (
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600">
            {meta.status}
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-2">
        Each item&apos;s <code className="text-xs">item_code</code> keys the stored answer, and{" "}
        <code className="text-xs">subscale</code> groups items for scoring (e.g. all fatigue items
        share one subscale). Reverse-coded items are flipped automatically at scoring time.
      </p>
      <p className="text-xs text-gray-400 mb-5">
        Replace any placeholder wording with the validated scale items before activating this survey.
      </p>

      <div className="space-y-4">
        {questions.map((q, i) => (
          <div key={i} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-gray-400">Q{i + 1}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Move up">
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button onClick={() => move(i, 1)} disabled={i === questions.length - 1} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Move down">
                  <ArrowDown className="w-4 h-4" />
                </button>
                <button onClick={() => removeQuestion(i)} className="p-1 text-red-400 hover:text-red-600" title="Remove">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <textarea
              value={q.question_text}
              onChange={(e) => update(i, { question_text: e.target.value })}
              rows={2}
              placeholder="Question text..."
              className="mb-3 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-xs text-gray-500">
                Item code
                <input
                  value={q.item_code}
                  onChange={(e) => update(i, { item_code: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
                />
              </label>
              <label className="text-xs text-gray-500">
                Type
                <select
                  value={q.question_type}
                  onChange={(e) => update(i, { question_type: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
                >
                  {QUESTION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-gray-500">
                Subscale
                <input
                  value={q.subscale}
                  onChange={(e) => update(i, { subscale: e.target.value })}
                  placeholder="e.g. privacy_fatigue"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
                />
              </label>
            </div>

            {isScale(q.question_type) && (
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <label className="text-xs text-gray-500">
                  Min
                  <input
                    type="number"
                    value={q.scale_config.min ?? ""}
                    onChange={(e) => updateScale(i, { min: e.target.value === "" ? undefined : Number(e.target.value) })}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
                  />
                </label>
                <label className="text-xs text-gray-500">
                  Max
                  <input
                    type="number"
                    value={q.scale_config.max ?? ""}
                    onChange={(e) => updateScale(i, { max: e.target.value === "" ? undefined : Number(e.target.value) })}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
                  />
                </label>
                <label className="text-xs text-gray-500">
                  Min label
                  <input
                    value={q.scale_config.min_label ?? ""}
                    onChange={(e) => updateScale(i, { min_label: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
                  />
                </label>
                <label className="text-xs text-gray-500">
                  Max label
                  <input
                    value={q.scale_config.max_label ?? ""}
                    onChange={(e) => updateScale(i, { max_label: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
                  />
                </label>
              </div>
            )}

            {q.question_type === "multiple_choice" && (
              <label className="mt-3 block text-xs text-gray-500">
                Options (one per line)
                <textarea
                  value={q.options.join("\n")}
                  onChange={(e) => update(i, { options: e.target.value.split("\n") })}
                  rows={3}
                  placeholder={"Option A\nOption B\nOption C"}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
                />
              </label>
            )}

            <div className="mt-3 flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={q.required} onChange={(e) => update(i, { required: e.target.checked })} />
                Required
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={q.reverse_coded} onChange={(e) => update(i, { reverse_coded: e.target.checked })} />
                Reverse-coded
              </label>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addQuestion}
        className="mt-4 flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-600 hover:border-gray-400 hover:bg-gray-50"
      >
        <Plus className="w-4 h-4" />
        Add question
      </button>

      <div className="sticky bottom-0 mt-6 flex items-center gap-3 border-t border-gray-100 bg-white/90 backdrop-blur py-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-brand px-6 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save questions"}
        </button>
        {message && (
          <span className={`text-sm ${message.kind === "ok" ? "text-green-600" : "text-red-600"}`}>
            {message.text}
          </span>
        )}
      </div>
    </main>
  );
}
