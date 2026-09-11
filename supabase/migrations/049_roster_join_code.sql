-- 049_roster_join_code.sql
-- Class-level enrollment (Workstream A follow-up #13).
--
-- Adds a shareable join code to each roster so a whole class can self-enroll
-- instead of the teacher adding students one id at a time. Joining a roster
-- establishes the "class" viewer relationship (see src/lib/utils/viewer.ts) and
-- lets a teacher track participation. Study enrollment/randomization still
-- happens per-user at first authenticated load (gated on research consent).

ALTER TABLE public.rosters
  ADD COLUMN IF NOT EXISTS join_code TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_rosters_join_code ON public.rosters(join_code);

-- Students self-join via code, so they need to INSERT their own roster_entry.
-- The existing roster_entries RLS only allowed the owning teacher/admin; add a
-- policy letting a user insert a row for THEMSELVES (student_id = self).
DROP POLICY IF EXISTS "roster_entries_self_join" ON public.roster_entries;
CREATE POLICY "roster_entries_self_join" ON public.roster_entries
  FOR INSERT WITH CHECK (student_id = public.user_id());
