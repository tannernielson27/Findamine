-- 047_seed_study_surveys.sql
-- Seeds the T1/T2/T3 survey instruments + time-based schedules for the privacy
-- pilot (Workstream A / Task A7).
--
-- IMPORTANT: surveys are seeded as DRAFT with PLACEHOLDER items. The actual
-- validated scale items (privacy concern, privacy fatigue, perceived ease of use)
-- and their wording/citations are a research decision for the author + mentor.
-- The delivery cron only delivers surveys with status='active', so nothing reaches
-- participants until the real items are entered and each survey is activated.
--
-- Schedules use trigger_config.offset_days, measured from study enrollment:
--   T1 = 0 days (baseline), T2 = 21 days (midpoint), T3 = 42 days (endpoint).

DO $$
DECLARE
  v_admin UUID;
  v_t1 UUID;
  v_t2 UUID;
  v_t3 UUID;
BEGIN
  SELECT id INTO v_admin FROM public.users
    WHERE role IN ('admin', 'researcher') ORDER BY created_at LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE NOTICE 'No admin/researcher user found; skipping survey seed (seed later via admin UI).';
    RETURN;
  END IF;

  -- ── T1: Privacy Concern (baseline) ─────────────────────────────
  INSERT INTO public.surveys (title, description, status, target_roles, created_by)
  VALUES ('Privacy Concern (Baseline)',
          'T1 baseline. PLACEHOLDER — replace with the validated privacy-concern scale.',
          'draft', ARRAY['teen','parent','teacher','hunt_creator'], v_admin)
  RETURNING id INTO v_t1;

  INSERT INTO public.survey_questions (survey_id, item_code, question_text, question_type, scale_config, subscale, sort_order)
  VALUES
    (v_t1, 'concern_1', 'PLACEHOLDER concern item 1', 'likert_5', '{"min":1,"max":5}', 'privacy_concern', 1),
    (v_t1, 'concern_2', 'PLACEHOLDER concern item 2', 'likert_5', '{"min":1,"max":5}', 'privacy_concern', 2);

  INSERT INTO public.survey_schedules (survey_id, trigger_type, trigger_config, active)
  VALUES (v_t1, 'time', '{"offset_days":0,"timepoint":"T1","expires_days":7}', true);

  -- ── T2: Privacy Fatigue & Ease of Use (midpoint) ───────────────
  INSERT INTO public.surveys (title, description, status, target_roles, created_by)
  VALUES ('Privacy Fatigue & Ease of Use (Midpoint)',
          'T2 (~week 3). PLACEHOLDER — replace with validated fatigue + ease-of-use scales.',
          'draft', ARRAY['teen','parent','teacher','hunt_creator'], v_admin)
  RETURNING id INTO v_t2;

  INSERT INTO public.survey_questions (survey_id, item_code, question_text, question_type, scale_config, subscale, sort_order)
  VALUES
    (v_t2, 'fatigue_1', 'PLACEHOLDER fatigue item 1', 'likert_5', '{"min":1,"max":5}', 'privacy_fatigue', 1),
    (v_t2, 'fatigue_2', 'PLACEHOLDER fatigue item 2', 'likert_5', '{"min":1,"max":5}', 'privacy_fatigue', 2),
    (v_t2, 'eou_1', 'PLACEHOLDER ease-of-use item 1', 'likert_5', '{"min":1,"max":5}', 'ease_of_use', 3),
    (v_t2, 'eou_2', 'PLACEHOLDER ease-of-use item 2', 'likert_5', '{"min":1,"max":5}', 'ease_of_use', 4);

  INSERT INTO public.survey_schedules (survey_id, trigger_type, trigger_config, active)
  VALUES (v_t2, 'time', '{"offset_days":21,"timepoint":"T2","expires_days":10}', true);

  -- ── T3: Privacy Fatigue & Ease of Use (endpoint) ───────────────
  INSERT INTO public.surveys (title, description, status, target_roles, created_by)
  VALUES ('Privacy Fatigue & Ease of Use (Endpoint)',
          'T3 (~week 6). PLACEHOLDER — replace with validated fatigue + ease-of-use scales.',
          'draft', ARRAY['teen','parent','teacher','hunt_creator'], v_admin)
  RETURNING id INTO v_t3;

  INSERT INTO public.survey_questions (survey_id, item_code, question_text, question_type, scale_config, subscale, sort_order)
  VALUES
    (v_t3, 'fatigue_1', 'PLACEHOLDER fatigue item 1', 'likert_5', '{"min":1,"max":5}', 'privacy_fatigue', 1),
    (v_t3, 'fatigue_2', 'PLACEHOLDER fatigue item 2', 'likert_5', '{"min":1,"max":5}', 'privacy_fatigue', 2),
    (v_t3, 'eou_1', 'PLACEHOLDER ease-of-use item 1', 'likert_5', '{"min":1,"max":5}', 'ease_of_use', 3),
    (v_t3, 'eou_2', 'PLACEHOLDER ease-of-use item 2', 'likert_5', '{"min":1,"max":5}', 'ease_of_use', 4);

  INSERT INTO public.survey_schedules (survey_id, trigger_type, trigger_config, active)
  VALUES (v_t3, 'time', '{"offset_days":42,"timepoint":"T3","expires_days":10}', true);
END $$;
