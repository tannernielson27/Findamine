# Findamine — Production & Research Readiness Plan

**Status:** Planning (no implementation yet)
**Last updated:** 2026-06-27
**Owner:** Tanner Nielson
**Mentor / PI of record:** Dr. Mark Keith
**Purpose:** Get Findamine ready to run the privacy choice-architecture studies in a few weeks, while making the app more fun/accessible and more effective as a research instrument.

> This document is a roadmap and backlog. It does not change any code. It captures
> where the app actually stands, the gaps between the code and the research design,
> and a prioritized plan of everything worth working on.

---

## 1. Key decisions (locked)

These were decided on 2026-06-27 and shape the rest of the plan:

1. **Privacy treatment = `simple` / `moderate` / `complex`** (control-scheme complexity), as
   already implemented in code — **not** the prospectus's 3×2 Defaults×Friction design.
   → The prospectus/thesis design must be reconciled to match this with Dr. Keith
   (see §6, Open Questions). The IV is the *complexity/granularity of the privacy control
   surface*; "friction" is operationalized through control complexity rather than a separate
   buried-vs-prominent factor.
2. **The referral / "minion" incentive economy is a must-build blocker.** It is the engine of
   the privacy↔reward tension and currently does not exist in the codebase. The pilot cannot
   test the incentive-erosion hypotheses without it.
3. **Defaults remain a live dimension worth keeping configurable** (private/neutral/public
   starting position), since the field-level default scaffolding already exists. Final factor
   structure to be confirmed with the mentor.

---

## 2. Current state (what actually exists)

Findamine is a mature app, well past prototype:

- **Stack:** Next.js 16 (App Router), Supabase (PostgreSQL + PostGIS), Vercel. ~25k LOC TS/TSX,
  118 API routes, 43 SQL migrations.
- **Core gameplay:** hunts, GPS locations, hot/cold proximity meter, challenge inputs,
  scoring, badges, streaks.
- **Social layer:** teams, team chat, friend connections, kudos, shoutouts, wall posts,
  leaderboards. **No referral/minion relationship.**
- **AI layer:** Anthropic + OpenAI for hints, feedback, content.
- **Education:** curriculum library, education standards alignment, personality assessment.
- **Compliance:** COPPA flows, parental/child registration, GDPR tooling, consent infra.
- **Hardening:** rate limiting, bot guard, ML "threat" anti-abuse system, extensive RLS history.

### Research instrumentation — half-built

The tables and services the prospectus references **do exist**, but are largely **not wired
into the live user experience**:

| Component | Exists? | Wired to UX? |
|---|---|---|
| `treatment_studies`, `treatment_dimensions`, `dimension_assignments`, `study_enrollments` | ✅ | ❌ not on signup path |
| Stratified block randomization service (`lib/services/randomization.ts`) | ✅ | ❌ orphaned from registration |
| `behavioral_events` + `trackEvent()` helper | ✅ | partial |
| `privacy_events` table + `/api/v1/research/privacy-events` endpoint | ✅ | ❌ settings UI never calls it |
| Survey engine (`surveys`/`survey_schedules`/`survey_deliveries`/`survey_responses`) | ✅ | ⚠️ delivery/scheduling unverified |
| Research export service (`lib/services/research-export.ts`) | ✅ | ⚠️ emits placeholder zeros |
| Privacy settings page with simple/moderate/complex treatments | ✅ | ⚠️ no logging, no enforcement |
| Cell-balance checker (`checkBalance`) | ✅ | ❌ not surfaced |

---

## 3. Critical gaps (why the study can't run yet)

The primary outcome measure (privacy behavior over time) currently captures **nothing**, and
the incentive that creates the whole privacy↔reward tension **doesn't exist**.

1. **Treatment never assigned at enrollment.** `register/route.ts` creates a user but does not
   call `assignParticipant()`, set `privacy_treatment` in metadata, set initial
   `profile_visibility` by condition, or create a `study_enrollments` row. The privacy page
   reads `user.metadata.privacy_treatment` — which is never set.
2. **Privacy changes are not logged.** The settings "Save" handler just `PUT`s
   `profile_visibility`. No old/new values, no per-field deltas, no duration, no click count,
   no tightening-vs-loosening classification, no reversal/abandonment detection. The
   `privacy_events` table sits empty.
3. **No privacy-index trajectory.** No restrictiveness score (0–1) computed or snapshotted
   over time. Required for H1/H4 growth-model analysis.
4. **Disclosure has no teeth.** `filterProfileForViewer()` only enforces `display_name` and
   `avatar`. The other 6 of 8 profile fields (real name, personality scores, badges, total
   score, hunt history, friends list) are not enforced anywhere — so "sharing" a field has no
   consequence, and the privacy↔reward tradeoff is hollow.
5. **No referral/minion economy** (see §1.2).
6. **Survey pipeline unverified.** T1/T2/T3 scheduling, delivery, and scoring need an
   end-to-end check; baseline privacy-concern survey isn't tied to enrollment.
7. **Research export is incomplete.** Hard-codes `"0"` for hunts/finds/points and omits the
   privacy trajectory entirely.

---

## 4. Workstreams & backlog

Priority tags: **P0** = blocker for pilot, **P1** = important for a clean study, **P2** = quality/nice-to-have.
Effort: S / M / L (rough).

### Workstream A — Research validity (critical path)

