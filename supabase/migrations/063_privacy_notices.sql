-- 063_privacy_notices.sql
-- Storyline S6 "Privacy at the moment it matters" (build plan C3).
--
-- When a participant completes a find, the answer route can show a just-in-time
-- notice about who can see the score they just earned. One randomizable
-- dimension picks the variant; it is SEEDED but NOT LINKED to any study, so
-- nobody is assigned and the app shows nothing (today's behavior). Linking is
-- decision-gated (see FindamineResearch/Privacy_Fatigue_Replication_Study_Design.md,
-- S6) and is one INSERT, as in migration 050:
--
--   INSERT INTO public.treatment_study_dimensions (study_id, dimension_id, sort_order)
--   SELECT s.id, d.id, 2 FROM public.treatment_studies s, public.treatment_dimensions d
--    WHERE s.study_code = '<study>' AND d.name = 'notice_style'
--   ON CONFLICT DO NOTHING;
--
-- The assigned level reaches the app as users.metadata.dim_notice_style
-- (enrollment.ts writes dim_<name> keys); src/lib/services/privacy-notice.ts
-- reads it.
--
--   none        → no notice, nothing recorded.
--   generic     → "Your privacy settings apply to this score."
--   specific    → names the audience: "Your class can see this score."
--   contextual  → the specific sentence plus a "Change who sees it" link.
--
-- Every delivered notice is one notice_events row. The client reports display,
-- dismissal (manual or auto) and link clicks with a dwell measure through
-- POST /api/v1/research/notice-events/[id]; the service role does all writes.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.treatment_dimensions WHERE name = 'notice_style') THEN
    INSERT INTO public.treatment_dimensions (name, description, levels, is_active)
    VALUES ('notice_style',
            'Just-in-time privacy notice shown after a participant scores: none, generic, specific (names the audience), or contextual (audience plus a link to change it).',
            ARRAY['none','generic','specific','contextual'], true);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.notice_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  notice_style TEXT NOT NULL CHECK (notice_style IN ('generic','specific','contextual')),
  field TEXT NOT NULL DEFAULT 'total_score',
  -- The field's effective audience at delivery (unset is recorded as 'everyone').
  audience_level TEXT,
  message TEXT NOT NULL,
  -- nth notice for this user, 1-based: the habituation-curve x axis.
  exposure_number INT NOT NULL CHECK (exposure_number >= 1),
  find_id UUID REFERENCES public.finds(id) ON DELETE SET NULL,
  hunt_id UUID REFERENCES public.hunts(id) ON DELETE SET NULL,
  conditions JSONB NOT NULL DEFAULT '{}',
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  displayed_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  dismissed_auto BOOLEAN,
  link_clicked_at TIMESTAMPTZ,
  dwell_ms INT CHECK (dwell_ms IS NULL OR dwell_ms BETWEEN 0 AND 600000)
);

CREATE INDEX IF NOT EXISTS idx_notice_events_user_delivered
  ON public.notice_events(user_id, delivered_at);

-- exposure_number is the habituation curve's x-axis: one clean sequence per
-- participant. The service computes it as count + 1, which races when two
-- finds complete at once; this constraint rejects the duplicate and the
-- service recounts and retries.
CREATE UNIQUE INDEX IF NOT EXISTS notice_events_user_exposure_key
  ON public.notice_events(user_id, exposure_number);
CREATE INDEX IF NOT EXISTS idx_notice_events_find ON public.notice_events(find_id);
CREATE INDEX IF NOT EXISTS idx_notice_events_hunt ON public.notice_events(hunt_id);

ALTER TABLE public.notice_events ENABLE ROW LEVEL SECURITY;

-- Researchers read; no client insert/update policy — the service role writes.
DROP POLICY IF EXISTS "notice_events_researcher_read" ON public.notice_events;
CREATE POLICY "notice_events_researcher_read" ON public.notice_events
  FOR SELECT USING (public.user_role() IN ('admin', 'researcher'));
