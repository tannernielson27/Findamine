-- 060_scheme_selection.sql
-- Storyline S2 "Would you choose the controls that fatigue you?" (build plan C2).
--
-- One randomizable switch, SEEDED but NOT LINKED to any study, so nobody is
-- assigned and the privacy page behaves exactly as today. Linking is
-- decision-gated (Privacy_Fatigue_Replication_Study_Design.md, S2):
--
--   INSERT INTO public.treatment_study_dimensions (study_id, dimension_id, sort_order)
--   SELECT s.id, d.id, 2 FROM public.treatment_studies s, public.treatment_dimensions d
--    WHERE s.study_code = '<study>' AND d.name = 'scheme_selection'
--   ON CONFLICT DO NOTHING;
--
-- Do NOT also link privacy_control_complexity to the same study: a randomized
-- complexity level always wins, so the `chosen` arm would have nothing to
-- choose (the app records the choice as assigned in that case).
--
-- Crossing with privacy_friction IS supported: the privacy page shows the
-- high-friction gate first and the preview only after it is cleared, so the
-- friction manipulation still applies to the preview arm.
--
--   scheme_selection  assigned → at the first privacy-page view the participant
--                                previews all three schemes read-only and rates
--                                the expected utility of each; they keep the
--                                scheme they were given.
--                     chosen   → same preview and ratings, then they pick the
--                                scheme they will use. The pick is written to
--                                users.metadata.privacy_treatment server-side.
--
-- Both arms get a one-time "change how your privacy controls work" link.
-- Every preview submission and switch is one row in scheme_selections.
-- Server code: src/lib/utils/scheme-selection.ts, /api/v1/research/scheme-choice.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.treatment_dimensions WHERE name = 'scheme_selection') THEN
    INSERT INTO public.treatment_dimensions (name, description, levels, is_active)
    VALUES ('scheme_selection',
            'Whether the participant is assigned a privacy control scheme or chooses one after previewing all three.',
            ARRAY['assigned','chosen'], true);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.scheme_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('preview', 'switch')),
  selection_arm TEXT NOT NULL CHECK (selection_arm IN ('assigned', 'chosen')),
  scheme_before TEXT NOT NULL CHECK (scheme_before IN ('simple', 'moderate', 'complex')),
  scheme_after TEXT NOT NULL CHECK (scheme_after IN ('simple', 'moderate', 'complex')),
  -- Expected utility per scheme on a 1-7 scale ({simple, moderate, complex}); preview only.
  ratings JSONB,
  -- Order the three preview cards were shown in (position effects); preview only.
  display_order TEXT[],
  dwell_ms INT CHECK (dwell_ms >= 0),
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.scheme_selections IS
  'Storyline S2: one preview row and at most one switch row per participant.';

-- One preview and one honored switch per participant; also the idempotency key
-- the scheme-choice route relies on for double submits.
CREATE UNIQUE INDEX IF NOT EXISTS scheme_selections_user_source_key
  ON public.scheme_selections (user_id, source);

ALTER TABLE public.scheme_selections ENABLE ROW LEVEL SECURITY;

-- Written only by the service role (the scheme-choice route). No client policy.
DROP POLICY IF EXISTS "scheme_selections_research_read" ON public.scheme_selections;
CREATE POLICY "scheme_selections_research_read" ON public.scheme_selections
  FOR SELECT USING (public.user_role() IN ('admin', 'researcher'));
