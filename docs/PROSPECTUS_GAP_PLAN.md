# Prospectus Gap Analysis & Fix Plan

**Date:** 2026-07-22
**Spec audited against:** `../FindamineResearch/Honors_Prospectus_Privacy_Study.md`
**Code audited:** working tree on `feat/workstream-b-engagement` (incl. uncommitted changes)
**Supersedes status claims in:** `WORKSTREAM_A_IMPLEMENTATION_PLAN.md` (stale as of this audit)

This is a full audit of what the app does **not** yet deliver for the study as the
prospectus describes it, and a prioritized plan to close each gap.

## Implementation status (2026-07-22, same day)

| Item | Status |
|------|--------|
| I1 database provisioning | ◑ migrations 001–049 being applied to `bmsmvozzdorgtzflgnrk`; 050–051 to follow |
| I2 env config | ◑ `.env.local` created (URL, anon key, CRON_SECRET); **`SUPABASE_SERVICE_ROLE_KEY` must be pasted from the dashboard**; Vercel env still to mirror |
| F1 friction factor | ✅ migration 050 (crosses `privacy_default` × `privacy_friction`, holds complexity at moderate); low = Privacy in navbar; high = buried nav + advanced-controls gate + discouraging tighten-confirm; every step logged |
| F2 neutral forced choice | ✅ save blocked until all 8 fields chosen + first-load gate modal for neutral users |
| F3 referral disclosure gating | ✅ bonus paid only while `display_name` + `total_score` visible at class+; forfeits logged and shown on the social page |
| F4 `?ref=CODE` capture | ✅ register page reads/sends the code (+ password min-length mismatch fixed) |
| E1 8-field enforcement | ✅ `filterFullProfileForViewer` covers all 8; team-chat leak fixed (API + realtime); metadata-clobber footgun in profile PUT fixed; condition keys server-owned |
| E2 peer profile surface | ✅ `/profile/[userId]` page + `/api/v1/users/[id]/profile`; hidden fields shown as locked; `real_name` now editable on own profile (stored in metadata) |
| M1 export completeness | ✅ `reversal_count`, `view_count`, `field_touch_count`, `successful_change_rate` columns |
| M2 raw-events export | ✅ `?dataset=events` long format (+ `privacy_friction` on trajectory/events rows); dead `includeRawEvents` removed |
| S1 validated instruments | ✅ migration 051 (IUIPC-10, Choi et al. fatigue ×6, Davis EoU ×4; 7-pt); still `draft` pending D3/D4 sign-off — activation SQL in the migration header |
| S2 dashboard survey funnel | ✅ per-timepoint delivered/opened/submitted/expired table |
| S3 IRB consent/debrief copy | ⏳ blocked on D4 (IRB); debrief updated to disclose the friction manipulation, still marked placeholder |
| V1 tests | ✅ 167 passing (new: friction derivation, disclosure gate, full-profile filter, reversal counting); `tsc` + `next build` clean |
| V2 simulated-cohort dry run | ⏳ after migrations land |
| D1–D4 decisions | ⏳ Dr. Keith — the code now implements the prospectus's 3×2 (revert path documented in migration 050) |

---

## 1. The headline gap: the experiment in the code is not the experiment in the prospectus

| | Prospectus (§5.2) | Code (migration 044 + `randomization.ts`) |
|---|---|---|
| Factor A | Defaults: private / neutral / public | `privacy_default`: private / neutral / public ✅ |
| Factor B | **Friction: low / high** (steps, confirmations, nav depth, framing) | **`privacy_control_complexity`: simple / moderate / complex** (granularity of controls) |
| Cells | 3 × 2 = **6** | 3 × 3 = **9** |

- **No friction manipulation exists anywhere** — not implemented, not scaffolded. All
  conditions see the same single-save flow, the same copy ("There are no wrong answers"),
  and the same nav path (`Settings → Privacy settings`; privacy is in the main navbar for
  no one). Grep for `friction` hits only docs.
- The June planning docs *deliberately* swapped friction for complexity, pending mentor
  sign-off (A1) — but that sign-off was never recorded, and migration 044 already seeds
  and crosses both dimensions as a de-facto 3×3.
- Power note: N = 180–240 over 9 cells is 20–27/cell vs 30–40/cell for the 6-cell design.

