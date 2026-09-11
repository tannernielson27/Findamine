"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import {
  ONBOARDING_MILESTONE,
  stepsForRole,
  onboardingDestination,
  finalCtaLabel,
} from "@/lib/onboarding/steps";

interface OnboardingProps {
  role?: string;
}

export default function Onboarding({ role }: OnboardingProps) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);
  const modalRef = useRef<HTMLDivElement>(null);

  const steps = stepsForRole(role);
  const destination = onboardingDestination(role);
  const finalCta = finalCtaLabel(role);

  useEffect(() => {
    // localStorage is the fast path; the API is authoritative.
    if (localStorage.getItem("onboarding_complete") === "true") return;

    async function check() {
      try {
        const res = await fetch("/api/v1/onboarding");
        if (res.ok) {
          const data = await res.json();
          const done =
            data.onboarding_complete ||
            (data.milestones || []).some(
              (m: { milestone_type: string }) =>
                m.milestone_type === ONBOARDING_MILESTONE
            );
          if (done) {
            localStorage.setItem("onboarding_complete", "true");
          } else {
            setShow(true);
          }
        }
      } catch {
        // If the API fails, don't block the UI with a tutorial.
      }
    }
    check();
  }, []);

  const recordComplete = useCallback(async () => {
    localStorage.setItem("onboarding_complete", "true");
    try {
      await fetch("/api/v1/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ milestone_type: ONBOARDING_MILESTONE }),
      });
    } catch {
      // localStorage already set — dismissal sticks even if the API call fails.
    }
  }, []);

  // Skip / Escape: dismiss without routing the user away.
  const handleSkip = useCallback(() => {
    setShow(false);
    recordComplete();
  }, [recordComplete]);

  // Finish: dismiss AND propel the user into their first fun moment.
  const handleFinish = useCallback(() => {
    setShow(false);
    recordComplete();
    router.push(destination);
  }, [recordComplete, router, destination]);

  // Escape key + focus trap
  useEffect(() => {
    if (!show) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleSkip();
        return;
      }
      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    modalRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [show, handleSkip]);

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    } else {
      handleFinish();
    }
  };

  if (!show) return null;

  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--color-text,#111827)]/50 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome tour"
    >
      <AnimatePresence mode="wait">
        <motion.div
          ref={modalRef}
          key={step}
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md overflow-hidden rounded-3xl bg-[var(--color-surface,#fff)] shadow-2xl ring-1 ring-themed-border"
        >
          {/* Banner: brand wash with the step icon */}
          <div className="relative bg-gradient-to-br from-brand-light via-brand to-brand-dark px-6 pt-8 pb-10 text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-white/90 text-5xl shadow-lg">
              <span aria-hidden="true">{current.icon}</span>
            </div>
            <p className="mt-3 font-[family-name:var(--font-handwritten)] text-2xl text-white/90">
              {isLast ? "last one!" : `step ${step + 1} of ${steps.length}`}
            </p>
          </div>

          <div className="px-7 pb-7 pt-6">
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold text-themed-text">
              {current.title}
            </h2>
            <p className="mt-2 text-[15px] leading-relaxed text-themed-muted">{current.body}</p>

            {/* Step indicator */}
            <div className="mt-6 mb-5 flex justify-center gap-1.5" aria-hidden="true">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === step
                      ? "w-7 bg-brand"
                      : i < step
                      ? "w-2 bg-brand/60"
                      : "w-2 bg-themed-border"
                  }`}
                />
              ))}
            </div>

            <div className="flex gap-3">
              {step > 0 && (
                <button
                  onClick={() => setStep(step - 1)}
                  className="flex-1 rounded-xl border border-themed-border px-4 py-2.5 text-sm font-medium text-themed-muted transition-colors hover:bg-themed-bg"
                >
                  Back
                </button>
              )}
              <button
                onClick={handleNext}
                className="flex-1 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-dark active:scale-[0.98]"
              >
                {isLast ? finalCta : "Next"}
              </button>
            </div>

            <button
              onClick={handleSkip}
              className="mt-3 block w-full text-center text-xs text-themed-muted hover:text-themed-text"
            >
              Skip the tour
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
