-- 044_research_study_seed.sql
-- Seeds the privacy pilot study + treatment dimensions, and adds an `auto_enroll`
-- flag so the enrollment service (src/lib/services/enrollment.ts) can find "the
-- study to auto-enroll new participants into" without hardcoding a UUID.
--
-- Workstream A / Task A2 (see docs/WORKSTREAM_A_IMPLEMENTATION_PLAN.md).
-- Decision (RESEARCH_READINESS_PLAN.md §1): primary treatment is privacy control
-- complexity (simple/moderate/complex). The `privacy_default` dimension
-- (private/neutral/public) is seeded too and kept configurable; whether it remains
-- a crossed confirmatory factor is the open A1 mentor decision.

ALTER TABLE public.treatment_studies
  ADD COLUMN IF NOT EXISTS auto_enroll BOOLEAN NOT NULL DEFAULT false;

DO $$
DECLARE
  v_study_id      UUID;
  v_complexity_id UUID;
  v_default_id    UUID;
BEGIN
  -- ── Study (idempotent on study_code) ────────────────────────────
  INSERT INTO public.treatment_studies
    (study_code, name, description, status, target_sample_size, auto_enroll)
  VALUES
    ('privacy_pilot_2026',
     'Privacy Choice-Architecture Pilot 2026',
     'Honors thesis pilot: privacy control complexity x default starting position, under a referral incentive.',
     'active', 240, true)
  ON CONFLICT (study_code)
    DO UPDATE SET auto_enroll = EXCLUDED.auto_enroll,
                  status      = EXCLUDED.status
  RETURNING id INTO v_study_id;

  -- ── Dimension: privacy control complexity (primary IV) ──────────
  SELECT id INTO v_complexity_id
    FROM public.treatment_dimensions
   WHERE name = 'privacy_control_complexity';
  IF v_complexity_id IS NULL THEN
    INSERT INTO public.treatment_dimensions (name, description, levels, is_active)
    VALUES ('privacy_control_complexity',
            'Complexity/granularity of the privacy control surface (primary IV).',
            ARRAY['simple','moderate','complex'], true)
    RETURNING id INTO v_complexity_id;
  END IF;

  -- ── Dimension: privacy default starting position ────────────────
  SELECT id INTO v_default_id
    FROM public.treatment_dimensions
   WHERE name = 'privacy_default';
  IF v_default_id IS NULL THEN
    INSERT INTO public.treatment_dimensions (name, description, levels, is_active)
    VALUES ('privacy_default',
            'Starting position of privacy settings (private/neutral/public).',
            ARRAY['private','neutral','public'], true)
    RETURNING id INTO v_default_id;
  END IF;

  -- ── Link dimensions to the study ────────────────────────────────
  INSERT INTO public.treatment_study_dimensions (study_id, dimension_id, sort_order)
  VALUES (v_study_id, v_complexity_id, 0)
  ON CONFLICT (study_id, dimension_id) DO NOTHING;

  INSERT INTO public.treatment_study_dimensions (study_id, dimension_id, sort_order)
  VALUES (v_study_id, v_default_id, 1)
  ON CONFLICT (study_id, dimension_id) DO NOTHING;
END $$;
