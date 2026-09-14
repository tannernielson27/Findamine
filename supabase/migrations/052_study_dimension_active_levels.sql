-- 052_study_dimension_active_levels.sql
-- Per-study level subsets (B3).
--
-- A treatment dimension declares its full universe of levels in
-- treatment_dimensions.levels. A study may cross only a SUBSET of those levels
-- (e.g. run privacy_default with just private/public and drop neutral) without
-- editing the shared dimension row, so other studies — and historical
-- dimension_assignments — keep their meaning.
--
-- Semantics of treatment_study_dimensions.active_levels:
--   NULL or '{}'  → use every level in treatment_dimensions.levels (default,
--                   and the behaviour of every existing row).
--   non-empty     → randomize over exactly these levels for this study. Every
--                   element MUST be a member of treatment_dimensions.levels;
--                   the application (randomization.ts → resolveLevels) validates
--                   this and refuses to assign when it is violated. No DB CHECK
--                   is used because the constraint spans two tables.
--
-- The balance report (checkBalance) likewise only counts active cells.

ALTER TABLE public.treatment_study_dimensions
  ADD COLUMN IF NOT EXISTS active_levels TEXT[] NULL;

COMMENT ON COLUMN public.treatment_study_dimensions.active_levels IS
  'Subset of treatment_dimensions.levels this study randomizes over. NULL/empty = all levels.';
