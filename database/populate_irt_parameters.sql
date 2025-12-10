
-- ================================================
-- POPULATE IRT PARAMETERS FROM TRAINED MODEL
-- ================================================
-- Generated: 2025-11-22T06:35:31.388Z
-- Source: ai_models/irt_calibration.json
-- Total Questions: 500
--
-- IMPORTANT: Before running this script:
-- 1. Update question_id mappings from sample IDs to real UUIDs
-- 2. Ensure questions exist in public.questions table
-- 3. Backup existing irt_parameters if any
-- ================================================

BEGIN;

-- Question: sample_1
INSERT INTO public.irt_parameters (
    question_id,
    discrimination,
    difficulty_irt,
    guessing,
    sample_size,
    model_fit
)
VALUES (
    (SELECT id FROM public.questions WHERE topic = 'Sample' LIMIT 1), -- Replace with actual question UUID
    1.407760,
    -0.017935,
    0.250000,
    500,
    '{"model": "3PL", "fit_index": 0.95}'::jsonb
)
ON CONFLICT (question_id) DO UPDATE SET
    discrimination = EXCLUDED.discrimination,
    difficulty_irt = EXCLUDED.difficulty_irt,
    guessing = EXCLUDED.guessing,
    calibration_date = NOW();

-- Question: sample_2
INSERT INTO public.irt_parameters (
    question_id,
    discrimination,
    difficulty_irt,
    guessing,
    sample_size,
    model_fit
)
VALUES (
    (SELECT id FROM public.questions WHERE topic = 'Sample' LIMIT 1), -- Replace with actual question UUID
    1.438068,
    0.215429,
    0.250000,
    500,
    '{"model": "3PL", "fit_index": 0.95}'::jsonb
)
ON CONFLICT (question_id) DO UPDATE SET
    discrimination = EXCLUDED.discrimination,
    difficulty_irt = EXCLUDED.difficulty_irt,
    guessing = EXCLUDED.guessing,
    calibration_date = NOW();

-- Question: sample_3
INSERT INTO public.irt_parameters (
    question_id,
    discrimination,
    difficulty_irt,
    guessing,
    sample_size,
    model_fit
)
VALUES (
    (SELECT id FROM public.questions WHERE topic = 'Sample' LIMIT 1), -- Replace with actual question UUID
    1.481712,
    0.032105,
    0.250000,
    500,
    '{"model": "3PL", "fit_index": 0.95}'::jsonb
)
ON CONFLICT (question_id) DO UPDATE SET
    discrimination = EXCLUDED.discrimination,
    difficulty_irt = EXCLUDED.difficulty_irt,
    guessing = EXCLUDED.guessing,
    calibration_date = NOW();

-- Question: sample_4
INSERT INTO public.irt_parameters (
    question_id,
    discrimination,
    difficulty_irt,
    guessing,
    sample_size,
    model_fit
)
VALUES (
    (SELECT id FROM public.questions WHERE topic = 'Sample' LIMIT 1), -- Replace with actual question UUID
    1.580796,
    -0.078263,
    0.250000,
    500,
    '{"model": "3PL", "fit_index": 0.95}'::jsonb
)
ON CONFLICT (question_id) DO UPDATE SET
    discrimination = EXCLUDED.discrimination,
    difficulty_irt = EXCLUDED.difficulty_irt,
    guessing = EXCLUDED.guessing,
    calibration_date = NOW();

-- Question: sample_5
INSERT INTO public.irt_parameters (
    question_id,
    discrimination,
    difficulty_irt,
    guessing,
    sample_size,
    model_fit
)
VALUES (
    (SELECT id FROM public.questions WHERE topic = 'Sample' LIMIT 1), -- Replace with actual question UUID
    1.528114,
    0.088619,
    0.250000,
    500,
    '{"model": "3PL", "fit_index": 0.95}'::jsonb
)
ON CONFLICT (question_id) DO UPDATE SET
    discrimination = EXCLUDED.discrimination,
    difficulty_irt = EXCLUDED.difficulty_irt,
    guessing = EXCLUDED.guessing,
    calibration_date = NOW();

