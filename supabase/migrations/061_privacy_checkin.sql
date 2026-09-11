-- 061_privacy_checkin.sql
-- Storyline S4 "Does asking wear people out?" (build plan D2).
--
-- A "review your privacy settings" check-in is sent never, every two weeks, or
-- weekly. The dimension is SEEDED but NOT LINKED to any study, so nobody is
-- assigned and nobody receives check-ins until it is linked. Linking is
-- decision-gated (see FindamineResearch/Privacy_Fatigue_Replication_Study_Design.md,
-- S4) and is one INSERT, as in migration 050:
--
--   INSERT INTO public.treatment_study_dimensions (study_id, dimension_id, sort_order)
--   SELECT s.id, d.id, 2 FROM public.treatment_studies s, public.treatment_dimensions d
--    WHERE s.study_code = '<study>' AND d.name = 'privacy_checkin'
--   ON CONFLICT DO NOTHING;
--
-- The assigned level reaches the app as users.metadata.dim_privacy_checkin
-- (enrollment.ts writes dim_<name> keys); src/lib/services/privacy-checkin.ts
-- reads it. Delivery is a SEPARATE, condition-aware cron
-- (/api/cron/privacy-checkins) so the re-engagement cron keeps its
-- condition-blind integrity guardrail.
--
--   none      → no check-ins
--   biweekly  → first at enrollment + 14 days, then every 14 days
--   weekly    → first at enrollment + 7 days, then every 7 days
--
-- Copy is identical across arms; only the dose varies.
--
-- privacy_checkin_events is the research log: one `delivered` row per check-in
-- (with exposure_number, the nth delivered to that participant), at most one
-- `opened` and one `dismissed` per notification (latency_ms from delivery), and
-- one `skipped` row per due slot a participant had opted out of. Written only
-- by the service role (cron + /api/v1/research/checkin-events).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.treatment_dimensions WHERE name = 'privacy_checkin') THEN
    INSERT INTO public.treatment_dimensions (name, description, levels, is_active)
    VALUES ('privacy_checkin',
            'Cadence of a "review your privacy settings" check-in notification: never, every two weeks, or weekly.',
            ARRAY['none','biweekly','weekly'], true);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.privacy_checkin_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  notification_id UUID REFERENCES public.notifications(id) ON DELETE SET NULL,
  cadence TEXT NOT NULL CHECK (cadence IN ('none', 'biweekly', 'weekly')),
  exposure_number INT,
  action TEXT NOT NULL CHECK (action IN ('delivered', 'opened', 'dismissed', 'skipped')),
  reason TEXT,
  latency_ms BIGINT,
  conditions JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_privacy_checkin_events_user
  ON public.privacy_checkin_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_privacy_checkin_events_notification
  ON public.privacy_checkin_events(notification_id);

-- First open and first dismiss per check-in only; repeats are no-ops.
CREATE UNIQUE INDEX IF NOT EXISTS uq_privacy_checkin_events_response
  ON public.privacy_checkin_events(notification_id, action)
  WHERE action IN ('opened', 'dismissed');

ALTER TABLE public.privacy_checkin_events ENABLE ROW LEVEL SECURITY;

-- Researchers read; nobody writes from the client (service role bypasses RLS).
DROP POLICY IF EXISTS "pce_admin_select" ON public.privacy_checkin_events;
CREATE POLICY "pce_admin_select" ON public.privacy_checkin_events
  FOR SELECT USING (public.user_role() IN ('admin', 'researcher'));
