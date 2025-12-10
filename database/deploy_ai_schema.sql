-- ============================================
-- SUPABASE DEPLOYMENT SCRIPT
-- AI Models Schema + Data Population
-- ============================================

-- Execute this in Supabase SQL Editor

BEGIN;

-- ============================================
-- 1. IRT PARAMETERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.irt_parameters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
    
    -- 3-Parameter Logistic (3PL) IRT Model Parameters
    discrimination DECIMAL(10, 6) NOT NULL,  -- 'a' parameter: how well question differentiates
    difficulty_irt DECIMAL(10, 6) NOT NULL,   -- 'b' parameter: IRT difficulty level
    guessing DECIMAL(10, 6) NOT NULL,         -- 'c' parameter: probability of guessing
    
    -- Metadata
    calibration_date TIMESTAMP DEFAULT NOW(),
    sample_size INTEGER,  -- Number of responses used for calibration
    model_fit JSONB,     -- Goodness-of-fit statistics
    
    -- Constraints
    CONSTRAINT irt_params_unique UNIQUE(question_id),
    CONSTRAINT discrimination_positive CHECK (discrimination > 0),
    CONSTRAINT guessing_valid CHECK (guessing >= 0 AND guessing <= 1)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_irt_parameters_question ON public.irt_parameters(question_id);
CREATE INDEX IF NOT EXISTS idx_irt_difficulty ON public.irt_parameters(difficulty_irt);

COMMENT ON TABLE public.irt_parameters IS 'IRT (Item Response Theory) calibration parameters for CAT algorithm';
COMMENT ON COLUMN public.irt_parameters.discrimination IS 'How well the item differentiates between high/low ability examinees';
COMMENT ON COLUMN public.irt_parameters.difficulty_irt IS 'IRT difficulty on logit scale (theta where P=0.5)';
COMMENT ON COLUMN public.irt_parameters.guessing IS 'Lower asymptote - probability of getting correct by pure chance';

-- ============================================
-- 2. ANTICHEAT MODELS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.anticheat_models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_type VARCHAR(50) NOT NULL,  -- 'gaze', 'objects', 'faces'
    version VARCHAR(20) NOT NULL,
    
    -- Model Performance
    accuracy DECIMAL(5, 4),       -- Overall accuracy (0-1)
    precision_score DECIMAL(5, 4),
    recall DECIMAL(5, 4),
    f1_score DECIMAL(5, 4),
    
    -- Model Configuration
    parameters JSONB NOT NULL,    -- Full model configuration and weights
    threshold DECIMAL(5, 4),      -- Detection confidence threshold
    
    -- Metadata
    trained_at TIMESTAMP DEFAULT NOW(),
    training_dataset VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    notes TEXT,
    
    -- Constraints
    CONSTRAINT model_type_valid CHECK (model_type IN ('gaze', 'objects', 'faces', 'audio', 'behavior')),
    CONSTRAINT accuracy_valid CHECK (accuracy >= 0 AND accuracy <= 1)
);

-- Partial unique index for active models (only one active version per type)
CREATE UNIQUE INDEX unique_active_anticheat_model 
    ON public.anticheat_models(model_type) 
    WHERE is_active = TRUE;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_anticheat_models_type ON public.anticheat_models(model_type);
CREATE INDEX IF NOT EXISTS idx_anticheat_models_active ON public.anticheat_models(is_active) WHERE is_active = TRUE;

COMMENT ON TABLE public.anticheat_models IS 'Trained AI models for anti-cheat detection during exams';
COMMENT ON COLUMN public.anticheat_models.parameters IS 'Complete model configuration including weights, architecture, classes';