**→ Decision D1 (Dr. Keith, blocks everything design-related):** pick one:
- **(a) Honor the prospectus** — build a true Friction factor (see Phase 2, F1) and
  decide whether complexity is dropped, collapsed, or kept as a third dimension.
- **(b) Keep the 3×3 complexity×default design** — then the prospectus itself must be
  revised (RQ2/RQ3/H2/H3 re-worded around control complexity as the friction
  operationalization, §5.2 rewritten, power analysis redone for 9 cells).

The rest of this plan assumes **(a)** where it matters and flags what changes under (b).

---

## 2. Full gap list (verified in code, with file refs)

### A. Infrastructure — the app currently cannot run the study at all
1. **The live Supabase project is empty.** Project `tannernielson27-Findamine`
   (`bmsmvozzdorgtzflgnrk`, created 2026-07-22) has **0 tables and 0 applied
   migrations**; the repo has 49 migration files (001–049). Nothing works until the
   schema is applied.
2. **No local `.env`** — the app has no configured Supabase URL/keys locally; Vercel env
   state unverified. `supabase/config.toml` references a local dev ref only.

### B. Missing / broken manipulations
3. **Friction factor absent** (see §1).
4. **Neutral default doesn't force a first-use choice.** Prospectus: "the user must
   choose on first use." Code: `getDefaults` correctly returns `{}` for neutral and the
   UI renders nothing selected — but there is no gate; a neutral user can press "Save
   Privacy Settings" on an empty map (`settings/privacy/page.tsx:314`), and nothing ever
   prompts them to visit the page at all.

### C. Incentive mechanic doesn't create the privacy↔reward tension (§3.2)
5. **Referral points are not disclosure-gated.** `awardReferralPoints`
   (`lib/services/referral.ts:133-163`) pays the recruiter regardless of anyone's
   privacy settings. Prospectus: "Restricting permissions … suppresses the social reward
   flow." Today only minion *name/avatar display* is affected by privacy — the points
   flow untouched. The core experimental tension is hollow.
6. **`?ref=CODE` signup capture is broken end-to-end.** The backend accepts
   `referral_code` (`auth/register/route.ts:98-100`) but `src/app/register/page.tsx`
   never reads `?ref=` and never sends it. Referral links silently do nothing; the only
   working redemption is the authenticated POST `/api/v1/social/referrals`.

### D. Disclosure has no consequence for half the fields
7. **Only 4 of 8 profile fields are enforced anywhere**: `display_name`, `avatar`
   (social surfaces + teams via `filterProfileForViewer`), `badges` (badges route),
   `total_score` + `display_name` (leaderboard via `leaderboard-visibility.ts`).
   **`real_name`, `personality_scores`, `hunt_history`, `friends_list` are enforced
   nowhere** — `filterProfileForViewer` (`lib/utils/privacy.ts:188-205`) structurally
   returns only `{display_name, avatar_url}`.
8. **Team chat leaks `display_name` unfiltered** (`components/social/team-chat.tsx:56`).
9. No user-search surface exists (nothing leaks, but "be findable to attract minions"
   has no mechanism either — relevant to D1/C-gating design).

### E. Measurement gaps vs §5.5
10. **Successful-change rate not derivable from the export.** `privacy_view` /
    `privacy_field_touch` / `privacy_change` / `privacy_abandon` events exist and are
    logged (client `privacy-tracking.ts`, server `auth/profile/route.ts:91-114`), so the
    rate is computable from raw events — but the participants export
    (`research-export.ts`) emits no view/touch counts and no completion-rate column.
11. **Decision reversals (change-then-undo across saves) are not computed** anywhere —
    only a net-zero within-session `reversed` flag on abandon events. Needs offline or
    export-time reconstruction from consecutive `privacy_change` deltas.
12. **Raw-events long-format export missing.** `ExportConfig.includeRawEvents` is dead
    config (declared `research-export.ts:18`, never used); the planned `?include=events`
    doesn't exist. Survival analysis (time-to-first-change) and flow-level analysis need
    the raw `privacy_events` table export.
13. Participants CSV carries only `privacy_index_t0` / `privacy_index_final`; the full
    trajectory lives in the separate `?dataset=trajectory` export (this one **is**
    implemented) — fine, just document it.

