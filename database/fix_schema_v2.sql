-- ============================================
-- FIX SCHEMA V2
-- Adds missing 'notes' column and fixes IRT constraint
-- ============================================

BEGIN;

-- 1. Fix anticheat_models: Add notes column
ALTER TABLE public.anticheat_models 
ADD COLUMN IF NOT EXISTS notes TEXT;

-- 2. Fix IRT constraint
-- Drop existing constraint if it exists (to avoid conflict errors)
ALTER TABLE public.irt_parameters DROP CONSTRAINT IF EXISTS irt_params_unique;

-- Re-add constraint properly
ALTER TABLE public.irt_parameters 
ADD CONSTRAINT irt_params_unique UNIQUE(question_id);

COMMIT;

-- Verify
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'anticheat_models' AND column_name = 'notes';