-- ============================================
-- 3. ANTICHEAT EVENTS TABLE
-- ============================================  
CREATE TABLE IF NOT EXISTS public.anticheat_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id UUID NOT NULL REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
    
    -- Event Details
    event_type VARCHAR(50) NOT NULL,  -- 'gaze_away', 'phone_detected', 'multiple_faces', 'tab_switch', etc.
    detected_at TIMESTAMP DEFAULT NOW(),
    confidence DECIMAL(5, 4),      -- Model confidence in detection (0-1)
    severity VARCHAR(20) NOT NULL,  -- 'low', 'medium', 'high', 'critical'
    
    -- Evidence
    snapshot TEXT,                  -- Base64 encoded image snapshot
    metadata JSONB,                 -- Additional detection details
    
    -- Review Status
    reviewed BOOLEAN DEFAULT FALSE,
    reviewer_id UUID REFERENCES public.users(id),
    review_decision VARCHAR(20),    -- 'confirmed', 'false_positive', 'uncertain'
    review_notes TEXT,
    reviewed_at TIMESTAMP,
    
    -- Constraints
    CONSTRAINT event_type_valid CHECK (event_type IN (
        'gaze_away', 'phone_detected', 'book_detected', 'multiple_faces', 
        'no_face', 'tab_switch', 'copy_paste', 'suspicious_typing', '
other'
    )),
    CONSTRAINT severity_valid CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    CONSTRAINT confidence_valid CHECK (confidence >= 0 AND confidence <= 1)
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_anticheat_events_attempt ON public.anticheat_events(attempt_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_anticheat_events_type ON public.anticheat_events(event_type);
CREATE INDEX IF NOT EXISTS idx_anticheat_events_severity ON public.anticheat_events(severity) WHERE severity IN ('high', 'critical');
CREATE INDEX IF NOT EXISTS idx_anticheat_events_review ON public.anticheat_events(reviewed) WHERE reviewed = FALSE;

COMMENT ON TABLE public.anticheat_events IS 'Logged anti-cheat events detected during exam attempts';
COMMENT ON COLUMN public.anticheat_events.metadata IS 'Additional context: detected objects, gaze coordinates, etc.';

-- ============================================
-- 4. EXAM ANALYTICS TABLE (BONUS)
-- ============================================
CREATE TABLE IF NOT EXISTS public.exam_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id UUID NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
    
    -- Overall Statistics
    total_attempts INTEGER DEFAULT 0,
    avg_score DECIMAL(5, 2),
    median_score DECIMAL(5, 2),
    std_deviation DECIMAL(5, 2),
    
    -- Question-level Analytics
    question_analytics JSONB,  -- Per-question: facility, discrimination, point-biserial
    
    -- CAT Performance (if adaptive)
    avg_questions_asked DECIMAL(5, 2),
    avg_test_duration INTEGER,  -- in seconds
    
    -- Anticheat Statistics
    total_violations INTEGER DEFAULT 0,
    flagged_attempts INTEGER DEFAULT 0,
    
    -- Updated
    last_updated TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT exam_analytics_unique UNIQUE(exam_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_analytics_exam ON public.exam_analytics(exam_id);

COMMENT ON TABLE public.exam_analytics IS 'Aggregated analytics for exams including psychometric and anticheat stats';

-- ============================================
-- 5. ENABLE ROW LEVEL SECURITY
-- ============================================

ALTER TABLE public.irt_parameters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anticheat_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anticheat_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_analytics ENABLE ROW LEVEL SECURITY;

-- Policies for irt_parameters: Instructors can read, system can write
CREATE POLICY "Instructors can view IRT parameters"
    ON public.irt_parameters FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid() AND users.role = 'instructor'
        )
    );

-- Policies for anticheat_models: Instructors can read
CREATE POLICY "Instructors can view anticheat models"
    ON public.anticheat_models FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid() AND users.role = 'instructor'
        )
    );

-- Policies for anticheat_events: Instructors see own exam events
CREATE POLICY "Instructors can view anticheat events for their exams"
    ON public.anticheat_events FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.exam_attempts
            JOIN public.exams ON exams.id = exam_attempts.exam_id
            WHERE exam_attempts.id = anticheat_events.attempt_id
            AND exams.instructor_id = auth.uid()
        )
    );