### F. Surveys are placeholders and undeliverable (§5.4–5.5)
14. **All three instruments are `PLACEHOLDER` items seeded as `draft`**
    (migration 047). The delivery cron only delivers `status='active'` surveys
    (`survey-delivery.ts:30-31`), so **zero surveys reach participants** until real
    validated scales are entered and activated. Needed: privacy concern (e.g. IUIPC-8,
    T1), privacy fatigue (Choi et al. 2018, T1/T2/T3), perceived ease of use (T2/T3).
15. Respond route doesn't trigger scoring inline — scoring happens at export/on-demand;
    acceptable, but verify end-to-end once instruments are real.

### G. IRB surface is placeholder
16. **Consent copy is `0.1-placeholder`** (`components/layout/consent-gate.tsx`) and the
    **debrief page is placeholder** (`app/(app)/debrief/page.tsx`). Both need
    IRB-approved language. Mechanics (consent-gated assignment, `withdrawn_at` honored
    everywhere, minion-link teardown on withdrawal) are done and correct.

### H. Pilot validation tooling (§7)
17. **Researcher dashboard has no survey delivery/submission funnel** — one of the four
    pilot validation checks it exists to support (`lib/services/research-dashboard.ts`).
18. **No integration tests** for: enrollment→assignment path, server-side change
    logging, snapshot cron, export aggregates/PII exclusion, `redeemReferral`/
    `awardReferralPoints` flow, survey delivery. Only pure helpers are unit-tested.
19. Two parallel export systems (`research-export.ts` vs `research/experiment-export`)
    were never reconciled.

### Resolved since the June plan (verified — no action needed)
- Enrollment is wired (register route + app layout), idempotent, consent-gated, sets
  metadata/visibility/enrollment, writes t0 snapshot.
- Privacy event logging is rich (old/new, deltas, duration, clicks, tighten/loosen,
  abandon on pagehide/visibility/unmount with keepalive).
- Privacy index + snapshots (enrollment/change/daily cron) implemented; crons registered
  in `vercel.json`.
- Leaderboard enforcement (score-drop + name-redaction) landed.
- Export has real aggregates, de-identified, with survey subscale columns.
- Privacy page legibility fixed (smallest text is `text-xs`).

---

## 3. Fix plan

Priorities: **P0** = pilot cannot run / study invalid without it. **P1** = needed for a
clean confirmatory study. **P2** = quality.

### Phase 0 — Decisions (this week, no code)
| ID | Item | Blocks |
|----|------|--------|
| D1 | Factor structure: build Friction per prospectus (a) vs revise prospectus to 3×3 (b). Get written sign-off from Dr. Keith. | Phase 2 |
| D2 | Disclosure-gating mechanism for referral points (see F3 options) | F3 |
| D3 | Final instruments: exact scale items + citations for T1/T2/T3 | F5 |
| D4 | IRB consent + debrief language | F6 |

### Phase 1 — Infrastructure (P0, do now, independent of D1)
| ID | Item | How |
|----|------|-----|
| I1 | Provision the database: apply migrations 001–049 to `bmsmvozzdorgtzflgnrk` (or link the intended project if this new one is wrong) | `supabase link` + `supabase db push`, or apply sequentially via MCP `apply_migration`; verify `treatment_studies` seed row exists after |
| I2 | Create `.env.local` (URL, anon key, service key, `CRON_SECRET`, AI keys) and mirror on Vercel; confirm crons fire | Supabase dashboard + `vercel env` |
| I3 | Smoke-test the enrollment path end-to-end on the fresh DB: signup → consent → assignment → t0 snapshot → privacy page renders assigned variant | manual + `enrollment.test.ts` against a test DB |

