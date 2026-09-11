-- replication_study_revert.sql
--
-- NOT a migration. Reverses replication_study_switch.sql (same directory).
-- Gated on the SAME decision as the switch script: D-R1 (see
-- FindamineResearch/Privacy_Fatigue_Replication_Study_Design.md). Only run
-- this if the mentor/IRB record backing D-R1 calls for rolling the
-- 'privacy_fatigue_rep_2026' handoff back to the 'privacy_pilot_2026' pilot
-- (e.g. the replication is paused/cancelled and the pilot should resume
-- enrolling participants).
--
-- What this script does, in order (mirrors the switch script's steps):
--   1. Pauses the replication study: sets
--      privacy_fatigue_rep_2026.auto_enroll = false and status = 'paused'.
--      The treatment_studies row itself is NOT deleted — existing
--      enrollments/dimension_assignments/survey_responses tied to it are
--      preserved for analysis. Delete it manually only if you are certain
--      no data needs to be retained.
--   2. Resumes the pilot: sets privacy_pilot_2026.auto_enroll = true and
--      status = 'active'.
--   3. Unlinks privacy_control_complexity and privacy_default from
--      privacy_fatigue_rep_2026 in treatment_study_dimensions (so a future
--      re-run of replication_study_switch.sql starts from a clean slate).
--      privacy_friction was never linked by the switch script, so there is
--      nothing to unlink for it here.
--   5. survey_schedules: same no-op as the switch script — 004 defines no
--      study-referencing column on survey_schedules, so there is nothing to
--      revert. The DO block below emits a confirming NOTICE only.
--   6. Prints a summary confirming the pilot is active again and that the
--      replication study's dimension links are gone.
--
-- Re-run safety: idempotent — safe to run more than once.

-- ── 1. Pause the replication study (row kept for data retention) ─────────
UPDATE public.treatment_studies
   SET auto_enroll = false,
       status      = 'paused'
 WHERE study_code = 'privacy_fatigue_rep_2026';

-- ── 2. Resume the pilot ───────────────────────────────────────────────────
UPDATE public.treatment_studies
   SET auto_enroll = true,
       status      = 'active'
 WHERE study_code = 'privacy_pilot_2026';

-- ── 3. Unlink dimensions from the replication study ───────────────────────
DO $$
DECLARE
  v_study_id UUID;
BEGIN
  SELECT id INTO v_study_id
    FROM public.treatment_studies
   WHERE study_code = 'privacy_fatigue_rep_2026';

  IF v_study_id IS NULL THEN
    RAISE NOTICE 'privacy_fatigue_rep_2026 study not found — nothing to unlink.';
  ELSE
    DELETE FROM public.treatment_study_dimensions
     WHERE study_id = v_study_id
       AND dimension_id IN (
         SELECT id FROM public.treatment_dimensions
          WHERE name IN ('privacy_control_complexity', 'privacy_default')
       );
  END IF;

  -- ── 5. survey_schedules re-pointing: confirmed no-op (see header) ──────
  RAISE NOTICE 'survey_schedules has no study-referencing column in 004_surveys_research_moderation.sql (columns: id, survey_id, trigger_type, trigger_config, active, created_at) — nothing to revert.';
END $$;

-- ── 6. Summary ─────────────────────────────────────────────────────────
SELECT
  study_code,
  name,
  status,
  auto_enroll,
  target_sample_size
FROM public.treatment_studies
WHERE study_code IN ('privacy_pilot_2026', 'privacy_fatigue_rep_2026')
ORDER BY study_code;

SELECT
  ts.study_code,
  td.name AS dimension_name,
  tsd.sort_order,
  tsd.active_levels
FROM public.treatment_study_dimensions tsd
JOIN public.treatment_studies ts ON ts.id = tsd.study_id
JOIN public.treatment_dimensions td ON td.id = tsd.dimension_id
WHERE ts.study_code = 'privacy_fatigue_rep_2026';