-- Policies for exam_analytics: Instructors see their exams only
CREATE POLICY "Instructors can view analytics for their exams"
    ON public.exam_analytics FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.exams
            WHERE exams.id = exam_analytics.exam_id
            AND exams.instructor_id = auth.uid()
        )
    );

-- ============================================
-- 6. FUNCTIONS & TRIGGERS
-- ============================================

-- Function to update exam analytics
CREATE OR REPLACE FUNCTION update_exam_analytics()
RETURNS TRIGGER AS $$
BEGIN
    -- Update analytics when attempt is completed
    IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
        INSERT INTO public.exam_analytics (exam_id, total_attempts)
        VALUES (NEW.exam_id, 1)
        ON CONFLICT (exam_id) DO UPDATE
        SET 
            total_attempts = exam_analytics.total_attempts + 1,
            last_updated = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for automatic analytics updating
DROP TRIGGER IF EXISTS trigger_update_exam_analytics ON public.exam_attempts;
CREATE TRIGGER trigger_update_exam_analytics
    AFTER INSERT OR UPDATE ON public.exam_attempts
    FOR EACH ROW
    EXECUTE FUNCTION update_exam_analytics();

COMMENT ON FUNCTION update_exam_analytics() IS 'Automatically updates exam analytics when attempts are completed';

-- ============================================
-- 7. VIEWS FOR EASY QUERYING
-- ============================================

-- View: Questions with IRT parameters
CREATE OR REPLACE VIEW public.questions_with_irt AS
SELECT 
    q.*,
    irt.discrimination,
    irt.difficulty_irt,
    irt.guessing,
    irt.calibration_date
FROM public.questions q
LEFT JOIN public.irt_parameters irt ON irt.question_id = q.id;

COMMENT ON VIEW public.questions_with_irt IS 'Questions joined with their IRT calibration parameters';

-- View: High-risk exam attempts
CREATE OR REPLACE VIEW public.high_risk_attempts AS
SELECT 
    ea.id AS attempt_id,
    ea.exam_id,
    ea.student_id,
    u.name AS student_name,
    u.email AS student_email,
    COUNT(ace.id) AS total_violations,
    COUNT(ace.id) FILTER (WHERE ace.severity IN ('high', 'critical')) AS critical_violations,
    MAX(ace.detected_at) AS last_violation_time
FROM public.exam_attempts ea
JOIN public.users u ON u.id = ea.student_id
LEFT JOIN public.anticheat_events ace ON ace.attempt_id = ea.id
GROUP BY ea.id, ea.exam_id, ea.student_id, u.name, u.email
HAVING COUNT(ace.id) FILTER (WHERE ace.severity IN ('high', 'critical')) > 0;

COMMENT ON VIEW public.high_risk_attempts IS 'Exam attempts with high or critical anticheat violations';

COMMIT;

-- ============================================
-- SUCCESS MESSAGE
-- ============================================
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '✅ ============================================';
    RAISE NOTICE '✅ AI MODELS SCHEMA DEPLOYED SUCCESSFULLY!';
    RAISE NOTICE '✅ ============================================';
    RAISE NOTICE '';
    RAISE NOTICE '📊 Tables Created:';
    RAISE NOTICE '   - irt_parameters (IRT calibration data)';
    RAISE NOTICE '   - anticheat_models (AI model metadata)';
    RAISE NOTICE '   - anticheat_events (Violation logs)';
    RAISE NOTICE '   - exam_analytics (Aggregated statistics)';
    RAISE NOTICE '';
    RAISE NOTICE '🔒 Row Level Security: ENABLED';
    RAISE NOTICE '⚡ Triggers: ACTIVE';
    RAISE NOTICE '👁️ Views: CREATED';
    RAISE NOTICE '';
    RAISE NOTICE '🚀 Next Steps:';
    RAISE NOTICE '   1. Populate irt_parameters from ai_models/irt_calibration.json';
    RAISE NOTICE '   2. Insert anticheat_models from ai_models/anticheat_models.json';
    RAISE NOTICE '   3. Update server to use database instead of JSON files';
    RAISE NOTICE '';
END $$;
