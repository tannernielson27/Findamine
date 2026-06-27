# Workstream A — Research Validity: File-Level Implementation Plan

**Status:** Planning (no implementation yet)
**Last updated:** 2026-06-27
**Parent doc:** `RESEARCH_READINESS_PLAN.md`
**Scope:** The research-validity critical path that must land before the pilot.

> File-level plan: exact files to create/modify, schema changes, tests, and acceptance
> criteria for each task. Paths are relative to `findamineapp/`. Next.js 16 App Router —
> consult `node_modules/next/dist/docs/` before writing route code (per `AGENTS.md`).

## Implementation status (updated 2026-06-27)

Built on branch `feat/workstream-a-research-validity` (local; not yet pushed). Each task
shipped green (78 tests passing, `tsc --noEmit` clean) and committed separately.

| Task | Status | Notes |
|------|--------|-------|
| A1 | ⏳ mentor | Design decision (factor structure). No code. |
| A2 | ✅ done | Enrollment/assignment, initial visibility, migration 044. |
| A3 | ✅ done | Privacy-event logging (view/change/abandon, deltas, reversal). |
| A4 | ✅ done | Index snapshots (t0/change/daily cron), migration 045. |
| A5 | ◑ partial | Primitives + `canView` security fix + peer surfaces (friends, kudos, shoutouts, wall, own-team). **Deferred surfaces below.** |
| A6 | ✅ done | Referral/minion economy backend + UI, migration 046. |
| A7 | ✅ done | Survey T1/T2/T3 delivery pipeline, migration 047 (instruments seeded **draft**). |
| A8 | ✅ done | Export: real aggregates + privacy trajectory. |
| A9 | ✅ done | Researcher dashboard (balance, logging completeness, referral). |
| A10 | ✅ done | Condition-aware defaults + neutral handling. |

**Decisions still needed (block the remainder):**
1. **A5 deferred surfaces** — leaderboard (does hiding `total_score` drop a user from the
   board or just hide the name?), search (is a name-private user findable?), roster
   (teacher authority — likely no peer filtering), team-browse + team chat. These change
   UX/semantics and are product+mentor calls, not unilateral code changes.
2. **A6 incentive calibration** — `REFERRAL_FRACTION` (currently 0.15) and point values,
   for IRB/behavioral validity.
3. **A7 validated instruments** — real scale items/wording/citations for the T1/T2/T3
   surveys (seeded as draft placeholders; activate once entered).
4. **A1 factor structure** — whether `privacy_default` stays a crossed confirmatory factor.

**Also outstanding:** an integration/mock test for the export (A8) and dashboard (A9);
the migrations (044–047) need to be applied to the Supabase project.

## Conventions observed in the codebase (follow these)

- **API routes:** `src/app/api/v1/<area>/route.ts`; handlers use `getAuthUser(request)`,
  `requireRole(user, ...)`, `ApiError`, `errorResponse(error)` from `src/lib/utils/api-auth.ts`.
- **DB access:** `createSupabaseServiceClient()` from `src/lib/supabase/server.ts` (service role,
  bypasses RLS — guard authz in code). Server components use `createSupabaseServerClient()`.
- **Migrations:** sequential `supabase/migrations/NNN_name.sql`; next number is **044**. Each table
  gets `ENABLE ROW LEVEL SECURITY` + policies using helpers `public.user_id()` / `public.user_role()`.
- **Event logging:** fire-and-forget `trackEvent()` in `src/lib/utils/track-event.ts`
  (writes `behavioral_events`). Privacy logging has a dedicated `privacy_events` table.
- **Tests:** Vitest, files in `src/__tests__/*.test.ts` (`experiment.test.ts`, `scoring.test.ts` exist).
- **Profile columns of interest on `public.users`:** `metadata` (jsonb), `profile_visibility`
  (jsonb), `age_band`. Note `user_profiles.effective_band` is used by randomization/layout — there
  is an `age_band` vs `effective_band` inconsistency to resolve (see A2 notes).

---

## Dependency graph

