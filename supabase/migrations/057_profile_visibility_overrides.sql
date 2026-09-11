-- 057_profile_visibility_overrides.sql
-- Per-person privacy overrides (build plan C1; the 2014 "High" condition).
--
-- Keith, Evans, Lowry & Babb (2014) gave their High-complexity group the
-- Medium controls PLUS the ability to set rules for specific people in their
-- social network (20 + 3 per frenemy options). The 2026 `complex` scheme was
-- per-field only. This adds the per-person layer:
--
--   users.profile_visibility_overrides
--     { "<viewerUserId>": { "<fieldKey>": "<level>" } }
--     An explicit override wins over the audience rule for that viewer in BOTH
--     directions (grant a hidden field to one friend, or hide a visible field
--     from one friend). Only accepted friends and the user's own minions may be
--     keyed (validated server-side in the profile PUT). Empty map = no overrides.
--     Resolution: src/lib/utils/privacy.ts → resolveFieldLevel / canViewField.
--
--   privacy_index_snapshots.override_count
--     Number of (viewer, field) override pairs in force at snapshot time. The
--     privacy index itself is unchanged so it stays comparable across schemes;
--     override usage is analyzed as its own outcome.
--
-- Decision D-R2 (mentor): whether the replication's High tier uses this layer.
-- The UI section only renders under the `complex` scheme, so nothing changes
-- for other participants.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS profile_visibility_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.users.profile_visibility_overrides IS
  'Per-viewer field visibility overrides: { viewerUserId: { fieldKey: level } }. Wins over profile_visibility for that viewer.';

ALTER TABLE public.privacy_index_snapshots
  ADD COLUMN IF NOT EXISTS override_count INT NOT NULL DEFAULT 0;
