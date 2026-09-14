-- 065_adult_participant_role.sql
-- Adds an 'adult' player role. The study population is adult undergraduates,
-- but users.role only allowed COPPA-era values, so self-registered adults
-- enrolled as 'teen' (or were silently mapped to 'parent' at 18+). 'adult' is
-- a player role with no staff, parental, or creator permissions: every
-- app-side permission check lists the roles it grants, and none grants 'adult'
-- anything beyond an ordinary player.
--
-- Also adds 'adult' to the target_roles of any survey that targets teens, so
-- the study instruments (047/051) reach adult participants.
--
-- Idempotent.

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('child', 'teen', 'adult', 'parent', 'teacher', 'hunt_creator', 'admin', 'researcher'));

UPDATE public.surveys
   SET target_roles = array_append(target_roles, 'adult')
 WHERE 'teen' = ANY (target_roles)
   AND NOT ('adult' = ANY (target_roles));