```
A1 (design sign-off, no code)
        │
        ▼
A2 (assign at enrollment) ──► A10 (configurable defaults by condition)
        │
        ├──► A3 (privacy-event logging) ──► A4 (privacy index) ──► A8 (export)
        │                                          │
A5 (field enforcement) ◄───────────────────────────┘ (index needs enforced fields to be meaningful)
        │
A6 (minion economy)  ── independent build, but A5 makes its disclosure-gating meaningful
A7 (survey pipeline) ── independent, feeds A8
A9 (researcher dashboard) ── consumes A2/A3/A4 outputs
```

**Build order:** A1 → A2 → A5 → A3 → A4 → A6 → A10 → A7 → A8 → A9 (tests alongside each, per D1).

---

## A1 — Reconcile design (no code)

**Goal:** Lock the factor structure with Dr. Keith so downstream tasks are unambiguous.
**Deliverable:** A short decision note appended to `RESEARCH_READINESS_PLAN.md` §6 answering:
- Is `privacy_treatment` (simple/moderate/complex) the **only** factor, or is **Defaults**
  (private/neutral/public) crossed with it? → gates A10 and the export columns in A8.
- Final dimension names/levels to seed in `treatment_dimensions` (drives A2 seed migration).
**Acceptance:** Written confirmation; dimension names + levels enumerated.

---

## A2 — Assign treatment at enrollment

**Goal:** Every new participant is deterministically assigned a `privacy_treatment` (and Defaults
condition if A1 keeps it), gets initial `profile_visibility` from the assigned default, is enrolled
in the active study, and the assignment persists. Today `register/route.ts` does none of this and
the privacy page reads `metadata.privacy_treatment` which is never set.

**New files**
- `supabase/migrations/044_research_study_seed.sql`
  - Seed one `treatment_studies` row (e.g. `study_code = 'privacy_pilot_2026'`, status `active`).
  - Seed `treatment_dimensions`: `privacy_control_complexity` levels `{simple,moderate,complex}`
    (+ `privacy_default` levels `{private,neutral,public}` if A1 keeps it).
  - Link via `treatment_study_dimensions`.
  - Add a config table or `eligibility_criteria` JSON so the enrollment code can find "the active
    study to auto-enroll into" without hardcoding a UUID. Recommended: a small
    `study_auto_enroll` flag column on `treatment_studies` (migration adds it).
