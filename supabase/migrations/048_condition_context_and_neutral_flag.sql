-- 048_condition_context_and_neutral_flag.sql
-- Research-validity hardening (Workstream A follow-ups #6 and #8).
--
-- #6 — Denormalize each participant's assigned condition onto privacy behavioral
--      rows, so analysis by cell never depends on client-supplied metadata or a
--      join to the current (possibly changed) users.metadata.
-- #8 — Distinguish a NEUTRAL default (no fields set yet) from a PUBLIC default
--      (all fields "everyone"). Both compute to privacy index 0, so without a flag
--      they are indistinguishable in the index at t0. `unset` marks the "no choice
--      made yet" state on a snapshot.

-- ── privacy_events: condition context ───────────────────────────
ALTER TABLE public.privacy_events
  ADD COLUMN IF NOT EXISTS treatment       TEXT,   -- privacy_control_complexity level
  ADD COLUMN IF NOT EXISTS privacy_default TEXT;   -- private | neutral | public

-- ── privacy_index_snapshots: condition context + neutral flag ───
ALTER TABLE public.privacy_index_snapshots
  ADD COLUMN IF NOT EXISTS treatment       TEXT,
  ADD COLUMN IF NOT EXISTS privacy_default TEXT,
  ADD COLUMN IF NOT EXISTS unset           BOOLEAN NOT NULL DEFAULT false;

-- Query trajectories by cell efficiently.
CREATE INDEX IF NOT EXISTS idx_privacy_snapshots_condition
  ON public.privacy_index_snapshots(privacy_default, treatment);
CREATE INDEX IF NOT EXISTS idx_privacy_events_condition
  ON public.privacy_events(privacy_default, treatment);
