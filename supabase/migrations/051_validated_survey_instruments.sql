-- 051_validated_survey_instruments.sql
-- Replaces the 047 PLACEHOLDER items with validated scale items:
--
--   T1  — Privacy concern: IUIPC (Malhotra, Kim, & Agarwal, 2004), 10 items,
--         7-point Likert. Dimensional structure (control/awareness/collection)
--         is encoded in item_code; all items share subscale 'privacy_concern'
--         so the export emits one baseline concern score (H5).
--   T1/T2/T3 — Privacy fatigue: adapted from Choi, Park, & Jung (2018), 6 items
--         (emotional exhaustion + cynicism, encoded in item_code), subscale
--         'privacy_fatigue'. Measured at baseline too, per prospectus §5.5.
--   T2/T3 — Perceived ease of use of the privacy settings: adapted from
--         Davis (1989), 4 items, subscale 'ease_of_use'.
--
-- Surveys stay status='draft': final wording is subject to mentor/IRB sign-off
-- (docs/PROSPECTUS_GAP_PLAN.md, D3). The delivery cron only sends 'active'
-- surveys — to go live after sign-off run:
--   UPDATE public.surveys SET status = 'active'
--    WHERE title IN ('Privacy Concern & Fatigue (Baseline)',
--                    'Privacy Fatigue & Ease of Use (Midpoint)',
--                    'Privacy Fatigue & Ease of Use (Endpoint)');

DO $$
DECLARE
  v_t1 UUID;
  v_t2 UUID;
  v_t3 UUID;
