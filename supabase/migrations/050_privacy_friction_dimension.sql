-- 050_privacy_friction_dimension.sql
-- Aligns the crossed factor structure with the honors prospectus §5.2:
--   Factor A: privacy_default (private / neutral / public)
--   Factor B: privacy_friction (low / high)          ← NEW
-- yielding the prospectus's 3×2 = 6 cells.
--
-- privacy_control_complexity is UNLINKED from the study (held constant at
-- "moderate" in the app when unassigned) but its dimension row is kept, so
-- re-crossing it later is a single INSERT into treatment_study_dimensions.
--
-- ⚠️ Mentor decision point (docs/PROSPECTUS_GAP_PLAN.md, D1): if Dr. Keith
-- instead keeps the 3×3 complexity×default design, revert by re-linking the
-- complexity dimension and unlinking privacy_friction.

DO $$
DECLARE
  v_study_id      UUID;
  v_friction_id   UUID;
  v_complexity_id UUID;
BEGIN
  SELECT id INTO v_study_id
    FROM public.treatment_studies
   WHERE study_code = 'privacy_pilot_2026';
  IF v_study_id IS NULL THEN
    RAISE EXCEPTION 'privacy_pilot_2026 study not found (apply 044 first)';
  END IF;

  -- ── Dimension: change friction (prospectus Factor B) ────────────
  SELECT id INTO v_friction_id
    FROM public.treatment_dimensions
   WHERE name = 'privacy_friction';
  IF v_friction_id IS NULL THEN
    INSERT INTO public.treatment_dimensions (name, description, levels, is_active)
    VALUES ('privacy_friction',
            'Difficulty of changing privacy settings. low = prominent nav entry + one-step save, neutral labels; high = buried entry, advanced-controls gate, confirmation step with mildly discouraging framing on protective changes.',
            ARRAY['low','high'], true)
    RETURNING id INTO v_friction_id;
  END IF;

  INSERT INTO public.treatment_study_dimensions (study_id, dimension_id, sort_order)
  VALUES (v_study_id, v_friction_id, 1)
  ON CONFLICT (study_id, dimension_id) DO NOTHING;

  -- ── Hold control complexity constant (not crossed) ──────────────
  SELECT id INTO v_complexity_id
    FROM public.treatment_dimensions
   WHERE name = 'privacy_control_complexity';
  IF v_complexity_id IS NOT NULL THEN
    DELETE FROM public.treatment_study_dimensions
     WHERE study_id = v_study_id AND dimension_id = v_complexity_id;
  END IF;
END $$;
