-- 064_neutral_survey_framing.sql
-- Alignment fixes from the 2026-09-14 review against
-- FindamineResearch/Privacy_Fatigue_Replication_Study_Design.md.
--
-- 1. Participant-facing survey titles and descriptions become neutral. The
--    design (§4.5, §7) uses incomplete-disclosure consent that does not name
--    privacy as the object of study; titles like "Privacy Concern & Fatigue
--    (Baseline)" rendered on the survey page and the survey inbox undid that.
--    The items themselves still ask about privacy, as the 2014 study did.
--
-- 2. The T1 copy of ease of use (eou_*_t1, migration 055) is reworded as an
--    expectation. The design measures EXPECTED ease of use before use; the
--    055 wording ("was easy for me") was retrospective. Still draft pending
--    mentor sign-off (D-R3), like every item.
--
-- Surveys are located by their schedule timepoint, not by title, so this is
-- idempotent and independent of the current titles.
--
-- NOTE: 051, 055 and 058 find their surveys BY TITLE. After this migration a
-- re-run of those three skips with a NOTICE. To activate the instruments after
-- sign-off, use the timepoint form instead of the title form in their headers:
--   UPDATE public.surveys SET status = 'active'
--    WHERE id IN (SELECT survey_id FROM public.survey_schedules
--                  WHERE trigger_config->>'timepoint' IN ('T1','T2','T3'));

DO $$
DECLARE
  v_t1 UUID;
  v_t2 UUID;
  v_t3 UUID;
BEGIN
  SELECT survey_id INTO v_t1 FROM public.survey_schedules
   WHERE trigger_config->>'timepoint' = 'T1' ORDER BY created_at LIMIT 1;
  SELECT survey_id INTO v_t2 FROM public.survey_schedules
   WHERE trigger_config->>'timepoint' = 'T2' ORDER BY created_at LIMIT 1;
  SELECT survey_id INTO v_t3 FROM public.survey_schedules
   WHERE trigger_config->>'timepoint' = 'T3' ORDER BY created_at LIMIT 1;

  IF v_t1 IS NULL OR v_t2 IS NULL OR v_t3 IS NULL THEN
    RAISE NOTICE 'Study survey schedules not found; skipping 064 (seed 047 first).';
    RETURN;
  END IF;

  UPDATE public.surveys
     SET title = 'App Check-in (Start)',
         description = 'A few quick questions about you and your experience with Findamine.'
   WHERE id = v_t1;
  UPDATE public.surveys
     SET title = 'App Check-in (Midpoint)',
         description = 'A few quick questions about your experience with Findamine so far.'
   WHERE id = v_t2;
  UPDATE public.surveys
     SET title = 'App Check-in (End)',
         description = 'A few final questions about your experience with Findamine.'
   WHERE id = v_t3;

  UPDATE public.survey_questions SET question_text =
    'I expect learning to use the privacy settings in Findamine will be easy for me.'
   WHERE survey_id = v_t1 AND item_code = 'eou_1_t1';
  UPDATE public.survey_questions SET question_text =
    'I expect it will be easy to get the privacy settings to do what I want them to do.'
   WHERE survey_id = v_t1 AND item_code = 'eou_2_t1';
  UPDATE public.survey_questions SET question_text =
    'I expect my interaction with Findamine''s privacy settings will be clear and understandable.'
   WHERE survey_id = v_t1 AND item_code = 'eou_3_t1';
  UPDATE public.survey_questions SET question_text =
    'Overall, I expect Findamine''s privacy settings will be easy to use.'
   WHERE survey_id = v_t1 AND item_code = 'eou_4_t1';
END $$;
