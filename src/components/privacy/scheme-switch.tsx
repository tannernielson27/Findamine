"use client";

import { useState } from "react";
import { SCHEMES, type Scheme } from "@/lib/utils/scheme-selection";
import { SCHEME_COPY } from "@/components/privacy/scheme-preview";

interface SchemeSwitchProps {
  current: Scheme;
  busy: boolean;
  error: string | null;
  onOpen: () => void;
  onCancel: () => void;
  onConfirm: (scheme: Scheme) => void;
}

/**
 * Storyline S2 (build plan C2): the one-time "change how your privacy
 * controls work" offer. Opening, cancelling and confirming are all logged by
 * the page, since a request to switch is an outcome in itself.
 */
export default function SchemeSwitch({ current, busy, error, onOpen, onCancel, onConfirm }: SchemeSwitchProps) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Scheme | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          onOpen();
        }}
        className="mt-3 text-xs text-sky-700 underline underline-offset-2 hover:text-sky-900"
      >
        Change how your privacy controls work
      </button>
    );
  }

  return (
    <section aria-labelledby="scheme-switch-heading" className="mt-3 rounded-lg border border-gray-200 p-3">
      <p id="scheme-switch-heading" className="text-sm font-medium text-gray-900">
        Change how your privacy controls work
      </p>
      <p className="text-xs text-gray-600 mb-2">You can do this once. Your current settings carry over.</p>
      <div className="space-y-1.5" role="radiogroup" aria-labelledby="scheme-switch-heading">
        {SCHEMES.filter((s) => s !== current).map((s) => (
          <label
            key={s}
            className={`flex cursor-pointer items-start gap-2 rounded border p-2 text-xs transition ${
              picked === s ? "border-sky-300 bg-sky-50" : "border-gray-200 hover:bg-gray-50"
            }`}
          >
            <input
              type="radio"
              name="scheme-switch"
              checked={picked === s}
              onChange={() => setPicked(s)}
              className="mt-0.5 accent-sky-600"
            />
            <span>
              <span className="block font-medium text-gray-900">{SCHEME_COPY[s].title}</span>
              <span className="text-gray-600">{SCHEME_COPY[s].blurb}</span>
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={!picked || busy}
          onClick={() => picked && onConfirm(picked)}
          className="rounded-lg bg-brand px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-dark transition disabled:opacity-50"
        >
          {busy ? "Switching..." : "Switch controls"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setPicked(null);
            onCancel();
          }}
          className="rounded-lg border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
