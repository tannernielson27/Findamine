-- 054_t1_event_trigger.sql
-- T1 baseline becomes EVENT-triggered (Workstream B / Task B2).
--
-- Rationale: the baseline questionnaire must be answered after a participant has
-- SEEN their privacy controls but BEFORE they first save them (mirroring the
-- 2014 study this platform replicates). Creating T1 at enrollment (offset 0)
-- let participants answer it before ever looking at the controls.
--
-- Changes:
--   1. The existing T1 schedule (identified by trigger_config->>'timepoint' = 'T1')
--      switches from  time {offset_days: 0}  to
--        event {"timepoint":"T1","event":"privacy_view","expires_days":7}.
--      The app fires `privacy_view` via POST /api/v1/surveys/trigger when the
--      privacy settings page loads; the page then blocks Save until T1 is
--      submitted (src/app/(app)/settings/privacy/page.tsx).
--   2. A FALLBACK time schedule is added for the same survey:
--        time {"timepoint":"T1","offset_days":3,"expires_days":7,"fallback":true}
--      so a participant who never opens the privacy page still receives T1 on
--      day 3 via the daily cron.
--
-- Dedupe: survey-delivery.ts dedupes per (survey, user) across BOTH schedules
-- (any existing delivery for the survey suppresses the other path), so a
-- participant gets at most one T1 delivery. `fallback: true` is informational
-- (analysis can tell which path fired from delivery timing vs. privacy_view).
--
-- Idempotent: the UPDATE only touches a non-fallback 'time' T1 row; the INSERT
-- is skipped when a fallback row already exists. If the T1 survey was never
-- seeded (047 skips when no admin user exists), this migration is a no-op.

DO $$
DECLARE
  v_t1_survey UUID;
BEGIN
  -- 1. Flip the seeded time schedule to an event schedule.
  UPDATE public.survey_schedules
     SET trigger_type   = 'event',
         trigger_config = '{"timepoint":"T1","event":"privacy_view","expires_days":7}'::jsonb
   WHERE trigger_type = 'time'
     AND trigger_config->>'timepoint' = 'T1'
     AND COALESCE((trigger_config->>'fallback')::boolean, false) = false;

  -- 2. Add the day-3 time fallback for the same survey (once).
  SELECT survey_id INTO v_t1_survey
    FROM public.survey_schedules
   WHERE trigger_type = 'event'
     AND trigger_config->>'timepoint' = 'T1'
     AND trigger_config->>'event' = 'privacy_view'
   ORDER BY created_at
   LIMIT 1;

  IF v_t1_survey IS NULL THEN
    RAISE NOTICE 'No T1 schedule found; skipping T1 event-trigger migration (seed 047 first).';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.survey_schedules
     WHERE survey_id = v_t1_survey
       AND trigger_type = 'time'
       AND COALESCE((trigger_config->>'fallback')::boolean, false) = true
  ) THEN
    INSERT INTO public.survey_schedules (survey_id, trigger_type, trigger_config, active)
    VALUES (v_t1_survey, 'time',
            '{"timepoint":"T1","offset_days":3,"expires_days":7,"fallback":true}'::jsonb,
            true);
  END IF;
END $$;