### Phase 2 — Make the manipulation match the prospectus (P0, after D1)
| ID | Item | Files |
|----|------|-------|
| F1 | **Build the Friction factor** (if D1=a). Seed `privacy_friction: low/high` dimension (new migration; decide fate of `privacy_control_complexity` — drop from crossing or fix at `moderate`). Implement: **low** = privacy link in main navbar + one-click save, neutral labels; **high** = link only behind Settings → More → Privacy (+1 interstitial), a 2-step confirm dialog on any *tightening* save with mildly discouraging framing ("Hiding your score may reduce referral earnings"), and settings grouped behind an extra "Advanced" disclosure. Log every step so abandonment-per-step is measurable. Keep capabilities identical across conditions (prospectus §5.2). | migration 050, `enrollment.ts`, `navbar.tsx`, `settings/privacy/page.tsx` (+ new `FrictionConfirmDialog`), `privacy-tracking.ts` (step events) |
| F2 | **Force the neutral first-use choice**: for `privacy_default=neutral` users with an unset map, (i) block Save until every field/category/master has a selection, (ii) surface a non-dismissable-until-chosen prompt on first authenticated load directing them to the privacy page (or inline modal). Log the forced first selection as the initial decision. | `settings/privacy/page.tsx`, `app/(app)/layout.tsx` or consent-gate follow-on |
| F3 | **Gate referral rewards on disclosure** (per D2). Recommended mechanism: recruiter earns the referral fraction only while their qualifying fields (e.g. `display_name`, `total_score`) are visible at `class`+ — checked in `awardReferralPoints` at award time; UI on the social page shows "You're missing referral points — your profile is hidden" so the cost is felt. Alternative/looser: scale fraction by visibleFields count. | `referral.ts`, `social/referrals/route.ts`, social page UI |
| F4 | **Fix `?ref=CODE` capture**: read `searchParams` in `register/page.tsx`, persist through the form, send `referral_code` in the POST body (backend already accepts it). Also stash in `sessionStorage` so the code survives an email-confirm round-trip. | `app/register/page.tsx` |

### Phase 3 — Make disclosure consequential everywhere (P0)
| ID | Item | Files |
|----|------|-------|
| E1 | Extend `filterProfileForViewer` to all 8 fields (typed full-profile return + `visibleFields` already exists); patch every read path: profile API, badges (done), leaderboard (done), friends/kudos/shoutouts/wall/referrals/teams (extend from 2→8 fields where payloads carry more), team chat (`team-chat.tsx` — filter or route through API) | `lib/utils/privacy.ts` + listed routes |
| E2 | Surface `real_name`, `personality_scores`, `hunt_history`, `friends_list` somewhere peers can actually see them (a lightweight public profile view), so hiding them is a real choice — without a surface, those 4 settings measure nothing | new `profile/[id]` page + API using the filter |
| E3 | Integration tests: matrix (field × level × relationship) against real API payloads; "a `nobody` field never appears in any response" | `__tests__/privacy-enforcement-api.test.ts` |

### Phase 4 — Measurement completeness (P1)
| ID | Item | Files |
|----|------|-------|
| M1 | Export: add `view_count`, `field_touch_count`, `successful_change_rate` (= changes / (changes + abandons)), and a `reversal_count` computed from consecutive `privacy_change` delta inversions | `research-export.ts` |
| M2 | Implement `?include=events` raw `privacy_events` long-format export (wire the dead `includeRawEvents`) for survival/flow models | `research-export.ts`, `research/export/route.ts` |
| M3 | Per-step friction funnel events (opened → step1 → confirm → saved) if F1 lands, so "successful-change rate under high friction" is directly measurable | `privacy-tracking.ts` |
| M4 | Reconcile/retire `experiment-export` route (one source of truth) | `research/experiment-export/route.ts` |

### Phase 5 — Instruments, IRB, dashboard (P1)
| ID | Item | Files |
|----|------|-------|
| S1 | Replace placeholder surveys with validated scales (per D3), set `status='active'`, verify cron delivery + scoring end-to-end on a test user with shifted enrollment date | migration 051 (or admin UI), `survey-delivery.ts` |
| S2 | Add survey delivery/submission funnel per timepoint to the researcher dashboard | `research-dashboard.ts`, `admin/research/page.tsx` |
| S3 | Real consent + debrief copy (per D4), version-bump `CONSENT_FORM_VERSION` | `consent-gate.tsx`, `debrief/page.tsx` |

### Phase 6 — Pilot gate (P0 before any participant data)
| ID | Item |
|----|------|
| V1 | Integration tests for: enrollment/assignment balance, server change-logging, snapshot cron, export aggregates + PII-absence, referral redeem/award, survey delivery |
| V2 | Simulated cohort dry run (scripted N≈60 across all cells): confirm randomization balance (`checkBalance`), logging completeness, snapshots, referral flow, survey deliveries — the prospectus §7 checklist — via the dashboard + a full export loaded in R/Python |

### Suggested order
I1–I3 immediately (nothing runs without them) → D1–D4 with Dr. Keith in parallel →
F2, F4, E1–E2, M1–M2 (design-independent, start now) → F1, F3, M3 once D1/D2 land →
S1–S3 → V1–V2 gate → pilot.