- `src/lib/services/enrollment.ts` — new service `enrollParticipant(userId)`:
  1. Find the auto-enroll active study.
  2. Skip if already in `study_enrollments`.
  3. Call `assignParticipant()` (`src/lib/services/randomization.ts`) for the study's dimensions.
  4. Derive `privacy_treatment` from the complexity assignment; write it to `users.metadata`
     (merge, don't overwrite).
  5. Compute initial `profile_visibility` via A10's `getDefaults(ageBand, defaultCondition)` and
     write to `users.profile_visibility` (only if currently empty — never clobber a returning user).
  6. Upsert `study_enrollments`; update `current_sample_size`.
  7. `trackEvent({ eventType: 'study_enrolled', ... })`.

**Modified files**
- `src/app/api/v1/auth/register/route.ts` — after the `users` insert (line ~84), call
  `enrollParticipant(user.id)` inside a try/catch (never fail registration if enrollment errors;
  log instead). *Caveat:* email is unconfirmed at this point — decide whether to enroll here or on
  first authenticated load (see layout option below).
- `src/app/(app)/layout.tsx` — **recommended primary trigger.** After loading `profile`
  (line ~21), call `enrollParticipant(profile.id)` (idempotent; safe to call every load). This
  guarantees enrollment happens once the user is real and authenticated, independent of email flow.
- `src/lib/services/randomization.ts` — reconcile `effective_band` vs `users.age_band`. The
  stratification reads `user_profiles.effective_band`; confirm that row exists for new users or
  fall back to `users.age_band`. Minor edit to the stratum lookup.

**Tests**
- `src/__tests__/enrollment.test.ts`: assignment is balanced across cells (extends
  `experiment.test.ts` patterns), idempotency (double-call → one enrollment), initial visibility
  matches assigned default, returning user's visibility is not overwritten.

**Acceptance**
- New signup → row in `dimension_assignments`, `study_enrollments`, `metadata.privacy_treatment`
  set, `profile_visibility` populated. Privacy page renders the correct treatment variant with no
  manual setup. `checkBalance()` stays within tolerance across a simulated cohort.

---

## A5 — Enforce all 8 profile fields

**Goal:** Make disclosure consequential. `filterProfileForViewer()` in `src/lib/utils/privacy.ts`
currently only filters `display_name` and `avatar`; the other 6 fields (`real_name`,
`personality_scores`, `badges`, `total_score`, `hunt_history`, `friends_list`) are returned to
everyone regardless of settings. Without enforcement the privacy↔reward tradeoff is hollow and the
privacy index (A4) measures a setting with no real-world effect.

**Modified files**
- `src/lib/utils/privacy.ts` — extend `filterProfileForViewer()` to accept and filter the full
  field set; return a typed object covering all 8 fields. Add a helper
  `visibleFields(profile, viewerRelationship): string[]` for callers that need to know *which*
  fields are visible (used by A6 disclosure-gating and A4 index).
- **Every read path that exposes another user's profile** must route through the filter. Audit and
  patch:
  - `src/app/api/v1/social/friends/route.ts` (embeds `users(...)` for requester/addressee).
  - `src/app/api/v1/social/kudos/route.ts`, `.../shoutouts/route.ts`, `.../wall/route.ts`.
  - `src/app/api/v1/leaderboard/route.ts` — already has `redactEntry()` for codename/role; layer
    field-visibility on top (e.g. `total_score`, `badges`).
  - `src/app/api/v1/roster/route.ts`, `src/app/api/v1/teams/*`, `src/app/api/v1/search/route.ts`
    (any member/peer listing).
  - `src/app/(app)/dashboard/profile/page.tsx` (viewing another user).
  - `src/app/api/v1/admin/users/[id]/route.ts` (admin bypass is fine — keep, but confirm it's
    role-gated).
- Determine `viewerRelationship` (`self|team|class|public`) per call site. Add a shared helper
  `src/lib/utils/viewer.ts` → `getViewerRelationship(viewerId, targetUserId)` that checks team
  membership / roster co-membership so call sites don't each reimplement it.

**Tests**
- `src/__tests__/privacy-enforcement.test.ts`: matrix of (field × visibility level × viewer
  relationship) → expected visible/hidden, for all 8 fields. Plus an integration-style test that a
  `nobody`-set field never appears in the social/leaderboard payloads.

**Acceptance**
- Setting a field to `nobody`/`team` provably removes it from the corresponding API responses for
  out-of-scope viewers. No read path leaks an unfiltered profile.

---

## A3 — Privacy-event logging

**Goal:** Capture the primary outcome. Every privacy interaction writes a `privacy_events` row
with old/new values, per-field deltas, duration, click count, tighten/loosen classification, and
reversal/abandonment flags. Today the settings "Save" (`settings/privacy/page.tsx`) just `PUT`s
`profile_visibility` and logs nothing; the `privacy_events` table and
`/api/v1/research/privacy-events` endpoint exist but are unused.

**New files**
- `src/lib/utils/privacy-tracking.ts` (client) — helpers to:
  - classify a change as `tighten` | `loosen` | `mixed` using the ordinal scale
    `nobody < team < class < everyone`.
  - compute a per-field diff between two `profile_visibility` maps.
  - `logPrivacyEvent(payload)` → `POST /api/v1/research/privacy-events` (fire-and-forget).
- `src/lib/utils/privacy-index.ts` — shared restrictiveness scorer (also used by A4). Pure
  function: `computePrivacyIndex(visibility): number` in [0,1], `1` = fully private. Lives in a
  testable module, imported by both client logging and server snapshotting.

**Modified files**
- `src/app/(app)/settings/privacy/page.tsx`:
  - Capture `openedAt` on mount and a click counter across the session on the page.
  - On `handleSave()`: send a `privacy_change` event with `old_value` (snapshot loaded in
    `useEffect`), `new_value`, `duration_ms` (now − openedAt), `click_count`, per-field deltas in
    `metadata`, and the tighten/loosen classification. Include `metadata.treatment` and
    `metadata.page = 'settings_privacy'`.
  - On unmount **without save** after a change was made → emit `privacy_abandon` event.
  - On change-then-revert-to-original before save → mark `metadata.reversed = true`.
  - Add per-interaction `privacy_field_touch` events (optional, P1) for fine-grained flow analysis.
- `src/app/api/v1/research/privacy-events/route.ts` — already accepts these fields; verify the
  `event_type` values it stores and add light validation (allowed types:
  `privacy_change|privacy_abandon|privacy_field_touch|privacy_view`). Keep `pe_own_insert` RLS.
- `src/app/api/v1/auth/profile/route.ts` — optional belt-and-suspenders: when `profile_visibility`
  changes, also stamp a server-side `behavioral_events` row via `trackEvent()` so client-side
  loss doesn't drop the signal entirely. (Client event remains the rich one.)

**Schema**
- No new table (`privacy_events` exists). Possibly add an index on
  `(event_type, created_at)` already present; add `(user_id, event_type)` if A9 needs it.

**Tests**
- `src/__tests__/privacy-tracking.test.ts`: tighten/loosen classification across the ordinal scale,
  per-field diff correctness, index monotonicity (tightening raises index).

**Acceptance**
- Changing settings produces a `privacy_events` row with correct direction, timing, counts, and
  before/after. Abandoning a started-but-unsaved change produces a `privacy_abandon` row.

---

## A4 — Privacy-index trajectory

**Goal:** Persist a restrictiveness score (0–1) over time per participant for growth-model analysis
(H1/H4). A3 computes the index at change-time; A4 also needs periodic snapshots so the trajectory
exists even for users who stop changing settings.

**New files**
- `supabase/migrations/045_privacy_index_snapshots.sql`:
  - `privacy_index_snapshots(id, user_id, index_value numeric, source text
    CHECK (source IN ('change','scheduled','enrollment')), visibility jsonb, created_at)`.
  - RLS: own-insert + admin/researcher select (mirror `privacy_events`).
  - Index `(user_id, created_at)`.
- `src/app/api/cron/privacy-snapshots/route.ts` — cron route (there's already a `src/app/api/cron/`
  dir + `vercel.json`). For each enrolled, non-withdrawn participant, compute
  `computePrivacyIndex(current visibility)` and insert a `scheduled` snapshot. Schedule daily in
  `vercel.json`.

**Modified files**
- `vercel.json` — add the cron schedule entry (follow the existing `cluster-threats` cron pattern).
- `src/lib/services/enrollment.ts` (A2) — write an `enrollment` snapshot at assignment time (the t0
  point of the trajectory).
- `src/lib/utils/privacy-tracking.ts` (A3) — on each `privacy_change`, also insert a `change`
  snapshot (via the privacy-events endpoint or a dedicated one) so change points are dense.

**Tests**
- `src/__tests__/privacy-index.test.ts`: known visibility maps → expected scores; all-`nobody` = 1,
  all-`everyone` = 0; weighting documented and stable.

**Acceptance**
- Every participant has a t0 snapshot at enrollment, a snapshot per change, and daily snapshots.
  A researcher can reconstruct each user's restrictiveness curve vs. time.

---

## A6 — Referral / "minion" economy

**Goal:** Build the incentive engine: a user recruits others; a recruit becomes the recruiter's
**minion**; the recruiter earns points whenever a minion scores; benefiting socially requires
disclosure (gated by A5). This is net-new — nothing referral/minion exists today.

**New files**
- `supabase/migrations/046_referral_minion_economy.sql`:
  - `referral_codes(id, user_id unique, code text unique, created_at)`.
  - `minion_links(id, recruiter_id, minion_id unique, referral_code, created_at,
    CONSTRAINT no_self_minion CHECK (recruiter_id <> minion_id))` — `minion_id` unique enforces one
    recruiter per user (asymmetric follower per the design memo).
  - `referral_points_ledger` **or** reuse `points_ledger` — **but** `points_ledger.source_type`
    CHECK does **not** include `'referral'`. Add an `ALTER TABLE ... DROP/ADD CONSTRAINT` to include
    `'referral'`, then write recruiter earnings as `source_type='referral'`,
    `source_id=<minion find/score id>`.
  - RLS for all new tables.
- `src/lib/services/referral.ts`:
  - `getOrCreateReferralCode(userId)`.
  - `redeemReferral(minionUserId, code)` → create `minion_links` row (guard: no self, no
    pre-existing recruiter, code valid). Emit `trackEvent('referral_redeemed')`.
  - `awardReferralPoints(minionUserId, basePoints, sourceId)` → look up recruiter, compute a
    configurable fraction (e.g. 10–20% — value is an IRB/mentor calibration knob from A1/§6), insert
    into `points_ledger` as `referral`.
- `src/app/api/v1/social/referrals/route.ts` — `GET` (my code + my minions + referral points
  earned), `POST` (redeem a code). Role-gate with `blockChildren` per existing social convention.
- UI: `src/app/(app)/dashboard/social/` additions — show referral code/share link, minion list,
  referral earnings. A recruit-entry field on register or first-run (a `?ref=CODE` query param
  captured at signup and redeemed in `enrollParticipant`/first load).

**Modified files**
- `src/app/api/v1/play/[huntId]/answer/route.ts` — at the points-award block (lines ~160–186),
  after inserting the minion's own `points_ledger` row, call
  `awardReferralPoints(user.id, scoringResult.totalScore, find_id)` (fire-and-forget; never block
  the answer response).
- `src/app/api/v1/auth/register/route.ts` / `src/app/(app)/layout.tsx` — capture `ref` code and
  pass to enrollment so the minion link is created at signup.
- Leaderboard / dashboard surfaces — display referral standing to create the visible incentive
  (ties into B2/B5). Earned referral points should make disclosure visibly worthwhile.

**Tests**
- `src/__tests__/referral.test.ts`: self-referral rejected, double-recruiter rejected, recruiter
  earns the correct fraction when a minion scores, withdrawn/blocked users excluded.

**Acceptance**
- User A shares a code; User B redeems it and becomes A's minion; B scores in a hunt; A's
  `points_ledger` gains a `referral` entry of the configured fraction; the relationship and
  earnings are visible in the social UI.

---

## A10 — Configurable defaults by condition

**Goal:** Initial `profile_visibility` is set from the assigned **Defaults** condition (if A1 keeps
it), not just age band. Supports a `neutral` (no pre-selection) starting state.

**Modified files**
- `src/lib/utils/privacy.ts` — extend `getDefaults(ageBand)` →
  `getDefaults(ageBand, defaultCondition?: 'private'|'neutral'|'public')`:
  - `private` → all fields `nobody`.
  - `public` → all fields `everyone`.
  - `neutral` → return an explicit "unset" map (so the UI forces a first-use choice and A3 can log
    the first selection as the initial decision).
  - default/absent → current age-band behavior (backward compatible).
- `src/lib/services/enrollment.ts` (A2) — pass the assigned Defaults level into `getDefaults`.
- `src/app/(app)/settings/privacy/page.tsx` — handle the `neutral`/unset state (prompt the user to
  choose; currently it merges `defaults` over `existing` assuming defaults always exist).

**Tests**
- Extend `src/__tests__/privacy-index.test.ts` / a new `defaults.test.ts`: each condition produces
  the expected initial map; `neutral` yields unset; index at t0 matches condition.

**Acceptance**
- Participants in each Defaults cell start at the correct restrictiveness; neutral users have no
  pre-selected values and their first choice is logged.

---

## A7 — Survey pipeline (T1/T2/T3)

**Goal:** Baseline (T1), mid (T2), end (T3) surveys actually deliver and score. Tables exist
(`surveys`, `survey_schedules`, `survey_deliveries`, `survey_responses`); delivery/scheduling is
unverified and the baseline privacy-concern survey isn't tied to enrollment.

**New files**
- `supabase/migrations/047_seed_study_surveys.sql` — seed the three instruments (privacy concern at
  T1; privacy fatigue + perceived ease-of-use at T2/T3) into `surveys` with `questions` JSON, and
  `survey_schedules` (`trigger_type='time'`, offsets relative to enrollment).
- `src/app/api/cron/survey-deliveries/route.ts` — cron that materializes `survey_deliveries` rows
  when a participant's enrollment age crosses each schedule offset; expires stale ones.

**Modified files**
- `vercel.json` — add the survey-delivery cron.
- `src/lib/services/survey-scoring.ts` — confirm `scoreSurveyResponse()` covers the seeded scales;
  add subscale definitions for the fatigue / ease-of-use / concern instruments.
- `src/app/api/v1/surveys/[id]/respond/route.ts` — confirm it marks the delivery `submitted` and
  triggers scoring.
- `src/lib/services/enrollment.ts` (A2) — optionally create the T1 delivery immediately on
  enrollment rather than waiting for cron.

**Tests**
- `src/__tests__/survey-delivery.test.ts`: schedule offsets create deliveries at the right time;
  scoring produces expected subscale values for canned responses.

**Acceptance**
- A participant receives T1 at enrollment, T2/T3 on schedule; submitted responses are scored and
  retrievable for export.

---

## A8 — Fix research export

**Goal:** Replace the placeholder `"0"` values in `src/lib/services/research-export.ts` (hunts,
finds, points hard-coded) with real data, add the privacy trajectory, and keep it de-identified.

**Modified files**
- `src/lib/services/research-export.ts`:
  - Join `play_sessions` / `find_completions` / `points_ledger` for real
    `total_hunts_completed`, `total_finds_completed`, `total_points`.
  - Add columns: `privacy_index_t0`, `privacy_index_final`, `privacy_changes_count`,
    `tighten_count`, `loosen_count`, `time_to_first_change_hours`, `abandon_count`,
    `referral_points_earned`, `minion_count`, and per-timepoint survey subscale scores.
  - Honor withdrawals: already filters `withdrawn_at IS NULL` — keep; ensure withdrawn users are
    fully excluded.
  - Keep anonymized sequential `participant_id`; never emit email/auth_id/real name.
- `src/app/api/v1/research/export/route.ts` — already role-gated and streams the file; add an
  optional `?include=events` to also emit the raw `privacy_events` long-format CSV for survival /
  growth models (second file or zipped). `maxDuration` already 60s.
- Consider a companion `experiment-export` route (exists at
  `src/app/api/v1/research/experiment-export/route.ts`) — reconcile the two so there's one source of
  truth.

**Tests**
- `src/__tests__/research-export.test.ts`: row count = enrolled non-withdrawn; aggregates match
  seeded fixtures; no PII columns present; CSV escaping correct (separator/quote handling already
  in code — cover it).

**Acceptance**
- Export for the pilot study yields one de-identified row per active participant with real
  behavioral aggregates and the privacy trajectory; a researcher can load it into R/Python and
  reproduce the primary outcomes.

---

## A9 — Researcher dashboard

**Goal:** Surface live study health for the pilot's four validation checks (randomization, logging
completeness, survey delivery, incentive mechanic). The `checkBalance()` service exists but isn't
surfaced; `research/balance` and `research/participants` routes exist.

