-- 056_advisor_fixes.sql
-- Build plan H4: act on the Supabase security + performance advisors run on
-- 2026-09-10 against bmsmvozzdorgtzflgnrk. Nothing here changes behavior.
--
--   1. Drop `pis_own_insert` on privacy_index_snapshots. Every snapshot is
--      written server-side with the service role (enrollment t0, on change,
--      daily cron). A client-side INSERT policy only lets a participant forge
--      their own trajectory points (D2 note, docs/D_PRODUCTION_READINESS_FINDINGS.md).
--   2. Covering indexes for the un-indexed foreign keys on research tables
--      (lint 0001_unindexed_foreign_keys). Export and dashboard joins hit these.
--   3. Pin search_path on the 16 functions flagged by 0011_function_search_path_mutable.
--      PostGIS lives in `extensions` (migrations 040/041), so the spatial
--      functions get `public, extensions`.
--
-- Deliberately NOT done here:
--   - user_id() / user_role() are SECURITY DEFINER and executable by anon and
--     authenticated (lints 0028/0029). They are called from RLS policies, which
--     run as the querying role, so revoking EXECUTE would break every policy
--     that uses them. Leave as is; they only read auth.uid() / users.role.
--   - pg_trgm is in public (0014). Moving it requires re-creating dependent
--     indexes; not worth the risk before the pilot.
--   - multiple_permissive_policies / auth_rls_initplan: RLS is defense in
--     depth here (the app uses the service role with authz in code). Tune
--     after the pilot if the dashboards get slow.

-- 1. Snapshot inserts are server-only.
DROP POLICY IF EXISTS pis_own_insert ON public.privacy_index_snapshots;

-- 1b. Class join is server-only. Migration 049 added a policy letting any
--     authenticated user INSERT a roster_entries row for themselves; the join
--     route (src/app/api/v1/roster/join/route.ts) validates the join code and
--     writes with the service role, so the policy was never needed and would
--     let a user with the anon key join ANY class, which grants the "class"
--     viewer relationship over every member's class-restricted fields.
DROP POLICY IF EXISTS "roster_entries_self_join" ON public.roster_entries;

-- 2. Foreign-key covering indexes.
CREATE INDEX IF NOT EXISTS idx_dimension_assignments_dimension
  ON public.dimension_assignments(dimension_id);
CREATE INDEX IF NOT EXISTS idx_dimension_assignments_assigned_by
  ON public.dimension_assignments(assigned_by);
CREATE INDEX IF NOT EXISTS idx_study_enrollments_user
  ON public.study_enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_treatment_study_dimensions_dimension
  ON public.treatment_study_dimensions(dimension_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_delivery
  ON public.survey_responses(delivery_id);
CREATE INDEX IF NOT EXISTS idx_survey_schedules_survey
  ON public.survey_schedules(survey_id);
CREATE INDEX IF NOT EXISTS idx_surveys_created_by
  ON public.surveys(created_by);
CREATE INDEX IF NOT EXISTS idx_consent_records_child
  ON public.consent_records(child_id);
CREATE INDEX IF NOT EXISTS idx_points_ledger_hunt
  ON public.points_ledger(hunt_id);
CREATE INDEX IF NOT EXISTS idx_play_sessions_team
  ON public.play_sessions(team_id);

-- 3. Immutable search_path on flagged functions.
ALTER FUNCTION public.set_updated_at()                                   SET search_path = public;
ALTER FUNCTION public.assign_random_codename(uuid)                       SET search_path = public;
ALTER FUNCTION public.increment_hint_usage(uuid)                         SET search_path = public;
ALTER FUNCTION public.increment_sample_size(uuid)                        SET search_path = public;
ALTER FUNCTION public.overall_leaderboard(integer)                       SET search_path = public;
ALTER FUNCTION public.get_user_improvements(integer)                     SET search_path = public;
ALTER FUNCTION public.get_speed_run_leaderboard(integer)                 SET search_path = public;
ALTER FUNCTION public.get_hunt_insights(integer)                         SET search_path = public;
ALTER FUNCTION public.get_roster_avg_scores(uuid)                        SET search_path = public;
ALTER FUNCTION public.get_challenge_type_effectiveness()                 SET search_path = public;
ALTER FUNCTION public.get_hunt_analytics(uuid)                           SET search_path = public;
ALTER FUNCTION public.get_stop_analytics(uuid)                           SET search_path = public;
ALTER FUNCTION public.get_user_stats(uuid)                               SET search_path = public;
ALTER FUNCTION public.get_audience_insights()                            SET search_path = public;
ALTER FUNCTION public.nearby_locations(double precision, double precision, double precision, integer)
  SET search_path = public, extensions;
ALTER FUNCTION public.search_hunts(double precision, double precision, double precision, text, text, integer)
  SET search_path = public, extensions;
