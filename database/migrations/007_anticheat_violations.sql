-- Anti-Cheat Violations Table
-- Stores all detected violations during exams
-- Automatically locks exams after 3+ violations

CREATE TABLE IF NOT EXISTS anticheat_violations (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    attempt_id UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- gaze-away, phone-detected, multiple-faces, tab-switch, fullscreen-exit, etc.
    severity VARCHAR(20) NOT NULL DEFAULT 'medium', -- low, medium, high, critical
    message TEXT,
    metadata JSONB DEFAULT '{}'::jsonb, -- Store additional data (gaze coords, head pose angles, etc.)
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_violations_attempt ON anticheat_violations(attempt_id);
CREATE INDEX IF NOT EXISTS idx_violations_type ON anticheat_violations(type);
CREATE INDEX IF NOT EXISTS idx_violations_detected_at ON anticheat_violations(detected_at DESC);

-- Row Level Security
ALTER TABLE anticheat_violations ENABLE ROW LEVEL SECURITY;

-- Policy: Students can only view their own violations
CREATE POLICY "Students can view own violations"
    ON anticheat_violations
    FOR SELECT
    USING (
        attempt_id IN (
            SELECT id FROM exam_attempts WHERE user_id = auth.uid()
        )
    );

-- Policy: Teachers can view violations for their exams
CREATE POLICY "Teachers can view exam violations"
    ON anticheat_violations
    FOR SELECT
    USING (
        attempt_id IN (
            SELECT ea.id FROM exam_attempts ea
            JOIN exams e ON ea.exam_id = e.id
            JOIN class_members cm ON e.class_id = cm.class_id
            WHERE cm.user_id = auth.uid() AND cm.role = 'teacher'
        )
    );

-- Policy: System can insert violations
CREATE POLICY "System can insert violations"
    ON anticheat_violations
    FOR INSERT
    WITH CHECK (true); -- Service role key bypasses RLS

-- Function: Auto-lock exam after 3 violations
CREATE OR REPLACE FUNCTION auto_lock_exam_on_violations()
RETURNS TRIGGER AS $$
BEGIN
    -- Count total violations for this attempt
    DECLARE
        violation_count INTEGER;
    BEGIN
        SELECT COUNT(*) INTO violation_count
        FROM anticheat_violations
        WHERE attempt_id = NEW.attempt_id;

        -- If 3 or more violations, lock the exam
        IF violation_count >= 3 THEN
            UPDATE exam_attempts
            SET 
                status = 'locked',
                locked_reason = 'Multiple anti-cheat violations detected',
                updated_at = NOW()
            WHERE id = NEW.attempt_id;
            
            RAISE NOTICE 'Exam attempt % locked due to % violations', NEW.attempt_id, violation_count;
        END IF;
    END;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: After insert violation, check if should lock
DROP TRIGGER IF EXISTS trigger_auto_lock_exam ON anticheat_violations;
CREATE TRIGGER trigger_auto_lock_exam
    AFTER INSERT ON anticheat_violations
    FOR EACH ROW
    EXECUTE FUNCTION auto_lock_exam_on_violations();

-- Comments
COMMENT ON TABLE anticheat_violations IS 'Stores all anti-cheat violations detected during exams. Auto-locks after 3+ violations.';
COMMENT ON COLUMN anticheat_violations.type IS 'Type of violation: gaze-away, phone-detected, multiple-faces, tab-switch, fullscreen-exit, copy-paste, etc.';
COMMENT ON COLUMN anticheat_violations.severity IS 'Severity level: low, medium, high, critical';
COMMENT ON COLUMN anticheat_violations.metadata IS 'Additional violation data (gaze coordinates, head pose angles, detected objects, etc.)';

-- Sample query examples
-- Get violations for an attempt:
-- SELECT * FROM anticheat_violations WHERE attempt_id = 'xxx' ORDER BY detected_at DESC;

-- Get violation summary for an exam:
-- SELECT type, COUNT(*) as count, AVG((metadata->>'confidence')::float) as avg_confidence
-- FROM anticheat_violations v
-- JOIN exam_attempts ea ON v.attempt_id = ea.id
-- WHERE ea.exam_id = 'xxx'
-- GROUP BY type;
