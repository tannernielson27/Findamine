"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import type { PrivacyNotice } from "@/lib/services/privacy-notice";

/** How long the notice stays up before it dismisses itself. */
const AUTO_DISMISS_MS = 8_000;

interface PrivacyNoticeToastProps {
  notice: PrivacyNotice;
  onClose: () => void;
}

type NoticeAction = "displayed" | "dismissed" | "clicked";

/** Fire-and-forget report to the notice-events endpoint. Never throws. */
function reportNoticeEvent(
  id: string | undefined,
  action: NoticeAction,
  extra: { dwell_ms?: number; auto?: boolean } = {}
): void {
  if (!id) return;
  void fetch(`/api/v1/research/notice-events/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
    keepalive: true, // survive the navigation a link click starts
  }).catch(() => {
    // telemetry must never block play
  });
}

/**
 * Just-in-time privacy notice shown after a completed find (storyline S6).
 * Sits at the bottom of the screen so it never covers the celebration toast
 * (top-right) or blocks the capture step. Logs display on mount, then exactly
 * one terminal action — a manual or automatic dismissal, or a link click —
 * with how long it was on screen.
 */
export function PrivacyNoticeToast({ notice, onClose }: PrivacyNoticeToastProps) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const shownAtRef = useRef(0);
  const settledRef = useRef(false);

  const settle = useCallback(
    (action: "dismissed" | "clicked", auto = false) => {
      if (settledRef.current) return false;
      settledRef.current = true;
      const dwell = shownAtRef.current ? Date.now() - shownAtRef.current : undefined;
      reportNoticeEvent(
        notice.id,
        action,
        action === "dismissed" ? { dwell_ms: dwell, auto } : { dwell_ms: dwell }
      );
      return true;
    },
    [notice.id]
  );

  useEffect(() => {
    shownAtRef.current = Date.now();
    reportNoticeEvent(notice.id, "displayed");
    const timer = window.setTimeout(() => {
      if (settle("dismissed", true)) onClose();
    }, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [notice.id, settle, onClose]);

  function handleClose() {
    if (settle("dismissed")) onClose();
  }

  function handleLink(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!notice.link) return;
    e.preventDefault();
    settle("clicked");
    onClose();
    router.push(notice.link.href);
  }

  return (
    <motion.div
      role="status"
      aria-live="polite"
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reducedMotion ? 0.15 : 0.25 }}
      className="fixed bottom-4 left-1/2 z-[55] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-lg"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="text-lg leading-none">🔒</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-gray-800">{notice.message}</p>
          {notice.link && (
            <a
              href={notice.link.href}
              onClick={handleLink}
              className="mt-1 inline-block text-xs font-semibold text-sky-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 rounded"
            >
              {notice.link.label}
            </a>
          )}
        </div>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Dismiss privacy notice"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </motion.div>
  );
}
