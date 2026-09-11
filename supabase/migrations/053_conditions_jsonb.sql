-- 053_conditions_jsonb.sql
-- Generic condition context on privacy behavioral rows (B5).
--
-- Migration 048 denormalized two hard-coded condition columns (`treatment` =
-- privacy_control_complexity level, `privacy_default`) onto privacy_events and
-- privacy_index_snapshots. Adding a third factor (050, privacy_friction) meant
-- joining dimension_assignments at export time; every future dimension would
-- need the same special-casing.
--
-- `conditions` is a JSONB map of { <dimension name>: <assigned level> } stamped
-- at write time from the participant's users.metadata (see
-- src/lib/utils/conditions.ts → conditionsFromMetadata). New dimensions need no
-- schema or code change: enrollment writes them, exports read them.
--
-- The two legacy columns are KEPT (still written by the app) so existing
-- queries and dashboards continue to work.

-- ── privacy_events ──────────────────────────────────────────────
ALTER TABLE public.privacy_events
  ADD COLUMN IF NOT EXISTS conditions JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_privacy_events_conditions
  ON public.privacy_events USING GIN (conditions);

-- ── privacy_index_snapshots ─────────────────────────────────────
ALTER TABLE public.privacy_index_snapshots
  ADD COLUMN IF NOT EXISTS conditions JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_privacy_snapshots_conditions
  ON public.privacy_index_snapshots USING GIN (conditions);

-- ── Backfill 1: from the legacy denormalized columns ────────────
-- jsonb_strip_nulls drops whichever of the two is NULL so a row never carries
-- an explicit null level.
UPDATE public.privacy_events
   SET conditions = conditions || jsonb_strip_nulls(jsonb_build_object(
         'privacy_control_complexity', treatment,
         'privacy_default',            privacy_default))
 WHERE (treatment IS NOT NULL OR privacy_default IS NOT NULL)
   AND conditions = '{}'::jsonb;

UPDATE public.privacy_index_snapshots
   SET conditions = conditions || jsonb_strip_nulls(jsonb_build_object(
         'privacy_control_complexity', treatment,
         'privacy_default',            privacy_default))
 WHERE (treatment IS NOT NULL OR privacy_default IS NOT NULL)
   AND conditions = '{}'::jsonb;

-- ── Backfill 2: any dimension not covered by the legacy columns ──
-- Factors that were never denormalized (privacy_friction, and anything added
-- later) are filled from the participant's dimension_assignments. Assignment
-- is fixed at enrollment, so it is valid for every row of that participant.
-- Keys already present on the row (from backfill 1, i.e. recorded at the time)
-- take precedence over the current assignment.
WITH assigned AS (
  SELECT da.user_id,
         jsonb_object_agg(td.name, da.level) AS conditions
    FROM public.dimension_assignments da
    JOIN public.treatment_dimensions td ON td.id = da.dimension_id
   GROUP BY da.user_id
)
UPDATE public.privacy_events pe
   SET conditions = a.conditions || pe.conditions
  FROM assigned a
 WHERE a.user_id = pe.user_id
   AND NOT (pe.conditions @> a.conditions);

WITH assigned AS (
  SELECT da.user_id,
         jsonb_object_agg(td.name, da.level) AS conditions
    FROM public.dimension_assignments da
    JOIN public.treatment_dimensions td ON td.id = da.dimension_id
   GROUP BY da.user_id
)
UPDATE public.privacy_index_snapshots ps
   SET conditions = a.conditions || ps.conditions
  FROM assigned a
 WHERE a.user_id = ps.user_id
   AND NOT (ps.conditions @> a.conditions);