BEGIN
  SELECT id INTO v_t1 FROM public.surveys WHERE title = 'Privacy Concern (Baseline)';
  SELECT id INTO v_t2 FROM public.surveys WHERE title = 'Privacy Fatigue & Ease of Use (Midpoint)';
  SELECT id INTO v_t3 FROM public.surveys WHERE title = 'Privacy Fatigue & Ease of Use (Endpoint)';

  IF v_t1 IS NULL OR v_t2 IS NULL OR v_t3 IS NULL THEN
    RAISE NOTICE 'Seeded 047 surveys not found (likely no admin existed at seed time); skipping instrument load.';
    RETURN;
  END IF;

  -- Wipe the placeholders.
  DELETE FROM public.survey_questions WHERE survey_id IN (v_t1, v_t2, v_t3);

  UPDATE public.surveys
     SET title = 'Privacy Concern & Fatigue (Baseline)',
         description = 'T1 baseline: IUIPC privacy concern (Malhotra et al., 2004) + privacy fatigue (adapted from Choi et al., 2018). 7-point Likert (1 = strongly disagree, 7 = strongly agree). Draft pending mentor/IRB sign-off.'
   WHERE id = v_t1;
  UPDATE public.surveys
     SET description = 'T2 (~week 3): privacy fatigue (adapted from Choi et al., 2018) + perceived ease of use of the privacy settings (adapted from Davis, 1989). 7-point Likert. Draft pending mentor/IRB sign-off.'
   WHERE id = v_t2;
  UPDATE public.surveys
     SET description = 'T3 (~week 6): privacy fatigue (adapted from Choi et al., 2018) + perceived ease of use of the privacy settings (adapted from Davis, 1989). 7-point Likert. Draft pending mentor/IRB sign-off.'
   WHERE id = v_t3;

  -- ── T1: IUIPC privacy concern (10) + privacy fatigue (6) ────────
  INSERT INTO public.survey_questions
    (survey_id, item_code, question_text, question_type, scale_config, reverse_coded, subscale, sort_order)
  VALUES
    (v_t1, 'iuipc_ctrl_1',  'Online privacy is really a matter of my right to exercise control over decisions about how my information is collected, used, and shared.', 'likert_7', '{"min":1,"max":7}', false, 'privacy_concern', 1),
    (v_t1, 'iuipc_ctrl_2',  'Control of personal information lies at the heart of my privacy.', 'likert_7', '{"min":1,"max":7}', false, 'privacy_concern', 2),
    (v_t1, 'iuipc_ctrl_3',  'I believe that my online privacy is invaded when control is lost or unwillingly reduced.', 'likert_7', '{"min":1,"max":7}', false, 'privacy_concern', 3),
    (v_t1, 'iuipc_aware_1', 'Apps and websites seeking information from me should disclose the way my data are collected, processed, and used.', 'likert_7', '{"min":1,"max":7}', false, 'privacy_concern', 4),
    (v_t1, 'iuipc_aware_2', 'A good privacy policy should have a clear and conspicuous disclosure.', 'likert_7', '{"min":1,"max":7}', false, 'privacy_concern', 5),
    (v_t1, 'iuipc_aware_3', 'It is very important to me that I am aware and knowledgeable about how my personal information will be used.', 'likert_7', '{"min":1,"max":7}', false, 'privacy_concern', 6),
    (v_t1, 'iuipc_coll_1',  'It usually bothers me when apps or websites ask me for personal information.', 'likert_7', '{"min":1,"max":7}', false, 'privacy_concern', 7),
    (v_t1, 'iuipc_coll_2',  'When apps or websites ask me for personal information, I sometimes think twice before providing it.', 'likert_7', '{"min":1,"max":7}', false, 'privacy_concern', 8),
    (v_t1, 'iuipc_coll_3',  'It bothers me to give personal information to so many apps and websites.', 'likert_7', '{"min":1,"max":7}', false, 'privacy_concern', 9),
    (v_t1, 'iuipc_coll_4',  'I am concerned that apps and websites are collecting too much personal information about me.', 'likert_7', '{"min":1,"max":7}', false, 'privacy_concern', 10),
    (v_t1, 'fatigue_exh_1', 'I feel drained from dealing with online privacy issues.', 'likert_7', '{"min":1,"max":7}', false, 'privacy_fatigue', 11),
    (v_t1, 'fatigue_exh_2', 'I am tired of thinking about my online privacy.', 'likert_7', '{"min":1,"max":7}', false, 'privacy_fatigue', 12),
    (v_t1, 'fatigue_exh_3', 'Managing my privacy settings takes more effort than I can give.', 'likert_7', '{"min":1,"max":7}', false, 'privacy_fatigue', 13),
    (v_t1, 'fatigue_cyn_1', 'I have become less interested in online privacy issues.', 'likert_7', '{"min":1,"max":7}', false, 'privacy_fatigue', 14),
    (v_t1, 'fatigue_cyn_2', 'I doubt that adjusting my privacy settings makes any real difference.', 'likert_7', '{"min":1,"max":7}', false, 'privacy_fatigue', 15),
    (v_t1, 'fatigue_cyn_3', 'Trying to protect my personal information online feels pointless.', 'likert_7', '{"min":1,"max":7}', false, 'privacy_fatigue', 16);

  -- ── T2 + T3: privacy fatigue (6) + perceived ease of use (4) ────
  INSERT INTO public.survey_questions
    (survey_id, item_code, question_text, question_type, scale_config, reverse_coded, subscale, sort_order)
  SELECT s.survey_id, q.item_code, q.question_text, 'likert_7', '{"min":1,"max":7}'::jsonb, false, q.subscale, q.sort_order
  FROM (VALUES (v_t2), (v_t3)) AS s(survey_id),
  (VALUES
    ('fatigue_exh_1', 'I feel drained from dealing with online privacy issues.', 'privacy_fatigue', 1),
    ('fatigue_exh_2', 'I am tired of thinking about my online privacy.', 'privacy_fatigue', 2),
    ('fatigue_exh_3', 'Managing my privacy settings takes more effort than I can give.', 'privacy_fatigue', 3),
    ('fatigue_cyn_1', 'I have become less interested in online privacy issues.', 'privacy_fatigue', 4),
    ('fatigue_cyn_2', 'I doubt that adjusting my privacy settings makes any real difference.', 'privacy_fatigue', 5),
    ('fatigue_cyn_3', 'Trying to protect my personal information online feels pointless.', 'privacy_fatigue', 6),
    ('eou_1', 'Learning to use the privacy settings in Findamine was easy for me.', 'ease_of_use', 7),
    ('eou_2', 'I find it easy to get the privacy settings to do what I want them to do.', 'ease_of_use', 8),
    ('eou_3', 'My interaction with Findamine''s privacy settings is clear and understandable.', 'ease_of_use', 9),
    ('eou_4', 'Overall, I find Findamine''s privacy settings easy to use.', 'ease_of_use', 10)
  ) AS q(item_code, question_text, subscale, sort_order);
END $$;