**New files**
- `src/app/(app)/admin/research/page.tsx` (or under existing `src/app/(app)/admin/`) — researcher/
  admin-gated page showing:
  - Enrollment count vs target; per-cell counts + balance (from `checkBalance`).
  - Logging-completeness monitor: participants with ≥1 `privacy_events`, snapshot coverage,
    last-event recency (flags instrumentation gaps during the pilot).
  - Survey delivery/submission funnel per timepoint.
  - Referral-mechanic sanity: minion links created, referral points flowing.
- `src/app/api/v1/research/dashboard/route.ts` — aggregates the above (admin/researcher only).

**Modified files**
- `src/app/api/v1/research/balance/route.ts` — confirm it returns `checkBalance()` output shape the
  page expects; extend if needed.
- Navigation/admin layout — add a link for researcher/admin roles.

**Tests**
- `src/__tests__/research-dashboard.test.ts`: aggregation correctness on seeded data; role-gating
  (non-researcher → 403).

**Acceptance**
- A researcher opens one page and can confirm, before/in the pilot, that randomization is balanced,
  logging is complete, surveys are delivering, and the incentive mechanic is active.

---

## Cross-cutting: tests & gate (D1)

Write Vitest specs alongside each task (listed above). Minimum before pilot data collection:
enrollment balance/idempotency, privacy enforcement matrix, privacy tracking classification, index
computation, referral award logic, export integrity. Run the prospectus §7 pilot validation against
A9 + an A8 export dry run as the **go/no-go gate**.

## Migration numbering summary

| # | File | Task |
|---|------|------|
| 044 | `research_study_seed.sql` | A2 |
| 045 | `privacy_index_snapshots.sql` | A4 |
| 046 | `referral_minion_economy.sql` (incl. `points_ledger` source_type ALTER) | A6 |
| 047 | `seed_study_surveys.sql` | A7 |

(Confirm 044 is the next free number at implementation time; nothing renumbers existing migrations.)
</content>
