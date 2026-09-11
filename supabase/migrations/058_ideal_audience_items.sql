-- 058_ideal_audience_items.sql
-- Storyline S7 "Can you get what you want?" (build plan D4).
--
-- Adds an "ideal audience" block to T1 and T3: for each of the eight privacy
-- fields, one single-choice item asking who the participant WANTS to be able
-- to see it. Paired with the participant's ACTUAL settings at submission time
-- (nearest privacy_index_snapshots row), the export computes a settings-error
-- score in the spirit of Madejski, Johnson & Bellovin (2012), "A Study of
-- Privacy Settings Errors in an Online Social Network", PERCOM Workshops:
-- mean absolute rank distance between ideal and actual audience over the
-- fields answered, 0 = perfect match, 1 = every field maximally wrong
-- (src/lib/utils/settings-error.ts). No manipulation; costs no statistical
-- power; the prediction is that error is lowest under moderate complexity.
--
-- Items use the existing `multiple_choice` question_type with `options`
-- (already rendered by the survey page), subscale 'ideal_audience', and are
-- excluded from Likert subscale means (survey-scoring.ts skips non-numeric
-- types). Surveys stay 'draft'; wording is draft pending D-R3 sign-off.
-- Sort order continues after 055 (T1 ends at 33, T3 at 16).
--
-- Idempotent: deletes any prior rows with these item_codes before inserting.

DO $$
DECLARE
  v_t1 UUID;
  v_t3 UUID;
  v_opts JSONB := '[{"value":"nobody","label":"Only me"},
                    {"value":"team","label":"My team"},
                    {"value":"class","label":"My class"},
                    {"value":"everyone","label":"Everyone"}]'::jsonb;
BEGIN
  SELECT id INTO v_t1 FROM public.surveys WHERE title = 'Privacy Concern & Fatigue (Baseline)';
  SELECT id INTO v_t3 FROM public.surveys WHERE title = 'Privacy Fatigue & Ease of Use (Endpoint)';

  IF v_t1 IS NULL OR v_t3 IS NULL THEN
    RAISE NOTICE 'T1/T3 surveys not found (apply 047 and 051 first); skipping ideal-audience items.';
    RETURN;
  END IF;

  DELETE FROM public.survey_questions
   WHERE survey_id IN (v_t1, v_t3)
     AND item_code LIKE 'ideal\_%' ESCAPE '\';

  INSERT INTO public.survey_questions
    (survey_id, item_code, question_text, question_type, options, scale_config, reverse_coded, subscale, sort_order)
  SELECT s.survey_id,
         'ideal_' || f.key,
         'Who do you WANT to be able to see your ' || f.label || '?',
         'multiple_choice',
         v_opts,
         '{}'::jsonb,
         false,
         'ideal_audience',
         s.base + f.ord
  FROM (VALUES (v_t1, 33), (v_t3, 16)) AS s(survey_id, base),
       (VALUES
         ('display_name',       'display name',            1),
         ('avatar',             'avatar / profile picture', 2),
         ('real_name',          'real name',               3),
         ('personality_scores', 'personality profile',     4),
         ('badges',             'achievement badges',      5),
         ('total_score',        'total score',             6),
         ('hunt_history',       'hunt history',            7),
         ('friends_list',       'friends list',            8)
       ) AS f(key, label, ord);
END $$;
