# B1 — Play Loop Audit & Polish: Findings

**Date:** 2026-06-30
**Branch:** `feat/workstream-b-engagement`
**Scope reviewed:** `src/app/(app)/play/[huntId]/page.tsx` (1,110 lines), `src/components/play/*`
(`stop-flow-stepper`, `hot-cold-meter`, `challenge-input`), `src/components/ui/celebration.tsx`,
`src/app/api/v1/play/[huntId]/answer/route.ts` (response shape), design tokens in `globals.css`.

> Research-integrity note: B1 touches only gameplay *feel* (pacing, feedback, celebration,
> meter). It does **not** alter scoring math, the answer/points pipeline, the referral economy,
> privacy enforcement, or any logged research event. Re-engagement/nudges are out of scope here.

---

## What already works well (keep)

- **Stop flow stepper** is clear and themed (icons, active/complete states, design tokens).
- **Progress bar** animates width with a brand gradient — good momentum signal.
- **Hunt-complete summary** is genuinely nice: trophy, three stat cards (points / stops / time),
  handwritten subhead. Not template-generic.
- **Challenge inputs** are rich and varied (MC, numeric, sorting, photo, sketch, audio) with
  keyboard/text fallbacks and ARIA. Solid.
- **Age-band theming** drives celebration intensity (confetti count/gravity, adult = minimal).

## Problems found (ranked by impact on fun/motivation)

1. **The reward payoff is buried behind an optional chore.** On a correct answer the flow is:
   submit → generic confetti ("Great job! You got it!") → **Geo-Selfie photo step** → *then* the
   feedback screen finally reveals the points. The single biggest dopamine beat (your score) lands
   *after* an optional camera task. Players who skip the photo still wait a screen for the number.
   → **Fix:** surface the earned points *in the celebration overlay itself*, immediately on submit.

2. **Celebration is one-note.** Message and confetti are identical whether you nailed it on the
   first try, scraped a partial, or exhausted attempts. There's no "perfect!" beat, no escalation.
   `setCelebrationMessage("Great job! You got it!")` ignores `score`, `breakdown`, and attempt count.
   → **Fix:** derive message + intensity from the result (perfect / correct / partial / effort).

3. **The "you found it!" arrival moment is silent.** Reaching the GPS location — arguably the most
   satisfying beat in a *scavenger hunt* — just flips `setStep("challenge")` with no acknowledgement.
   → **Fix:** a brief arrival celebration beat ("You found it!") before the challenge.

4. **No running score during play.** Cumulative points are invisible until the final summary, so
   there's no per-stop sense of "the number going up." A persistent total builds momentum.
   → **Fix:** a small running-score chip by the progress bar, accumulated client-side from completions
   (display only — no scoring-mechanic change).

5. **Hot/cold meter has no climax.** The "burning" zone (you're right on top of it) looks the same as
   "warm." The meter is also small and easy to miss next to the map.
   → **Fix:** pulse/emphasis in the burning zone (compositor-friendly transform/opacity only).

6. **No `prefers-reduced-motion` support anywhere.** Confetti, framer-motion overlays, and the meter
   transition all fire regardless of the OS setting. This is both an accessibility gap (web rules
   require it) and necessary hygiene before *adding* more motion in B1.
   → **Fix:** a `useReducedMotion` hook + a global CSS guard; gate confetti and heavy motion on it.
   (Full motion audit is C4; this is the minimum responsible coverage for the beats B1 adds.)

7. **Reading-check failure is punishing** (wipes all answers, red error). Minor; noted, not fixed in
   B1's first pass to avoid scope creep — candidate for a later gentleness pass.

## Plan for this pass (design-intentional, mechanics-safe)

| # | Change | New/!modified |
|---|--------|---------------|
| a | `lib/play/celebration.ts` — pure `celebrationForResult()` → message + intensity + tone | new (tested) |
| b | `lib/hooks/use-reduced-motion.ts` — subscribe to `prefers-reduced-motion` | new |
| c | `celebration.tsx` — accept `intensity` + `subMessage` (points); respect reduced motion | modified |
| d | `hot-cold-meter.tsx` — burning-zone pulse; reduced-motion aware | modified |
| e | `play page` — points in celebration, arrival beat, running-score chip, richer messages | modified |
| f | `globals.css` — `@media (prefers-reduced-motion: reduce)` guard | modified |

Tests: `src/__tests__/celebration.test.ts` for the pure message/intensity logic. `tsc --noEmit`
clean. The answer API, scoring, points ledger, referral award, and all research logging are
untouched.
</content>
</invoke>
