-- 059_referral_salience_dimensions.sql
-- Storyline S3 "Putting a price on privacy" (build plan D1).
--
-- Two randomizable switches for the referral economy. Both are SEEDED but NOT
-- LINKED to any study, so nobody is assigned and the app falls back to today's
-- behavior (gated + shown). Linking is decision-gated (see
-- FindamineResearch/Privacy_Fatigue_Replication_Study_Design.md, S3) and is one
-- INSERT per dimension into treatment_study_dimensions, as in migration 050:
--
--   INSERT INTO public.treatment_study_dimensions (study_id, dimension_id, sort_order)
--   SELECT s.id, d.id, 2 FROM public.treatment_studies s, public.treatment_dimensions d
--    WHERE s.study_code = '<study>' AND d.name = 'referral_gate'
--   ON CONFLICT DO NOTHING;
--
-- Assigned levels reach the app as users.metadata.dim_referral_gate and
-- users.metadata.dim_forfeit_notice (enrollment.ts writes dim_<name> keys);
-- src/lib/services/referral.ts → resolveReferralSwitches() reads them.
--
--   referral_gate   gated   → bonus paid only while the recruiter's display_name
--                             and total_score are visible at class or wider
--                             (today's behavior). Forfeits are logged.
--                   ungated → bonus always paid; the event payload records
--                             whether the gate WOULD have forfeited it.
--   forfeit_notice  shown   → the social page tells the recruiter what hiding
--                             has cost them (today's behavior).
--                   silent  → nothing is shown; forfeits are still logged.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.treatment_dimensions WHERE name = 'referral_gate') THEN
    INSERT INTO public.treatment_dimensions (name, description, levels, is_active)
    VALUES ('referral_gate',
            'Whether the recruiter''s referral bonus requires their name and score to be visible at class or wider (gated) or is always paid (ungated).',
            ARRAY['gated','ungated'], true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.treatment_dimensions WHERE name = 'forfeit_notice') THEN
    INSERT INTO public.treatment_dimensions (name, description, levels, is_active)
    VALUES ('forfeit_notice',
            'Whether a recruiter is told when a referral bonus was forfeited because their profile is hidden.',
            ARRAY['shown','silent'], true);
  END IF;
END $$;
