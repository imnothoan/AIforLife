-- ============================================
-- FIX SCHEMA SCRIPT
-- Adds missing columns to existing tables
-- ============================================

BEGIN;

-- 1. Fix anticheat_models
ALTER TABLE public.anticheat_models 
ADD COLUMN IF NOT EXISTS f1_score DECIMAL(5, 4),
ADD COLUMN IF NOT EXISTS precision_score DECIMAL(5, 4),
ADD COLUMN IF NOT EXISTS recall DECIMAL(5, 4);

-- 2. Fix irt_parameters
-- Check if difficulty exists and rename or add difficulty_irt
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'irt_parameters' AND column_name = 'difficulty') THEN
        ALTER TABLE public.irt_parameters RENAME COLUMN difficulty TO difficulty_irt;
    ELSE
        ALTER TABLE public.irt_parameters ADD COLUMN IF NOT EXISTS difficulty_irt DECIMAL(10, 6);
    END IF;
END $$;

ALTER TABLE public.irt_parameters 
ADD COLUMN IF NOT EXISTS sample_size INTEGER,
ADD COLUMN IF NOT EXISTS model_fit JSONB;

-- 3. Fix anticheat_events (just in case)
ALTER TABLE public.anticheat_events
ADD COLUMN IF NOT EXISTS review_decision VARCHAR(20),
ADD COLUMN IF NOT EXISTS review_notes TEXT;

COMMIT;

-- Verify
SELECT column_name, table_name 
FROM information_schema.columns 
WHERE table_name IN ('anticheat_models', 'irt_parameters')
AND column_name IN ('f1_score', 'difficulty_irt');