-- Question: sample_6
INSERT INTO public.irt_parameters (
    question_id,
    discrimination,
    difficulty_irt,
    guessing,
    sample_size,
    model_fit
)
VALUES (
    (SELECT id FROM public.questions WHERE topic = 'Sample' LIMIT 1), -- Replace with actual question UUID
    1.450934,
    -0.027690,
    0.250000,
    500,
    '{"model": "3PL", "fit_index": 0.95}'::jsonb
)
ON CONFLICT (question_id) DO UPDATE SET
    discrimination = EXCLUDED.discrimination,
    difficulty_irt = EXCLUDED.difficulty_irt,
    guessing = EXCLUDED.guessing,
    calibration_date = NOW();

-- Question: sample_7
INSERT INTO public.irt_parameters (
    question_id,
    discrimination,
    difficulty_irt,
    guessing,
    sample_size,
    model_fit
)
VALUES (
    (SELECT id FROM public.questions WHERE topic = 'Sample' LIMIT 1), -- Replace with actual question UUID
    1.504186,
    0.021439,
    0.250000,
    500,
    '{"model": "3PL", "fit_index": 0.95}'::jsonb
)
ON CONFLICT (question_id) DO UPDATE SET
    discrimination = EXCLUDED.discrimination,
    difficulty_irt = EXCLUDED.difficulty_irt,
    guessing = EXCLUDED.guessing,
    calibration_date = NOW();

-- Question: sample_8
INSERT INTO public.irt_parameters (
    question_id,
    discrimination,
    difficulty_irt,
    guessing,
    sample_size,
    model_fit
)
VALUES (
    (SELECT id FROM public.questions WHERE topic = 'Sample' LIMIT 1), -- Replace with actual question UUID
    1.484807,
    0.097707,
    0.250000,
    500,
    '{"model": "3PL", "fit_index": 0.95}'::jsonb
)
ON CONFLICT (question_id) DO UPDATE SET
    discrimination = EXCLUDED.discrimination,
    difficulty_irt = EXCLUDED.difficulty_irt,
    guessing = EXCLUDED.guessing,
    calibration_date = NOW();

-- Question: sample_9
INSERT INTO public.irt_parameters (
    question_id,
    discrimination,
    difficulty_irt,
    guessing,
    sample_size,
    model_fit
)
VALUES (
    (SELECT id FROM public.questions WHERE topic = 'Sample' LIMIT 1), -- Replace with actual question UUID
    1.568052,
    0.195376,
    0.250000,
    500,
    '{"model": "3PL", "fit_index": 0.95}'::jsonb
)
ON CONFLICT (question_id) DO UPDATE SET
    discrimination = EXCLUDED.discrimination,
    difficulty_irt = EXCLUDED.difficulty_irt,
    guessing = EXCLUDED.guessing,
    calibration_date = NOW();

-- Question: sample_10
INSERT INTO public.irt_parameters (
    question_id,
    discrimination,
    difficulty_irt,
    guessing,
    sample_size,
    model_fit
)
VALUES (
    (SELECT id FROM public.questions WHERE topic = 'Sample' LIMIT 1), -- Replace with actual question UUID
    1.413941,
    0.053791,
    0.250000,
    500,
    '{"model": "3PL", "fit_index": 0.95}'::jsonb
)
ON CONFLICT (question_id) DO UPDATE SET
    discrimination = EXCLUDED.discrimination,
    difficulty_irt = EXCLUDED.difficulty_irt,
    guessing = EXCLUDED.guessing,
    calibration_date = NOW();

-- ... (remaining 490 statements)
-- 
-- NOTE: This is a sample showing first 10 questions.
-- For production, generate full script with actual question UUIDs.

COMMIT;

-- ================================================
-- VERIFICATION QUERY
-- ================================================
SELECT 
    COUNT(*) as total_calibrated_questions,
    AVG(discrimination) as avg_discrimination,
    AVG(difficulty_irt) as avg_difficulty,
    MIN(calibration_date) as first_calibrated,
    MAX(calibration_date) as last_calibrated
FROM public.irt_parameters;

-- Expected Results:
-- total_calibrated_questions: 500
-- avg_discrimination: ~1.49
-- avg_difficulty: ~0.00
