-- 062_norm_line.sql
-- Storyline S5 "Peer pressure on the privacy page" (build plan D3).
--
-- One randomizable switch, SEEDED but NOT LINKED, so nobody sees a norm line
-- until a study links it (Privacy_Fatigue_Replication_Study_Design.md, S5):
--
--   INSERT INTO public.treatment_study_dimensions (study_id, dimension_id, sort_order)
--   SELECT s.id, d.id, 2 FROM public.treatment_studies s, public.treatment_dimensions d
--    WHERE s.study_code = '<study>' AND d.name = 'norm_line'
--   ON CONFLICT DO NOTHING;
--
--   norm_line  none        → no line (today's behavior).
--              descriptive → one line at the top of the privacy page, computed
--                            nightly from the participant's class:
--                            "62% of players in your class hide their score from Everyone."
--
-- The nightly job (/api/cron/class-norms) writes class_norm_stats; classes with
-- fewer than 5 players get no row, so no line is shown for them (small classes
-- would make the share unstable and near-identifying). Each rendered line is a
-- norm_exposures row; the next save carries its id in
-- privacy_events.norm_exposure_id, validated server-side as the saver's own.
--
-- The old /api/v1/research/norms route read a `social_norm_exposure` dimension
-- that was never seeded and served child-oriented copy; it now reads norm_line.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.treatment_dimensions WHERE name = 'norm_line') THEN
    INSERT INTO public.treatment_dimensions (name, description, levels, is_active)
    VALUES ('norm_line',
            'Whether the privacy page shows a descriptive norm: the share of the participant''s class hiding their score from Everyone.',
            ARRAY['none','descriptive'], true);
  END IF;
END $$;

-- ── Nightly per-class share ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.class_norm_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id UUID NOT NULL REFERENCES public.rosters(id) ON DELETE CASCADE,
  computed_on DATE NOT NULL,
  field TEXT NOT NULL DEFAULT 'total_score',
  n_players INT NOT NULL CHECK (n_players >= 0),
  n_hidden INT NOT NULL CHECK (n_hidden >= 0 AND n_hidden <= n_players),
  share_hidden NUMERIC(5,4) NOT NULL CHECK (share_hidden >= 0 AND share_hidden <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (roster_id, computed_on, field)
);

ALTER TABLE public.class_norm_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "class_norm_stats_research_read" ON public.class_norm_stats;
CREATE POLICY "class_norm_stats_research_read" ON public.class_norm_stats
  FOR SELECT USING (public.user_role() IN ('admin', 'researcher'));

-- ── Exposure provenance ──────────────────────────────────
ALTER TABLE public.norm_exposures
  ADD COLUMN IF NOT EXISTS roster_id UUID REFERENCES public.rosters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS norm_stat_id UUID REFERENCES public.class_norm_stats(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS share_shown NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS conditions JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_norm_exposures_roster ON public.norm_exposures (roster_id);
CREATE INDEX IF NOT EXISTS idx_norm_exposures_stat ON public.norm_exposures (norm_stat_id);

-- Exposures are served and written by the service role only (same reasoning as
-- 056 dropping the client insert policy on privacy_index_snapshots).
DROP POLICY IF EXISTS "norm_insert_own" ON public.norm_exposures;

-- privacy_events.norm_exposure_id has existed since 006 without a constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'privacy_events_norm_exposure_id_fkey'
  ) THEN
    ALTER TABLE public.privacy_events
      ADD CONSTRAINT privacy_events_norm_exposure_id_fkey
      FOREIGN KEY (norm_exposure_id) REFERENCES public.norm_exposures(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_privacy_events_norm_exposure
  ON public.privacy_events (norm_exposure_id) WHERE norm_exposure_id IS NOT NULL;
