"use client";

import { useState } from "react";

/**
 * Lets a participant withdraw from the research study (consent promise). After
 * withdrawal their data is excluded from collection/export; the app keeps working.
 */
export default function WithdrawButton() {
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");

  async function withdraw() {
    setState("working");
    const res = await fetch("/api/v1/research/withdraw", { method: "POST" });
    setState(res.ok ? "done" : "error");
    setConfirming(false);
  }

  if (state === "done") {
    return (
      <p className="text-sm text-green-700">
        You&apos;ve been withdrawn from the study. Your data will no longer be collected or included
        in analysis. Thanks for giving it a try — you can keep using Findamine as usual.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="text-sm font-medium text-red-600 hover:underline"
        >
          Withdraw from the study
        </button>
      ) : (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-gray-700 mb-2">
            Withdraw from the research study? Your study data won&apos;t be collected or analyzed
            after this. You can keep playing Findamine normally.
          </p>
          <div className="flex gap-2">
            <button
              onClick={withdraw}
              disabled={state === "working"}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {state === "working" ? "Withdrawing..." : "Yes, withdraw"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
          {state === "error" && (
            <p className="mt-2 text-sm text-red-600">Something went wrong. Please try again.</p>
          )}
        </div>
      )}
    </div>
  );
}
