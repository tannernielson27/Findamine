-- replication_study_switch.sql
--
-- NOT a migration. This is a decision-gated, ready-to-run operational script,
-- kept in docs/sql/ (not supabase/migrations/) precisely because it must NOT
-- run automatically. It is gated on decision D-R1 (the honors-thesis pilot
-- "privacy_pilot_2026" hands off enrollment to the ICIS-replication study
-- "privacy_fatigue_rep_2026"). Do not run this against any environment until
-- D-R1 has been signed off by the mentor/IRB record referenced in
-- FindamineResearch/Privacy_Fatigue_Replication_Study_Design.md.
--
-- Depends on migration 052 (being authored by another agent concurrently)
-- adding a nullable `active_levels TEXT[]` column to
-- public.treatment_study_dimensions. This script assumes that column already
-- exists — apply 052 first, or step 3 below will fail with an undefined
-- column error.
--
-- What this script does, in order:
--   1. Inserts treatment_studies row 'privacy_fatigue_rep_2026' if missing
--      (name "Privacy fatigue replication 2026", target_sample_size 240,
--      auto_enroll true, status 'active').
--   2. Pauses the existing pilot: sets privacy_pilot_2026.auto_enroll = false
--      and status = 'paused' (stops new participants from entering the
--      pilot; existing enrollees/assignments/responses are untouched).
--   3. Links treatment_dimensions to the new study via
--      treatment_study_dimensions:
--        - privacy_control_complexity, sort_order 0 (no active_levels
--          restriction — all 3 defined levels remain eligible for
--          assignment).
--        - privacy_default, sort_order 1, active_levels =
--          ARRAY['public','private'] (the 'neutral' level of privacy_default
--          is intentionally excluded from the replication study; see the
--          2014 model's 2-cell public/private manipulation).
--      privacy_friction is deliberately NOT linked to the new study — the
--      replication targets the original Keith et al. (2014) design, which
--      does not include a change-friction factor.
--   5. survey_schedules re-pointing: `supabase/migrations/004_surveys_
--      research_moderation.sql` defines survey_schedules as
--      (id, survey_id, trigger_type, trigger_config, active, created_at) —
--      there is NO column on survey_schedules that references a study id
--      (schedules are keyed off survey_id only; study targeting happens via
--      target_roles on the survey / dimension_assignments, not via
--      survey_schedules). There is therefore nothing to re-point here. This
--      step is a documented no-op; the DO block below only emits a NOTICE
--      confirming that fact so a future column addition doesn't silently
--      make this script incomplete.
--   6. Prints a summary of the resulting study, its dimension links, and
--      each link's active_levels.
--
-- Re-run safety: steps are idempotent (ON CONFLICT / guarded UPDATE-by-
-- current-value), so this script can be re-applied without side effects if
-- run twice.
--
-- To undo, run replication_study_revert.sql (same directory).

-- ── 1. Create the replication study (idempotent on study_code) ───────────
INSERT INTO public.treatment_studies
  (study_code, name, description, status, target_sample_size, auto_enroll)
VALUES
  ('privacy_fatigue_rep_2026',
   'Privacy fatigue replication 2026',
   'Direct replication of Keith, Evans, Lowry & Babb (2014, ICIS), '
   || '"Privacy fatigue: The effect of privacy control complexity on '
   || 'consumer electronic information disclosure." Gated on decision D-R1.',
   'active', 240, true)
ON CONFLICT (study_code) DO NOTHING;

-- ── 2. Pause the existing pilot ───────────────────────────────────────────
UPDATE public.treatment_studies
   SET auto_enroll = false,
       status      = 'paused'
 WHERE study_code = 'privacy_pilot_2026';

-- ── 3. Link dimensions to the replication study ───────────────────────────
DO $$
DECLARE
  v_study_id      UUID;
  v_complexity_id UUID;
  v_default_id    UUID;
  v_friction_id   UUID;
  v_col_exists    BOOLEAN;
BEGIN
  SELECT id INTO v_study_id
    FROM public.treatment_studies
   WHERE study_code = 'privacy_fatigue_rep_2026';
  IF v_study_id IS NULL THEN
    RAISE EXCEPTION 'privacy_fatigue_rep_2026 study not found after insert step (unexpected)';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'treatment_study_dimensions'
       AND column_name = 'active_levels'
  ) INTO v_col_exists;
  IF NOT v_col_exists THEN
    RAISE EXCEPTION 'treatment_study_dimensions.active_levels does not exist yet — apply migration 052 first';
  END IF;

  SELECT id INTO v_complexity_id
    FROM public.treatment_dimensions
   WHERE name = 'privacy_control_complexity';
  IF v_complexity_id IS NULL THEN
    RAISE EXCEPTION 'privacy_control_complexity dimension not found (apply 044 first)';
  END IF;

  SELECT id INTO v_default_id
    FROM public.treatment_dimensions
   WHERE name = 'privacy_default';
  IF v_default_id IS NULL THEN
    RAISE EXCEPTION 'privacy_default dimension not found (apply 044 first)';
  END IF;

  -- privacy_control_complexity: linked, no active_levels restriction.
  INSERT INTO public.treatment_study_dimensions (study_id, dimension_id, sort_order, active_levels)
  VALUES (v_study_id, v_complexity_id, 0, NULL)
  ON CONFLICT (study_id, dimension_id)
    DO UPDATE SET sort_order = EXCLUDED.sort_order;

  -- privacy_default: linked, restricted to public/private (2014 design).
  INSERT INTO public.treatment_study_dimensions (study_id, dimension_id, sort_order, active_levels)
  VALUES (v_study_id, v_default_id, 1, ARRAY['public','private'])
  ON CONFLICT (study_id, dimension_id)
    DO UPDATE SET sort_order    = EXCLUDED.sort_order,
                  active_levels = EXCLUDED.active_levels;

  -- privacy_friction: intentionally NOT linked. If a prior run linked it
  -- (e.g. this study id was reused by mistake), do not silently unlink it
  -- here — that's a manual decision. We only confirm-by-absence below.
  SELECT id INTO v_friction_id
    FROM public.treatment_dimensions
   WHERE name = 'privacy_friction';
  IF v_friction_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.treatment_study_dimensions
     WHERE study_id = v_study_id AND dimension_id = v_friction_id
  ) THEN
    RAISE NOTICE 'privacy_friction is linked to privacy_fatigue_rep_2026 — this script does not link it and does not expect it to be linked; review manually.';
  END IF;

  -- ── 5. survey_schedules re-pointing: confirmed no-op (see header) ──────
  RAISE NOTICE 'survey_schedules has no study-referencing column in 004_surveys_research_moderation.sql (columns: id, survey_id, trigger_type, trigger_config, active, created_at) — nothing to re-point.';
END $$;

-- ── 6. Summary ─────────────────────────────────────────────────────────
SELECT
  ts.study_code,
  ts.name,
  ts.status,
  ts.auto_enroll,
  ts.target_sample_size,
  td.name        AS dimension_name,
  tsd.sort_order,
  tsd.active_levels
FROM public.treatment_studies ts
JOIN public.treatment_study_dimensions tsd ON tsd.study_id = ts.id
JOIN public.treatment_dimensions td ON td.id = tsd.dimension_id
WHERE ts.study_code = 'privacy_fatigue_rep_2026'
ORDER BY tsd.sort_order;
