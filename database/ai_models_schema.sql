-- AI Models Integration Schema for Supabase
-- This schema adds tables to store trained AI model parameters

-- Table for IRT (Item Response Theory) calibrated parameters
CREATE TABLE IF NOT EXISTS irt_parameters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
  discrimination DECIMAL(10, 4) NOT NULL,  -- 'a' parameter
  difficulty DECIMAL(10, 4) NOT NULL,      -- 'b' parameter
  guessing DECIMAL(10, 4) NOT NULL,        -- 'c' parameter
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX idx_irt_question_id ON irt_parameters(question_id);

-- Table for anti-cheat model metadata
CREATE TABLE IF NOT EXISTS anticheat_models (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  model_type VARCHAR(50) NOT NULL, -- 'gaze', 'objects', 'faces'
  version VARCHAR(20) NOT NULL,
  accuracy DECIMAL(5, 4),
  parameters JSONB NOT NULL,      -- Model-specific parameters
  model_path TEXT,                -- Path to model file if stored
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for storing anti-cheat detection events
CREATE TABLE IF NOT EXISTS anticheat_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attempt_id UUID REFERENCES exam_attempts(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL, -- 'gaze_away', 'object_detected', 'multiple_faces'
  confidence DECIMAL(5, 4),
  metadata JSONB,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for attempt-based queries
CREATE INDEX idx_anticheat_attempt_id ON anticheat_events(attempt_id);
CREATE INDEX idx_anticheat_timestamp ON anticheat_events(timestamp);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for auto-updating timestamps
CREATE TRIGGER update_irt_parameters_updated_at
    BEFORE UPDATE ON irt_parameters
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_anticheat_models_updated_at
    BEFORE UPDATE ON anticheat_models
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE irt_parameters IS 'Stores IRT 3PL model parameters for adaptive testing';
COMMENT ON TABLE anticheat_models IS 'Metadata for trained anti-cheat AI models';
COMMENT ON TABLE anticheat_events IS 'Log of anti-cheat detection events during exam attempts';
