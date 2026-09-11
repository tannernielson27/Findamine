"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { countOverrides, type VisibilityOverrides } from "@/lib/utils/privacy";
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
import SchemePreview, { type SchemePreviewSubmission } from "@/components/privacy/scheme-preview";
import SchemeSwitch from "@/components/privacy/scheme-switch";
import { schemeSelectionState, type Scheme, type SchemeSelectionState } from "@/lib/utils/scheme-selection";
import {
  fetchBaselineGate, fetchNormLine, fetchOverridePeople, postSchemeChoice,
  type NormLineData, type OverridePerson,
} from "./privacy-page-data";

const VISIBILITY_LEVELS: VisibilityLevel[] = ["nobody", "team", "class", "everyone"];

/** How the participant arrived: an S4 check-in or an S6 score notice (`?from=`). */
const ENTRY_SOURCES = ["checkin", "notice"] as const;

type OverrideChoice = "inherit" | "see" | "hidden";
const OVERRIDE_CHOICES: { value: OverrideChoice; label: string }[] = [
  { value: "inherit", label: "General" },
  { value: "see", label: "Can see" },
  { value: "hidden", label: "Hidden" },
];

// Baseline-survey gate (B2): the T1 timepoint must be answered after the
// participant has seen the controls but before the first save.
const GATE_TIMEPOINT = "T1";
const GATE_POLL_MS = 20_000;

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

  // ── Scheme preview / switch (S2, migration 060) and norm line (S5, 062) ──
  // All inert unless the participant holds a level on those dimensions.
  const [selection, setSelection] = useState<SchemeSelectionState | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [schemeBusy, setSchemeBusy] = useState(false);
  const [schemeError, setSchemeError] = useState<string | null>(null);
  const [normLine, setNormLine] = useState<NormLineData | null>(null);
  const [userId, setUserId] = useState("");

  // Per-person overrides (migration 057) — the 2014 "High" tier layer. Only
  // rendered under the `complex` scheme; `people` are the accepted friends and
  // crew members a rule can apply to.
  const [overrides, setOverrides] = useState<VisibilityOverrides>({});
  const [people, setPeople] = useState<OverridePerson[]>([]);
  const overridesRef = useRef<VisibilityOverrides>({});
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
  const userIdRef = useRef<string>("");
  const normExposureIdRef = useRef<string | null>(null);
  const entrySourceRef = useRef<string | null>(null);

  /**
   * Log that a control scheme is on screen (the engagement denominator, with
   * the objective option count, B4) and, unless this is a switch, issue the
   * T1 baseline (B2). Deferred until after the S2 preview when there is one.
   */
  const announceView = useCallback(
    async (scheme: string, reason: "load" | "after_preview" | "after_switch") => {
      let peopleListed = 0;
      if (scheme === "complex" && userIdRef.current) {
        const list = await fetchOverridePeople(userIdRef.current);
        setPeople(list);
        peopleListed = list.length;
      }
      logPrivacyEvent({
        event_type: "privacy_view",
        page: "settings_privacy",
        session_id: sessionIdRef.current,
        norm_exposure_id: normExposureIdRef.current,
        metadata: {
          treatment: scheme,
          friction: frictionRef.current,
          index: computePrivacyIndex(originalRef.current),
          scheme,
          options_shown: countOptionsShown(scheme, peopleListed), // objective option count (B4 + C1)
          people_listed: peopleListed,
          override_count: countOverrides(overridesRef.current),
          view_reason: reason,
          entry_source: entrySourceRef.current,
        },
      });
      if (reason === "after_switch") return;
      const gate = await fetchBaselineGate(GATE_TIMEPOINT);
      if (gate) setGateDeliveryId(gate);
    },
    []
  );

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
    const from = new URLSearchParams(window.location.search).get("from");
    entrySourceRef.current = from && (ENTRY_SOURCES as readonly string[]).includes(from) ? from : null;

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

          // Per-person overrides (the people list loads with the view, complex only).
          const loadedOverrides = (data.user.profile_visibility_overrides || {}) as VisibilityOverrides;
          setOverrides(loadedOverrides);
          overridesRef.current = loadedOverrides;
          userIdRef.current = data.user.id ?? "";
          setUserId(data.user.id ?? "");

          // S5 norm line, fetched before the view is logged so the view and
          // any save carry the exposure id.
          const norm = await fetchNormLine();
          setNormLine(norm);
          normExposureIdRef.current = norm?.exposureId ?? null;

          // S2: the controls, the view event and the T1 trigger all wait
          // until the scheme preview is submitted.
          const sel = schemeSelectionState(data.user.metadata);
          setSelection(sel);
          if (sel.needsPreview) {
            setPreviewOpen(true);
            return;
          }
          await announceView(t, "load");
        }
      })
      .catch(() => {});
  }, [ageBand, announceView]);

  /** Put a scheme returned by the scheme-choice route into force on the page. */
  function applyScheme(scheme: Scheme, state: SchemeSelectionState) {
    setTreatment(scheme);
    treatmentRef.current = scheme;
    setSelection(state);
  }

  async function completePreview(submission: SchemePreviewSubmission) {
    setSchemeBusy(true);
    setSchemeError(null);
    const res = await postSchemeChoice({ source: "preview", ...submission });
    setSchemeBusy(false);
    if (!res.ok) {
      setSchemeError(res.error);
      return;
    }
    applyScheme(res.scheme, res.state);
    setPreviewOpen(false);
    openedAtRef.current = Date.now(); // save timing starts with the controls, not the preview
    await announceView(res.scheme, "after_preview");
  }

  async function confirmSwitch(scheme: Scheme) {
    setSchemeBusy(true);
    setSchemeError(null);
    const res = await postSchemeChoice({ source: "switch", scheme });
    setSchemeBusy(false);
    if (!res.ok) {
      setSchemeError(res.error);
      return;
    }
    applyScheme(res.scheme, res.state);
    await announceView(res.scheme, "after_switch");
  }

  /** A request to switch schemes is an S2 outcome even when cancelled. */
  function logSchemeSwitchStep(step: "opened" | "cancelled") {
    logPrivacyEvent({
      event_type: "privacy_field_touch",
      page: "settings_privacy",
      session_id: sessionIdRef.current,
      metadata: { treatment: treatmentRef.current, scope: `scheme_switch:${step}`, fields: [] },
    });
  }

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
        norm_exposure_id: normExposureIdRef.current,
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
        profile_visibility_overrides: overrides,
        privacy_meta: {
          duration_ms: Date.now() - openedAtRef.current,
          click_count: clickCountRef.current,
          session_id: sessionIdRef.current,
          norm_exposure_id: normExposureIdRef.current,
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

  /**
   * Set, or clear, one person's rule for one field. "see" grants regardless of
   * the audience tier, "hidden" denies regardless, "inherit" removes the rule.
   * Stored as visibility levels (everyone / nobody) so enforcement stays uniform.
   */
  function setOverride(personId: string, fieldKey: string, choice: OverrideChoice) {
    clickCountRef.current += 1;
    const person = { ...(overrides[personId] || {}) };
    if (choice === "inherit") {
      delete person[fieldKey];
      logFieldTouch("override:cleared", visibility[fieldKey] || "everyone", [fieldKey]);
    } else {
      const level: VisibilityLevel = choice === "see" ? "everyone" : "nobody";
      person[fieldKey] = level;
      logFieldTouch("override:set", level, [fieldKey]);
    }
    const next: VisibilityOverrides = { ...overrides };
    if (Object.keys(person).length === 0) delete next[personId];
    else next[personId] = person;
    setOverrides(next);
    overridesRef.current = next;
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
  const showControls = controlsRevealed && !previewOpen;

  return (
    <main className="mx-auto max-w-2xl px-4 py-4">
      <h1 className="text-base font-bold text-gray-900 mb-1">Privacy Settings</h1>
      <p className="text-xs text-gray-500 mb-4">
        Choose who can see different parts of your profile. You can change these anytime.
      </p>

      {/* S5 descriptive norm line (migration 062), descriptive arm only. */}
      {normLine && (
        <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 mb-4">
          {normLine.message}
        </p>
      )}

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

      {/* S2 scheme preview (migration 060): replaces the controls until
          submitted, but never before the high-friction gate — a participant
          crossed on both factors must still take the extra step first, or the
          friction manipulation would be defeated for that arm. */}
      {controlsRevealed && previewOpen && selection && (
        <SchemePreview
          seed={userId}
          canChoose={selection.canChoose}
          submitting={schemeBusy}
          error={schemeError}
          getSessionId={() => sessionIdRef.current}
          onSubmit={(s) => void completePreview(s)}
        />
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
      {showControls && treatment === "simple" && (
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
      {showControls && treatment === "moderate" && (
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
      {showControls && treatment === "complex" && (
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

          {/* Per-person rules (migration 057): the layer that makes this the
              2014 "High" tier. A rule here beats the general setting above for
              that one person, in either direction. */}
          <section className="rounded-lg border border-gray-200 p-3 mt-4" aria-labelledby="override-heading">
            <p id="override-heading" className="text-sm font-medium text-gray-900">
              Rules for specific people
            </p>
            <p className="text-xs text-gray-600 mb-2">
              Fine-tune what each friend or crew member can see. A rule here overrides your
              general setting for that person.
            </p>
            {people.length === 0 ? (
              <p className="text-xs text-gray-500 italic">
                Add friends or recruit crew members to set rules for them.
              </p>
            ) : (
              <div className="space-y-2">
                {people.map((person) => {
                  const rules = overrides[person.id] || {};
                  const active = Object.keys(rules).length;
                  return (
                    <details key={person.id} className="rounded border border-gray-200 bg-gray-50 p-2">
                      <summary className="cursor-pointer text-xs font-medium text-gray-800">
                        {person.name}{" "}
                        <span className="text-gray-500">({person.kind === "minion" ? "crew" : "friend"})</span>
                        {active > 0 && (
                          <span className="ml-2 rounded bg-sky-100 px-1.5 text-sky-800">
                            {active} {active === 1 ? "rule" : "rules"}
                          </span>
                        )}
                      </summary>
                      <div className="mt-2 space-y-1">
                        {PROFILE_FIELDS.map((field) => {
                          const current = rules[field.key];
                          const choice: OverrideChoice =
                            current === "nobody" ? "hidden" : current ? "see" : "inherit";
                          return (
                            <div key={field.key} className="flex items-center justify-between gap-2">
                              <span className="text-xs text-gray-700">{field.label}</span>
                              <div className="flex gap-1" role="group" aria-label={`${person.name}: ${field.label}`}>
                                {OVERRIDE_CHOICES.map((c) => (
                                  <button
                                    key={c.value}
                                    type="button"
                                    aria-pressed={choice === c.value}
                                    onClick={() => setOverride(person.id, field.key, c.value)}
                                    className={`rounded px-2 py-1 text-xs transition ${
                                      choice === c.value
                                        ? "bg-sky-100 text-sky-800 border border-sky-300"
                                        : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-100"
                                    }`}
                                  >
                                    {c.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Save button — a NEUTRAL-default participant starts with nothing selected
          and must make a complete first choice before saving (Workstream A / A10). */}
      {showControls && (
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
          {selection?.canSwitch && (
            <SchemeSwitch
              current={selection.currentScheme}
              busy={schemeBusy}
              error={schemeError}
              onOpen={() => logSchemeSwitchStep("opened")}
              onCancel={() => logSchemeSwitchStep("cancelled")}
              onConfirm={(s) => void confirmSwitch(s)}
            />
          )}
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
