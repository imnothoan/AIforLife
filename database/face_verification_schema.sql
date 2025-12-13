-- ================================================================
-- FACE VERIFICATION SCHEMA UPDATE
-- Adds face embedding storage for identity verification
-- ================================================================

-- Add face_embedding column to profiles table
-- Using JSONB to store the embedding array (flexible and queryable)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS face_embedding JSONB,
ADD COLUMN IF NOT EXISTS face_image_url TEXT,
ADD COLUMN IF NOT EXISTS face_enrolled_at TIMESTAMPTZ;

-- Add index for faster lookup
CREATE INDEX IF NOT EXISTS idx_profiles_face_enrolled 
ON public.profiles(face_enrolled_at) 
WHERE face_embedding IS NOT NULL;

-- Add face verification logs table
CREATE TABLE IF NOT EXISTS public.face_verification_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES public.exam_sessions(id) ON DELETE CASCADE,
  student_id UUID REFERENCES public.profiles(id) NOT NULL,
  verification_type TEXT NOT NULL CHECK (verification_type IN ('start', 'random', 'submit', 'triggered')),
  similarity_score NUMERIC(5,4),
  is_match BOOLEAN,
  captured_image_url TEXT,
  error_reason TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on face verification logs
ALTER TABLE public.face_verification_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Students can insert their own verification logs
CREATE POLICY "Students can insert own face verification logs"
  ON public.face_verification_logs FOR INSERT
  WITH CHECK (student_id = auth.uid());

-- Policy: Instructors can view verification logs for their exams
CREATE POLICY "Instructors can view face verification logs"
  ON public.face_verification_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.exam_sessions es
      JOIN public.exams e ON e.id = es.exam_id
      JOIN public.classes c ON c.id = e.class_id
      WHERE es.id = face_verification_logs.session_id
      AND c.instructor_id = auth.uid()
    )
  );

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_face_verification_session 
ON public.face_verification_logs(session_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_face_verification_student 
ON public.face_verification_logs(student_id, timestamp DESC);

-- Add face verification count to exam_sessions
ALTER TABLE public.exam_sessions
ADD COLUMN IF NOT EXISTS face_verification_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS face_verification_failures INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_face_verification_at TIMESTAMPTZ;

-- Function to log face verification
CREATE OR REPLACE FUNCTION public.log_face_verification(
  p_session_id UUID,
  p_verification_type TEXT,
  p_similarity_score NUMERIC DEFAULT NULL,
  p_is_match BOOLEAN DEFAULT NULL,
  p_error_reason TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_log_id UUID;
BEGIN
  -- Insert verification log
  INSERT INTO public.face_verification_logs (
    session_id, student_id, verification_type, 
    similarity_score, is_match, error_reason
  ) VALUES (
    p_session_id, auth.uid(), p_verification_type,
    p_similarity_score, p_is_match, p_error_reason
  )
  RETURNING id INTO v_log_id;
  
  -- Update session counters
  UPDATE public.exam_sessions SET
    face_verification_count = face_verification_count + 1,
    face_verification_failures = face_verification_failures + 
      CASE WHEN p_is_match = false THEN 1 ELSE 0 END,
    last_face_verification_at = NOW()
  WHERE id = p_session_id AND student_id = auth.uid();
  
  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update face embedding
CREATE OR REPLACE FUNCTION public.update_face_embedding(
  p_embedding JSONB,
  p_image_url TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.profiles SET
    face_embedding = p_embedding,
    face_image_url = COALESCE(p_image_url, face_image_url),
    face_enrolled_at = NOW()
  WHERE id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comments for documentation
COMMENT ON COLUMN public.profiles.face_embedding IS 'Face embedding vector for identity verification (JSON array of floats)';
COMMENT ON COLUMN public.profiles.face_enrolled_at IS 'Timestamp when face was enrolled for verification';
COMMENT ON TABLE public.face_verification_logs IS 'Logs of all face verification attempts during exams';
