"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  PROFILE_FIELDS, VISIBILITY_LABELS, CATEGORIES,
  type VisibilityLevel, type PrivacyTreatment,
  getDefaults,
} from "@/lib/utils/privacy";
import {
  logPrivacyEvent, diffVisibility, classifyChange, countOptionsShown,
} from "@/lib/utils/privacy-tracking";
import { computePrivacyIndex } from "@/lib/utils/privacy-index";

const VISIBILITY_LEVELS: VisibilityLevel[] = ["nobody", "team", "class", "everyone"];

// Baseline-survey gate (B2): the T1 timepoint must be answered after the
// participant has seen the controls but before the first save.
const GATE_TIMEPOINT = "T1";
const GATE_POLL_MS = 20_000;

interface PendingTriggerDelivery {
  delivery_id: string;
  survey_id: string;
  timepoint: string | null;
}

export default function PrivacySettingsPage() {
  const [visibility, setVisibility] = useState<Record<string, VisibilityLevel>>({});
  const [treatment, setTreatment] = useState<PrivacyTreatment>("moderate");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [ageBand] = useState("intermediate");

  // ── Friction manipulation (prospectus Factor B) ─────────────────
  // high: controls sit behind an extra "show controls" step, and protective
  // (tightening) saves require a confirmation with mildly discouraging framing.
  // low/unassigned: one prominent action, neutral labels — no extra steps.
  const [friction, setFriction] = useState<"low" | "high" | null>(null);
  const [controlsRevealed, setControlsRevealed] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // ── Baseline-survey gate (Workstream B / B2) ─────────────────────
  // Set only when the trigger endpoint reports a still-answerable T1 delivery
  // for THIS user; non-participants never get one, so the gate never blocks them.
  const [gateDeliveryId, setGateDeliveryId] = useState<string | null>(null);
  const gateBlockedLoggedRef = useRef(false);

  // ── Research instrumentation (Task A3) ──────────────────────────
  // Refs are initialized to inert values and populated in effects (never call
  // impure Date.now()/crypto during render).
  const openedAtRef = useRef<number>(0);
  const originalRef = useRef<Record<string, VisibilityLevel>>({}); // last saved/loaded state
  const currentRef = useRef<Record<string, VisibilityLevel>>({});  // latest in-flight state
  const clickCountRef = useRef(0);
  const abandonLoggedRef = useRef(false); // dedupe abandon across unmount + page-hide
  const treatmentRef = useRef<string>("moderate");
  const frictionRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string>("");

  // Keep a ref mirror of visibility so the unmount handler sees the latest value.
  useEffect(() => {
    currentRef.current = visibility;
  }, [visibility]);

  useEffect(() => {
    // Stable per-visit session id, set in an effect rather than during render.
    if (!sessionIdRef.current) {
      sessionIdRef.current =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : String(Date.now());
    }
    /** Fire the privacy_view survey trigger; gate on a pending T1 delivery. */
    async function triggerBaselineSurvey() {
      try {
        const res = await fetch("/api/v1/surveys/trigger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "privacy_view" }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { pending?: PendingTriggerDelivery[] };
        const t1 = (data.pending || []).find((p) => p.timepoint === GATE_TIMEPOINT);
        if (t1) setGateDeliveryId(t1.delivery_id);
      } catch {
        // Telemetry/gating must never break the page; no delivery → no gate.
      }
    }

    fetch("/api/v1/auth/me")
      .then((r) => r.json())
      .then(async (data) => {
        if (data.user) {
          // Get treatment from metadata
          const t = data.user.metadata?.privacy_treatment || "moderate";
          setTreatment(t);
          treatmentRef.current = t;

          // Friction condition: high-friction participants must take one extra
          // step before the controls render (each step is logged).
          const f = data.user.metadata?.privacy_friction ?? null;
          if (f === "low" || f === "high") {
            setFriction(f);
            frictionRef.current = f;
            if (f === "high") setControlsRevealed(false);
          }

          // Get existing visibility, else condition-aware defaults. For the
          // "neutral" default condition getDefaults returns {} → nothing is
          // pre-selected and the user must choose on first use.
          const existing = data.user.profile_visibility || {};
          const defaultCondition = data.user.metadata?.privacy_default ?? null;
          const loaded = { ...getDefaults(ageBand, defaultCondition), ...existing };
          setVisibility(loaded);
          originalRef.current = loaded;
          currentRef.current = loaded;
          openedAtRef.current = Date.now();

          // Log that the privacy surface was viewed (denominator for engagement).
          logPrivacyEvent({
            event_type: "privacy_view",
            page: "settings_privacy",
            session_id: sessionIdRef.current,
            metadata: {
              treatment: t,
              friction: f === "low" || f === "high" ? f : null,
              index: computePrivacyIndex(loaded),
              scheme: t,
              options_shown: countOptionsShown(t), // objective option count (B4)
            },
          });

          // Seeing the controls is the event that issues the T1 baseline (B2).
          void triggerBaselineSurvey();
        }
      })
      .catch(() => {});
  }, [ageBand]);

  /** Emit a survey-gate step on the privacy_field_touch channel (once each). */
  function logGateStep(step: "blocked" | "cleared") {
    logPrivacyEvent({
      event_type: "privacy_field_touch",
      page: "settings_privacy",
      session_id: sessionIdRef.current,
      metadata: {
        treatment: treatmentRef.current,
        friction: frictionRef.current,
        scope: `survey_gate:${step}`,
        fields: [],
      },
    });
  }

  // Log the block once per page view, the moment the gate engages.
  useEffect(() => {
    if (!gateDeliveryId || gateBlockedLoggedRef.current) return;
    gateBlockedLoggedRef.current = true;
    logGateStep("blocked");
  }, [gateDeliveryId]);

  // Re-check the gated delivery on focus/visibility and on a slow poll, so
  // returning from the survey re-enables Save without a reload.
  const recheckGate = useCallback(async () => {
    if (!gateDeliveryId) return;
    try {
      const res = await fetch(`/api/v1/surveys/${gateDeliveryId}/take`);
      if (!res.ok) {
        if (res.status === 404) setGateDeliveryId(null); // delivery gone → lift
        return;
      }
      const data = (await res.json()) as { delivery?: { status?: string } };
      const status = data.delivery?.status;
      if (status && status !== "pending" && status !== "opened") {
        setGateDeliveryId(null);
        logGateStep("cleared");
      }
    } catch {
      // keep current gate state on transient errors
    }
  }, [gateDeliveryId]);

  useEffect(() => {
    if (!gateDeliveryId) return;
    const onFocus = () => void recheckGate();
    const onVisible = () => {
      if (document.visibilityState === "visible") void recheckGate();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void recheckGate(), GATE_POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [gateDeliveryId, recheckGate]);

  // Log abandonment when the user leaves with unsaved edits. Covers SPA unmount
  // AND hard exits (tab close, backgrounding) that unmount alone misses, and also
  // captures the net-zero "fiddle then return to start" case (a reversal that
  // ends without saving), which the old handler dropped.
  useEffect(() => {
    function logAbandonIfDirty() {
      if (abandonLoggedRef.current) return;
      const deltas = diffVisibility(originalRef.current, currentRef.current);
      const netZeroFiddle = deltas.length === 0 && clickCountRef.current > 0;
      if (deltas.length === 0 && !netZeroFiddle) return; // truly untouched → nothing to log
      abandonLoggedRef.current = true;
      logPrivacyEvent({
        event_type: "privacy_abandon",
        page: "settings_privacy",
        old_value: originalRef.current,
        new_value: currentRef.current,
        duration_ms: Date.now() - openedAtRef.current,
        click_count: clickCountRef.current,
        session_id: sessionIdRef.current,
        metadata: {
          treatment: treatmentRef.current,
          friction: frictionRef.current,
          deltas,
          direction: classifyChange(deltas),
          reversed: netZeroFiddle, // fiddled, then left at the starting point
        },
      });
    }
    const onPageHide = () => logAbandonIfDirty();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") logAbandonIfDirty();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
      logAbandonIfDirty(); // SPA navigation away (unmount)
    };
  }, []);

  // Friction-funnel steps ride the privacy_field_touch event type (allowed by
  // the events endpoint) with a distinguishing scope, so the initiated→completed
  // flow — and where high-friction participants drop out — is reconstructable.
  function logFrictionStep(step: string) {
    logPrivacyEvent({
      event_type: "privacy_field_touch",
      page: "settings_privacy",
      session_id: sessionIdRef.current,
      metadata: { treatment: treatmentRef.current, friction: frictionRef.current, scope: `friction:${step}`, fields: [] },
    });
  }

  function revealControls() {
    clickCountRef.current += 1;
    setControlsRevealed(true);
    logFrictionStep("gate_opened");
  }

  /** Entry point for the Save button — may interpose the high-friction confirm. */
  function handleSave() {
    if (gateDeliveryId) return; // baseline survey outstanding (B2)
    const direction = classifyChange(diffVisibility(originalRef.current, currentRef.current));
    if (friction === "high" && (direction === "tighten" || direction === "mixed")) {
      clickCountRef.current += 1;
      setConfirmOpen(true);
      logFrictionStep("confirm_shown");
      return;
    }
    void doSave();
  }

  function confirmCancel() {
    clickCountRef.current += 1;
    setConfirmOpen(false);
    logFrictionStep("confirm_cancelled");
  }

  function confirmAccept() {
    clickCountRef.current += 1;
    setConfirmOpen(false);
    logFrictionStep("confirm_accepted");
    void doSave();
  }

  async function doSave() {
    setSaving(true);

    // The authoritative privacy_change event + index snapshot are written
    // server-side by the profile PUT (with condition context), so they can never
    // be lost to best-effort client telemetry. We pass the interaction timing the
    // server can't observe (how long the surface was open, how many clicks).
    await fetch("/api/v1/auth/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile_visibility: visibility,
        privacy_meta: {
          duration_ms: Date.now() - openedAtRef.current,
          click_count: clickCountRef.current,
          session_id: sessionIdRef.current,
        },
      }),
    });

    // Reset the baseline so subsequent saves diff from this saved state.
    originalRef.current = visibility;
    openedAtRef.current = Date.now();
    clickCountRef.current = 0;
    abandonLoggedRef.current = false;

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  // Emit a lightweight per-interaction "touch" so the intra-session toggle trail
  // (and true reversals) can be reconstructed, not just the net old→new diff.
  function logFieldTouch(scope: string, level: VisibilityLevel, fields: string[]) {
    logPrivacyEvent({
      event_type: "privacy_field_touch",
      page: "settings_privacy",
      session_id: sessionIdRef.current,
      metadata: { treatment: treatmentRef.current, scope, level, fields },
    });
  }

  function setFieldVisibility(key: string, level: VisibilityLevel) {
    clickCountRef.current += 1;
    abandonLoggedRef.current = false; // new activity → allow a fresh abandon log
    logFieldTouch("field", level, [key]);
    setVisibility((prev) => ({ ...prev, [key]: level }));
    setSaved(false);
  }

  function setCategoryVisibility(category: string, level: VisibilityLevel) {
    clickCountRef.current += 1;
    abandonLoggedRef.current = false;
    const fields = PROFILE_FIELDS.filter((f) => f.category === category);
    logFieldTouch(`category:${category}`, level, fields.map((f) => f.key));
    setVisibility((prev) => {
      const next = { ...prev };
      fields.forEach((f) => { next[f.key] = level; });
      return next;
    });
    setSaved(false);
  }

  function setMasterVisibility(level: VisibilityLevel) {
    clickCountRef.current += 1;
    abandonLoggedRef.current = false;
    logFieldTouch("master", level, PROFILE_FIELDS.map((f) => f.key));
    setVisibility((prev) => {
      const next = { ...prev };
      PROFILE_FIELDS.forEach((f) => { next[f.key] = level; });
      return next;
    });
    setSaved(false);
  }

  // Fields with no selection yet (only possible under the neutral default,
  // where getDefaults returns an empty map). Saving is blocked until complete
  // so the first logged choice is a full, deliberate configuration.
  const unsetCount = PROFILE_FIELDS.filter((f) => !visibility[f.key]).length;
  const surveyGated = gateDeliveryId !== null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-4">
      <h1 className="text-base font-bold text-gray-900 mb-1">Privacy Settings</h1>
      <p className="text-xs text-gray-500 mb-4">
        Choose who can see different parts of your profile. You can change these anytime.
      </p>

      {/* Educational intro */}
      <div className="rounded-lg bg-sky-50 border border-sky-200 p-3 mb-4">
        <p className="text-xs text-sky-800">
          <strong>Why privacy matters:</strong> Your personal information belongs to you.
          These settings let you decide who sees what. There are no wrong answers — just
          think about what you&apos;re comfortable sharing with different groups of people.
        </p>
      </div>

      {/* Baseline-survey gate (B2): non-dismissable until T1 is submitted. */}
      {surveyGated && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-violet-200 bg-violet-50 p-4 mb-4"
        >
          <p className="text-sm font-semibold text-violet-900 mb-1">
            One quick step first
          </p>
          <p className="text-xs text-violet-800 mb-3">
            Before you set your privacy options, answer a short questionnaire about them.
            It takes a couple of minutes, and your answers are private. Saving is turned on
            as soon as you finish.
          </p>
          <Link
            href={`/surveys/${gateDeliveryId}`}
            className="inline-block rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-700 transition"
          >
            Answer the questionnaire
          </Link>
        </div>
      )}

      {/* HIGH-friction gate: controls stay collapsed behind one more step. */}
      {!controlsRevealed && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 mb-6">
          <p className="text-sm text-gray-700 mb-1">
            Your profile is currently using your saved sharing preferences.
          </p>
          <p className="text-xs text-gray-500 mb-3">
            Most explorers keep the standard settings — sharing helps friends
            find you and keeps your crew growing.
          </p>
          <button
            onClick={revealControls}
            className="rounded-lg border border-gray-300 px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition"
          >
            Show advanced privacy controls
          </button>
        </div>
      )}

      {/* SIMPLE treatment: one master toggle */}
      {controlsRevealed && treatment === "simple" && (
        <div className="space-y-3 mb-6">
          <p className="text-sm font-medium text-gray-700">Who can see your profile?</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {VISIBILITY_LEVELS.map((level) => {
              const info = VISIBILITY_LABELS[level];
              const isActive = PROFILE_FIELDS.every((f) => visibility[f.key] === level);
              return (
                <button
                  key={level}
                  onClick={() => setMasterVisibility(level)}
                  className={`rounded-lg border p-3 text-center transition ${
                    isActive ? "border-sky-400 bg-sky-50 ring-2 ring-sky-200" : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <span className="text-2xl block mb-1">{info.icon}</span>
                  <span className="text-xs font-medium text-gray-900">{info.label}</span>
                  <p className="text-xs text-gray-600 mt-0.5">{info.description}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* MODERATE treatment: 3 categories × 3 levels */}
      {controlsRevealed && treatment === "moderate" && (
        <div className="space-y-4 mb-6">
          {CATEGORIES.map((cat) => {
            // Highlight a level only when every field in the category shares it;
            // if the fields disagree (mixed), highlight nothing rather than
            // misrepresenting the state with the first field's value.
            const fieldLevels = cat.fields.map((f) => visibility[f.key]);
            const allSame = fieldLevels.every((l) => l === fieldLevels[0]);
            const currentLevel = allSame ? fieldLevels[0] : null;

            return (
              <div key={cat.key} className="rounded-lg border border-gray-200 p-3">
                <p className="text-sm font-medium text-gray-900 mb-1">{cat.label}</p>
                <p className="text-xs text-gray-600 mb-2">
                  {cat.fields.map((f) => f.label).join(", ")}
                </p>
                <div className="flex gap-1.5">
                  {VISIBILITY_LEVELS.map((level) => {
                    const info = VISIBILITY_LABELS[level];
                    return (
                      <button
                        key={level}
                        onClick={() => setCategoryVisibility(cat.key, level)}
                        aria-pressed={currentLevel === level}
                        className={`flex-1 rounded px-2 py-2 text-xs transition ${
                          currentLevel === level
                            ? "bg-sky-100 text-sky-800 border border-sky-300"
                            : "bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100"
                        }`}
                      >
                        {info.icon} {info.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* COMPLEX treatment: per-field × 4 levels */}
      {controlsRevealed && treatment === "complex" && (
        <div className="space-y-2 mb-6">
          {PROFILE_FIELDS.map((field) => (
            <div key={field.key} className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <p className="text-sm font-medium text-gray-900">{field.label}</p>
                  <p className="text-xs text-gray-600">{field.description}</p>
                </div>
              </div>
              <div className="flex gap-1 mt-1.5">
                {VISIBILITY_LEVELS.map((level) => {
                  const info = VISIBILITY_LABELS[level];
                  return (
                    <button
                      key={level}
                      onClick={() => setFieldVisibility(field.key, level)}
                      aria-pressed={visibility[field.key] === level}
                      className={`flex-1 rounded px-1.5 py-1.5 text-xs transition ${
                        visibility[field.key] === level
                          ? "bg-sky-100 text-sky-800 border border-sky-300"
                          : "bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100"
                      }`}
                    >
                      {info.icon} {info.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-gray-600 mt-1 italic">{field.educationalTip}</p>
            </div>
          ))}
        </div>
      )}

      {/* Save button — a NEUTRAL-default participant starts with nothing selected
          and must make a complete first choice before saving (Workstream A / A10). */}
      {controlsRevealed && (
        <>
          {surveyGated && (
            <p className="text-xs text-violet-800 mb-2">
              Saving is disabled until you complete the short questionnaire above.
            </p>
          )}
          {unsetCount > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 mb-3">
              <p className="text-xs text-amber-800">
                Choose a setting for every item before saving — {unsetCount}{" "}
                {unsetCount === 1 ? "item still needs" : "items still need"} a choice.
              </p>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || unsetCount > 0 || surveyGated}
              title={surveyGated ? "Complete the questionnaire first" : undefined}
              className="bg-brand text-white rounded-lg hover:bg-brand-dark transition-colors px-6 py-2 text-sm font-medium disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Privacy Settings"}
            </button>
            {saved && <span className="text-xs text-green-600">Saved!</span>}
          </div>
        </>
      )}

      <p className="text-xs text-gray-500 mt-3">
        You can change these settings anytime from Settings → Privacy.
      </p>

      {/* HIGH-friction confirmation on protective changes (extra step + framing
          that mildly discourages restriction — disclosed at debrief). */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-gray-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="friction-confirm-title"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl p-5">
            <h2 id="friction-confirm-title" className="text-base font-bold text-gray-900 mb-2">
              Hide this information?
            </h2>
            <p className="text-sm text-gray-600 mb-1">
              Hiding parts of your profile can make it harder for friends and
              classmates to find you.
            </p>
            <p className="text-sm text-gray-600 mb-4">
              Explorers with visible profiles tend to grow their crew — and crew
              activity earns you points.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={confirmCancel}
                className="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark transition"
              >
                Keep sharing
              </button>
              <button
                onClick={confirmAccept}
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-medium text-gray-500 hover:bg-gray-50 transition"
              >
                Hide it anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
