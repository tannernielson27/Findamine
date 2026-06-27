-- 045_privacy_index_snapshots.sql
-- Persists a restrictiveness score (0 public .. 1 private) per participant over time,
-- so the privacy-index trajectory exists even for users who stop changing settings.
--
-- Workstream A / Task A4 (see docs/WORKSTREAM_A_IMPLEMENTATION_PLAN.md).
-- Snapshots are written at enrollment (t0), on each change, and daily by cron.

CREATE TABLE public.privacy_index_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id),
  index_value NUMERIC(5, 4) NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('change', 'scheduled', 'enrollment')),
  visibility JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_privacy_snapshots_user ON public.privacy_index_snapshots(user_id, created_at);
CREATE INDEX idx_privacy_snapshots_source ON public.privacy_index_snapshots(source);

ALTER TABLE public.privacy_index_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pis_own_insert" ON public.privacy_index_snapshots
  FOR INSERT WITH CHECK (user_id = public.user_id());

CREATE POLICY "pis_admin" ON public.privacy_index_snapshots
  FOR SELECT USING (public.user_role() IN ('admin', 'researcher'));
