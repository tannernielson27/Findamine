-- 046_referral_minion_economy.sql
-- The referral / "minion" incentive economy (Workstream A / Task A6).
--
-- A user recruits others via a referral code; a recruit becomes the recruiter's
-- minion (asymmetric, one recruiter per user). The recruiter earns a fraction of
-- points whenever a minion scores. This creates the escalating privacy<->reward
-- tension the study measures. (RESEARCH_READINESS_PLAN.md, prospectus §3.2.)

-- ── Referral codes (one per user) ───────────────────────────────
CREATE TABLE public.referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.users(id),
  code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_referral_codes_code ON public.referral_codes(code);

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "referral_codes_own" ON public.referral_codes
  FOR SELECT USING (user_id = public.user_id() OR public.user_role() IN ('admin', 'researcher'));

-- ── Minion links (recruiter → minion, one recruiter per minion) ─
CREATE TABLE public.minion_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id UUID NOT NULL REFERENCES public.users(id),
  minion_id UUID NOT NULL UNIQUE REFERENCES public.users(id),
  referral_code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT no_self_minion CHECK (recruiter_id <> minion_id)
);

CREATE INDEX idx_minion_links_recruiter ON public.minion_links(recruiter_id);

ALTER TABLE public.minion_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "minion_links_involved" ON public.minion_links
  FOR SELECT USING (
    recruiter_id = public.user_id()
    OR minion_id = public.user_id()
    OR public.user_role() IN ('admin', 'researcher')
  );

-- ── Allow 'referral' as a points_ledger source ──────────────────
-- The inline CHECK from 006 omits 'referral'; replace it to include it.
ALTER TABLE public.points_ledger DROP CONSTRAINT IF EXISTS points_ledger_source_type_check;
ALTER TABLE public.points_ledger ADD CONSTRAINT points_ledger_source_type_check
  CHECK (source_type IN (
    'challenge', 'hunt_complete', 'badge', 'streak', 'kudos',
    'mentor', 'bonus', 'seasonal', 'adjustment', 'referral'
  ));
