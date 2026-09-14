# Workstream D — Production Readiness: Findings & Status

**Date:** 2026-07-01
**Branch:** `feat/workstream-b-engagement`
**Author:** engagement/quality pass (B/C/D). D is largely **Workstream A's domain**
(research-critical paths); this note records what was verified, what was fixed, and
what still needs A-owner / mentor / infra action before the pilot.

> Guardrails respected: no change to the privacy manipulation, referral mechanics,
> A5 enforcement, or the logging/enrollment/snapshot pipelines. D1 additions are
> behavior-preserving refactors + tests only.

---

## D1 — Test coverage for research-critical paths ✅ (partial, shipped)

**Done:** extracted the pure cores of two untested research-critical modules and
covered them (behavior-preserving; DB wrappers delegate to the pure functions):

- `survey-scoring.ts` → `scoreAnswers(questions, answers)`: subscale grouping,
  reverse coding (5/7-point + explicit `scale_config.max`), mean rounding,
  missing/NaN handling. **10 tests.** (Reverse-coding errors are a classic cause of
  silently invalid survey data — now guarded.)
- `research-export.ts` → `participantId`, `escapeField`, `serializeTable`:
  de-identified id format and CSV/TSV escaping so separators/quotes/newlines inside
  values can't corrupt columns. **9 tests.**

**Already covered (verified):** `computePrivacyIndex` (privacy-tracking.test.ts:
0/1 bounds, empty, monotonic, ordering), enrollment balance/idempotency
(enrollment.test.ts), privacy enforcement matrix (privacy-enforcement.test.ts),
privacy tracking classification (privacy-tracking.test.ts), referral award
(referral.test.ts).

**Still uncovered (needs mock-DB or integration harness, not pure-testable):**
- `randomization.assignParticipant` / `checkBalance` — the block-randomization +
  balance logic is inline in async DB functions. Extracting a pure
  `pickAssignment(dimensions, counts)` would make the P0 assignment path testable;
  deferred as it edits A's assignment core (recommend A-owner does it).
- `generateResearchExport` end-to-end aggregation (joins) — needs seeded fixtures
  (see D5).
- Cron routes (privacy-snapshots, survey-deliveries, reengagement) — need a
  Supabase test harness.

**Recommendation:** add a lightweight Supabase mock (or `@supabase/*` test double)
so the DB-coupled research paths (assignment, export joins, cron materialization)
get integration coverage before the pilot. This is the largest remaining D1 gap.

---

## D2 — RLS / security audit on new surfaces ✅ (reviewed)

**Reviewed:** migrations 045 (privacy_index_snapshots), 046 (referral/minion), and
the new/modified API routes (referrals GET, leaderboard `me`, reengagement cron).

**Sound:**
- `referral_codes` / `minion_links`: RLS enabled, **SELECT restricted** to
  owner/involved parties or admin/researcher, and **no INSERT/UPDATE/DELETE
  policies** → RLS denies direct client writes. Codes and minion links can only be
  created by the server (service role) through `referral.ts`, which enforces
  no-self / one-recruiter / valid-code. Clients cannot forge referral relationships.
- `minion_links` integrity: `minion_id UNIQUE` (one recruiter per minion),
  `no_self_minion CHECK`. Good.
- Referral code generation now uses `crypto.randomInt` (CSPRNG) — codes aren't
  guessable/enumerable (fixed this branch).
- New read surfaces (referrals GET, kudos, leaderboard) route embedded profiles
  through `filterProfileForViewer` — A5 enforcement intact.
- `reengagement` cron uses `CRON_SECRET` bearer auth with constant-time compare
  (matches the other crons).

**Recommendations (low severity, for A-owner):**
1. `privacy_index_snapshots` has a `pis_own_insert` policy (`user_id = self`). All
   snapshot inserts are server-side (enrollment/change/cron via service role), so a
   client-insert policy isn't needed — consider dropping it to prevent a user from
   forging their own trajectory points if any client-reachable insert path ever
   appears. Defense-in-depth only; not currently exploitable.
2. Run Supabase **advisors** (`get_advisors`) against the project after applying
   044–047 to catch any missing-RLS / policy-gap regressions before the pilot.
3. App code uses the **service-role client** (bypasses RLS) with authz enforced in
   code — RLS is the defense-in-depth layer. Keep new endpoints `getAuthUser`/role
   gated (verified for the surfaces touched here).

---

## D3 — Load / scale for a full class in the field ⚠️ (analysis)

Can't load-test here; static review of the hot paths:

- **Leaderboard realtime** (`components/social/leaderboard.tsx`): subscribes to
  `play_sessions` UPDATE and **refetches the whole board on every change**. With a
  full class scoring simultaneously this is a refetch storm (N clients × M score
  events). **Recommend:** debounce the refetch (e.g. 2–5 s) or apply the realtime
  payload incrementally instead of refetching. *(Owned by A/prior UI; not changed
  here to avoid scope creep — flagged.)*
- **Reengagement cron** (this branch): does ~4 queries per enrolled participant
  (last session, last find, last nudge, prefs) — an N+1. Fine for a pilot class
  (tens–hundreds, runs once daily off-peak). **Recommend** batching into set-based
  queries if N grows large; documented as an accepted pilot-scale limitation.
- **`play/[huntId]/answer`**: recomputes the session total by summing all
  completions per answer — O(finds) per submit, negligible at hunt sizes.
- **`generateResearchExport`**: several `.in(userIds)` batch reads — fine at pilot
  N; watch memory if the study grows to thousands.

**Recommendation:** a short k6/Artillery script hitting `arrive` + `answer` +
leaderboard for ~30 concurrent players before the pilot would validate the GPS
ping + realtime path, which is the real concurrency risk.

---

## D4 — IRB / consent surface 🚧 (needs mentor / product decision)

Out of scope for a unilateral engineering change — this is Dr. Keith's / the IRB's
domain. Needs decisions on:
- Adult-only consent copy + gating on the enrollment path.
- Debrief flow (post-study explanation of the privacy manipulation).
- Confirm `withdrawn_at` is honored everywhere participant data is read.
  *(Verified: `generateResearchExport` and the survey/reengagement crons already
  filter `withdrawn_at IS NULL`.)*

**Action:** schedule with the mentor; hand engineering the finalized consent/debrief
copy + the required gating rule.

---

## D5 — Export QA dry run 🚧 (partial)

- **Done:** de-identification + CSV/TSV serialization are now unit-tested (D1). The
  export emits **no user-controlled free-text** (only enums, ISO timestamps,
  `P0001` ids, numbers), so CSV/formula injection is not exploitable.
- **Still needed (pre-pilot):** a live dry run against seeded pilot data to verify
  the aggregation **joins** (hunts/finds/points/index trajectory/survey subscales)
  produce correct per-participant rows, row count == enrolled non-withdrawn, and no
  PII column leaks. Load the output into R/Python and reproduce a primary outcome.

---

## Summary

| Task | Status | Owner |
|------|--------|-------|
| D1 scoring/export tests | ✅ shipped | done here |
| D1 assignment/export-join/cron coverage | ⬜ gap | A-owner (needs DB mock) |
| D2 RLS audit | ✅ reviewed, minor recs | A-owner to action recs |
| D3 scale | ⚠️ leaderboard refetch storm flagged | A/UI owner |
| D4 IRB/consent | 🚧 blocked | mentor |
| D5 export dry run | 🚧 needs live data | A-owner |
