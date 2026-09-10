-- 055_privacy_fatigue_2014_constructs.sql
-- Adds the before-use and after-use constructs required by the full Keith,
-- Evans, Lowry & Babb (2014, ICIS) "Privacy fatigue" model, beyond the
-- privacy_concern / privacy_fatigue / ease_of_use items already seeded in
-- 047/051. All new items are 7-point Likert (question_type 'likert_7',
-- scale_config '{"min":1,"max":7}'), status stays 'draft' on all three
-- surveys, and item wording is a DRAFT adaptation pending mentor/IRB
-- sign-off — see decision D-R3 in
-- FindamineResearch/Privacy_Fatigue_Replication_Study_Design.md.
--
-- New subscales:
--   control_complexity  (3 items, T1 + T3) — perceived number/granularity of
--     privacy control features. Adapted from Thompson, Hamilton & Rust (2005),
--     "Feature Fatigue: When Product Capabilities Become Too Much of a Good Thing", Journal of Marketing Research 42(4) — "feature" perceptions of a control system.
--   control_capability   (3 items, T1 + T3) — perceived capability of the
--     controls to accomplish what the user wants. Adapted from Thompson,
--     Hamilton & Rust (2005) "capability" perceptions.
--   expected_utility     (3 items, T1 only) — belief that the controls will
--     let the user reach the settings they want. Defined per Keith, Evans,
--     Lowry & Babb (2014, ICIS), "Privacy fatigue: The effect of privacy
--     control complexity on consumer electronic information disclosure".
--   self_efficacy        (4 items, T1 only) — mobile-app self-efficacy,
--     adapted from Keith, Babb, Furner & Abdullat (2011), "The Role of Mobile Self-Efficacy in the Adoption of Location-Based Applications: An iPhone Experiment" (HICSS) — previously mis-cited as "Privacy Assurance
--     and Network Effects in the Adoption of Location-Based Services:
--     An iPhone Experiment" (ICIS) self-efficacy items, recast for a generic
--     new mobile app.
--   ease_of_use (T1 copy) — the same 4 Davis (1989) TAM-adapted items already
--     used at T2/T3 (item_codes 'eou_1'..'eou_4', subscale 'ease_of_use'),
--     duplicated into T1 with item_codes suffixed '_t1' so ease of use is
--     also captured BEFORE use (Keith et al. 2014's model treats before-use
--     and after-use ease of use as distinct constructs). NOTE (flag for
--     mentor review under D-R3): the wording ("Learning to use ... was easy
--     for me") presumes some exposure to the settings; at T1 this may need
--     re-framing to an expectation ("I expect learning to use ... will be
--     easy for me") rather than a retrospective claim. Left as a literal
--     copy here per task instructions — do not silently reword without
--     sign-off.
--
-- Sort order: continues after the existing items seeded by 051
-- (T1 currently ends at sort_order 16; T2 and T3 currently end at 10).
--
-- Idempotency: survey_questions has NO unique constraint on
-- (survey_id, item_code) (see 006_missing_tables.sql) so ON CONFLICT cannot
-- be used. Instead, this migration deletes any existing rows whose
-- item_code matches this migration's new set (scoped to survey + code)
-- before inserting, so it can be re-run safely.
--
-- Activation (unchanged from 051 — repeated here for convenience): the
-- delivery cron only sends surveys with status='active'. To go live after
-- mentor/IRB sign-off on ALL item wording (051's items AND this migration's):
--   UPDATE public.surveys SET status = 'active'
--    WHERE title IN ('Privacy Concern & Fatigue (Baseline)',
--                    'Privacy Fatigue & Ease of Use (Midpoint)',
--                    'Privacy Fatigue & Ease of Use (Endpoint)');

DO $$
DECLARE
  v_t1 UUID;
  v_t3 UUID;
  v_t1_codes TEXT[] := ARRAY[
    'cc_1','cc_2','cc_3',
    'ccap_1','ccap_2','ccap_3',
    'eu_1','eu_2','eu_3',
    'se_1','se_2','se_3','se_4',
    'eou_1_t1','eou_2_t1','eou_3_t1','eou_4_t1'
  ];
  v_t3_codes TEXT[] := ARRAY[
    'cc_1','cc_2','cc_3',
    'ccap_1','ccap_2','ccap_3'
  ];
BEGIN
  SELECT id INTO v_t1 FROM public.surveys WHERE title = 'Privacy Concern & Fatigue (Baseline)';
  SELECT id INTO v_t3 FROM public.surveys WHERE title = 'Privacy Fatigue & Ease of Use (Endpoint)';

  IF v_t1 IS NULL OR v_t3 IS NULL THEN
    RAISE NOTICE '047/051 surveys not found; skipping 2014-construct item load (seed 047 + 051 first).';
    RETURN;
  END IF;

  -- Idempotency guard (no unique constraint on survey_id/item_code exists).
  DELETE FROM public.survey_questions
   WHERE survey_id = v_t1 AND item_code = ANY (v_t1_codes);
  DELETE FROM public.survey_questions
   WHERE survey_id = v_t3 AND item_code = ANY (v_t3_codes);

  -- ── T1: control_complexity, control_capability, expected_utility, ──
  -- ── self_efficacy, and a T1 copy of ease_of_use                   ──
  INSERT INTO public.survey_questions
    (survey_id, item_code, question_text, question_type, scale_config, reverse_coded, subscale, sort_order)
  VALUES
    -- control_complexity (Thompson, Hamilton & Rust, 2005 — "feature" perceptions)
    (v_t1, 'cc_1',  'The privacy settings let me make many distinct choices about who sees what.', 'likert_7', '{"min":1,"max":7}', false, 'control_complexity', 17),
    (v_t1, 'cc_2',  'There are many different privacy options for me to adjust in this app.', 'likert_7', '{"min":1,"max":7}', false, 'control_complexity', 18),
    (v_t1, 'cc_3',  'The privacy settings in this app offer very few options to choose from.', 'likert_7', '{"min":1,"max":7}', true, 'control_complexity', 19),

    -- control_capability (Thompson, Hamilton & Rust, 2005 — "capability" perceptions)
    (v_t1, 'ccap_1', 'These privacy settings are capable of restricting my information exactly the way I want.', 'likert_7', '{"min":1,"max":7}', false, 'control_capability', 20),
    (v_t1, 'ccap_2', 'The privacy settings can do what I need them to do to protect my information.', 'likert_7', '{"min":1,"max":7}', false, 'control_capability', 21),
    (v_t1, 'ccap_3', 'These settings do not give me much control over who sees my information.', 'likert_7', '{"min":1,"max":7}', true, 'control_capability', 22),

    -- expected_utility (Keith, Evans, Lowry & Babb, 2014, ICIS)
    (v_t1, 'eu_1', 'I expect these privacy settings will let me reach exactly the level of sharing I want.', 'likert_7', '{"min":1,"max":7}', false, 'expected_utility', 23),
    (v_t1, 'eu_2', 'I believe I can achieve the privacy outcome I want by using these settings.', 'likert_7', '{"min":1,"max":7}', false, 'expected_utility', 24),
    (v_t1, 'eu_3', 'I doubt these privacy settings will actually get me the level of sharing I am looking for.', 'likert_7', '{"min":1,"max":7}', true, 'expected_utility', 25),

    -- self_efficacy (adapted from Keith, Babb, Furner & Abdullat, 2011, ICIS)
    (v_t1, 'se_1', 'I am confident I can figure out how to use the settings in a new mobile app without help.', 'likert_7', '{"min":1,"max":7}', false, 'self_efficacy', 26),
    (v_t1, 'se_2', 'I could complete a task in a new mobile app even if no one showed me how to do it first.', 'likert_7', '{"min":1,"max":7}', false, 'self_efficacy', 27),
    (v_t1, 'se_3', 'I am confident I can use a new mobile app''s features even if I have never used a similar app before.', 'likert_7', '{"min":1,"max":7}', false, 'self_efficacy', 28),
    (v_t1, 'se_4', 'I would need someone to walk me through a new mobile app''s settings before I could use them on my own.', 'likert_7', '{"min":1,"max":7}', true, 'self_efficacy', 29),

    -- ease_of_use, before-use copy of the T2/T3 Davis (1989)-adapted items
    (v_t1, 'eou_1_t1', 'Learning to use the privacy settings in Findamine was easy for me.', 'likert_7', '{"min":1,"max":7}', false, 'ease_of_use', 30),
    (v_t1, 'eou_2_t1', 'I find it easy to get the privacy settings to do what I want them to do.', 'likert_7', '{"min":1,"max":7}', false, 'ease_of_use', 31),
    (v_t1, 'eou_3_t1', 'My interaction with Findamine''s privacy settings is clear and understandable.', 'likert_7', '{"min":1,"max":7}', false, 'ease_of_use', 32),
    (v_t1, 'eou_4_t1', 'Overall, I find Findamine''s privacy settings easy to use.', 'likert_7', '{"min":1,"max":7}', false, 'ease_of_use', 33);

  -- ── T3: control_complexity, control_capability ──────────────────────
  INSERT INTO public.survey_questions
    (survey_id, item_code, question_text, question_type, scale_config, reverse_coded, subscale, sort_order)
  VALUES
    (v_t3, 'cc_1',  'The privacy settings let me make many distinct choices about who sees what.', 'likert_7', '{"min":1,"max":7}', false, 'control_complexity', 11),
    (v_t3, 'cc_2',  'There are many different privacy options for me to adjust in this app.', 'likert_7', '{"min":1,"max":7}', false, 'control_complexity', 12),
    (v_t3, 'cc_3',  'The privacy settings in this app offer very few options to choose from.', 'likert_7', '{"min":1,"max":7}', true, 'control_complexity', 13),

    (v_t3, 'ccap_1', 'These privacy settings are capable of restricting my information exactly the way I want.', 'likert_7', '{"min":1,"max":7}', false, 'control_capability', 14),
    (v_t3, 'ccap_2', 'The privacy settings can do what I need them to do to protect my information.', 'likert_7', '{"min":1,"max":7}', false, 'control_capability', 15),
    (v_t3, 'ccap_3', 'These settings do not give me much control over who sees my information.', 'likert_7', '{"min":1,"max":7}', true, 'control_capability', 16);
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Task 2 audit (report-only; 051_validated_survey_instruments.sql is NOT
-- edited by this migration — this comment records the findings requested
-- alongside the D-R3 item-wording review).
--
-- Reviewed all 36 items inserted by 051 (10 IUIPC privacy_concern @ T1,
-- 6 privacy_fatigue @ each of T1/T2/T3, 4 ease_of_use @ each of T2/T3).
-- All 36 currently have reverse_coded = false.
--
-- Finding: none of the 36 items are mis-flagged. Every item is worded so
-- that HIGHER agreement corresponds to MORE of its subscale's construct:
--   - privacy_concern (IUIPC-10, Malhotra et al. 2004): all 10 items
--     (control/awareness/collection) are worded as concern-affirming
--     statements ("bothers me", "I am concerned", "my right to exercise
--     control", etc.) — consistent with the original IUIPC-10 instrument,
--     which itself has no reverse-keyed items in its final 10-item form.
--   - privacy_fatigue (adapted from Choi, Park & Jung, 2018): all 6 items
--     (3 emotional-exhaustion + 3 cynicism) are worded as fatigue-affirming
--     statements ("I feel drained", "I am tired", "feels pointless", etc.).
--     Note fatigue_cyn_1 ("I have become less interested in online privacy
--     issues") reads awkwardly on first pass but is NOT reverse-keyed: lower
--     interest is itself the cynicism symptom the subscale measures, so
--     higher agreement correctly means higher fatigue.
--   - ease_of_use (adapted from Davis, 1989): all 4 items are worded as
--     ease-affirming statements ("was easy for me", "I find it easy",
--     "clear and understandable", "easy to use").
-- No changes to reverse_coded values in 051 are warranted. (By contrast,
-- three of the new subscales added above by this migration —
-- control_complexity, control_capability, expected_utility, self_efficacy —
-- DO each include one intentionally reverse-worded item, flagged
-- reverse_coded = true, per the task's request for at least one
-- reverse-worded item per multi-item subscale where natural.)
-- ─────────────────────────────────────────────────────────────────────────