| ID | Item | Priority | Effort |
|----|------|----------|--------|
| A1 | Reconcile thesis design doc to simple/moderate/complex + confirm whether Defaults stays a factor (mentor sign-off) | P0 | S |
| A2 | Assign treatment at enrollment: call randomization, write `dimension_assignments`, set `metadata.privacy_treatment`, set initial `profile_visibility` by default condition, create `study_enrollments` row | P0 | M |
| A3 | Privacy-event logging on the settings surface: per-field old/new, duration_ms, click_count, tighten/loosen classification, reversal & abandonment detection → `privacy_events` | P0 | M |
| A4 | Privacy-index computation (0–1 restrictiveness) on each change + periodic snapshot for trajectory | P0 | M |
| A5 | Enforce all 8 profile fields in `filterProfileForViewer` and everywhere profiles are read (API + UI) so disclosure actually bites | P0 | M |
| A6 | Referral / minion economy: recruit flow → minion link → recruiter earns points when minions score → disclosure-gated social benefit | P0 | L |
| A7 | Survey pipeline T1/T2/T3: verify schedule/delivery/scoring; wire baseline privacy-concern survey to enrollment; add validated privacy-fatigue + ease-of-use instruments | P1 | M |
| A8 | Fix research export: real joins for hunts/finds/points, de-identified, include privacy trajectory; CSV/JSON for R/Python | P1 | M |
| A9 | Researcher dashboard: live enrollment, cell balance (surface `checkBalance`), logging-completeness monitor for pilot validation | P1 | M |
| A10 | Configurable defaults by condition (extend `getDefaults` beyond age band) incl. a "neutral/no-selection" state if Defaults stays a factor | P1 | S |

### Workstream B — Fun & engagement

| ID | Item | Priority | Effort |
|----|------|----------|--------|
| B1 | Audit/polish the play loop (`play/[huntId]/page.tsx`, ~1,100 lines): pacing, feedback, reward moments, hot/cold meter feel, celebration beats | P1 | M |
| B2 | Strengthen social stickiness (kudos/shoutouts/wall/streaks) and connect it to the referral loop so engagement doubles as research incentive | P1 | M |
| B3 | First-run onboarding: ensure new users hit a "first fun moment" fast (tutorials + milestones infra already exists) | P1 | M |
| B4 | Re-engagement nudges for a multi-week study (notifications + cron exist) without contaminating the privacy manipulation | P2 | M |
| B5 | Leaderboard/progress visibility as motivation (and as disclosure incentive) | P2 | S |

### Workstream C — Accessibility & UX quality

| ID | Item | Priority | Effort |
|----|------|----------|--------|
| C1 | Legibility pass: privacy page uses `text-[9px]`/`text-[10px]` — fails WCAG and undermines a study *about reading privacy settings*. Fix baseline legibility (keep any intentional per-condition framing as a deliberate, documented manipulation) | P1 | S |
| C2 | Mobile-first responsiveness pass (it's a GPS field app — phone is the primary device) | P1 | M |
| C3 | Keyboard nav, screen-reader labels, ARIA on instrumented surfaces | P2 | M |
| C4 | Reduced-motion support (confetti, framer-motion) | P2 | S |

### Workstream D — Production readiness

| ID | Item | Priority | Effort |
|----|------|----------|--------|
| D1 | Test coverage for research-critical paths (assignment, logging, index, enforcement, export). Currently only 3 test files for 25k LOC | P0 | M |
| D2 | RLS/security audit on new privacy-enforcement + referral surfaces | P1 | M |
| D3 | Load/scale check for a full class hitting the field simultaneously | P1 | M |
| D4 | IRB/consent surface: adult-only consent copy, debrief flow, honor `withdrawn_at` on export | P1 | S |
| D5 | End-to-end data-export QA dry run before pilot | P1 | S |

---

## 5. Recommended sequencing

**Critical path to a valid pilot (P0):**
A1 → A2 → A3 → A4 → A5 → A6, with D1 tests written alongside each.

Rationale: nothing else matters if treatment isn't assigned (A2), changes aren't logged (A3),
the index isn't computed (A4), disclosure doesn't bite (A5), and there's no incentive (A6).
A1 is a quick mentor decision that unblocks the rest.

**Parallel / fast-follow (P1):** A7–A10, B1–B3, C1–C2, D2–D5.

**Pilot gate:** Before any participant data, run the pilot's four validation checks from the
prospectus §7 — (a) correct randomization/condition delivery, (b) completeness/accuracy of
behavioral logging, (c) survey timing/delivery, (d) the incentive mechanic — against the
researcher dashboard (A9) and export dry run (D5).

---

## 6. Open questions for the mentor (Dr. Keith)

1. **Factor structure.** With the treatment fixed to simple/moderate/complex, does **Defaults**
   (private/neutral/public) remain a crossed second factor, or is the confirmatory design now a
   single-factor (complexity) study? This determines A10 and the analysis plan.
2. **Prospectus revision.** The written prospectus describes Defaults×Friction; it needs editing
   to match the implemented treatment. Scope of that revision?
3. **Incentive calibration.** Point values / visibility of the minion economy — strong enough to
   create real tension, mild enough to pass IRB as a genuine product feature (not deceptive)?
4. **Power / N.** Final target sample for the chosen factor structure.
5. **Pre-registration timing** relative to the pilot.

---

## 7. Notes & references

- Prospectus: `../FindamineResearch/Honors_Prospectus_Privacy_Study.md`
- Privacy model: `src/lib/utils/privacy.ts` (8 fields, 4 visibility levels, treatment defs)
- Privacy UI: `src/app/(app)/settings/privacy/page.tsx`
- Randomization: `src/lib/services/randomization.ts`
- Export: `src/lib/services/research-export.ts`
- Research schema: `supabase/migrations/004_surveys_research_moderation.sql`,
  `supabase/migrations/006_missing_tables.sql` (privacy_events, norm_exposures)
- Privacy-event endpoint: `src/app/api/v1/research/privacy-events/route.ts`
- Registration (no treatment assignment today): `src/app/api/v1/auth/register/route.ts`
</content>
</invoke>
