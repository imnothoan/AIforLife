-- ================================================================
-- SMART EXAM PLATFORM - COMPREHENSIVE DATABASE SCHEMA
-- ================================================================
-- This schema is designed for:
-- 1. High concurrency (race condition prevention)
-- 2. Row-level security (RLS)
-- 3. Full audit trail
-- ================================================================

-- ================================================
-- SECTION 1: USER PROFILES & ROLES
-- ================================================

-- User profiles extending Supabase auth.users
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'instructor', 'admin')),
  student_id TEXT, -- Mã sinh viên
  phone TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger to auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ================================================
-- SECTION 2: CLASSES & ENROLLMENT
-- ================================================

-- Classes/Courses
CREATE TABLE IF NOT EXISTS public.classes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE, -- Mã lớp (e.g., INT3401-20231)
  description TEXT,
  instructor_id UUID REFERENCES public.profiles(id) NOT NULL,
  semester TEXT, -- Học kỳ
  academic_year TEXT, -- Năm học
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Class enrollment (many-to-many: students <-> classes)
CREATE TABLE IF NOT EXISTS public.enrollments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id UUID REFERENCES public.classes(id) ON DELETE CASCADE NOT NULL,
  student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'dropped', 'completed')),
  UNIQUE(class_id, student_id)
);

-- ================================================
-- SECTION 3: EXAMS & QUESTIONS
-- ================================================

-- Exams
CREATE TABLE IF NOT EXISTS public.exams (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id UUID REFERENCES public.classes(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  -- Exam settings
  is_shuffled BOOLEAN DEFAULT TRUE, -- Shuffle questions
  show_result_immediately BOOLEAN DEFAULT FALSE,
  allow_review BOOLEAN DEFAULT FALSE,
  passing_score NUMERIC(5,2) DEFAULT 50.00,
  max_attempts INTEGER DEFAULT 1,
  -- Anti-cheat settings
  require_camera BOOLEAN DEFAULT TRUE,
  require_fullscreen BOOLEAN DEFAULT TRUE,
  max_tab_violations INTEGER DEFAULT 3,
  max_fullscreen_violations INTEGER DEFAULT 3,
  -- Status
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'in_progress', 'completed', 'cancelled')),
  created_by UUID REFERENCES public.profiles(id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure end_time > start_time
  CONSTRAINT valid_exam_time CHECK (end_time > start_time)
);

-- Question bank
CREATE TABLE IF NOT EXISTS public.questions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID REFERENCES public.exams(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_type TEXT DEFAULT 'multiple_choice' CHECK (question_type IN ('multiple_choice', 'multiple_select', 'true_false', 'short_answer', 'essay')),
  options JSONB, -- Array of options for MC questions: [{"id": "A", "text": "..."}, ...]
  correct_answer JSONB NOT NULL, -- Single answer or array for multiple select
  explanation TEXT, -- Explanation shown after exam
  points NUMERIC(5,2) DEFAULT 1.00,
  difficulty TEXT DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  -- IRT parameters (for adaptive testing)
  irt_a NUMERIC(5,3) DEFAULT 1.0, -- Discrimination
  irt_b NUMERIC(5,3) DEFAULT 0.0, -- Difficulty
  irt_c NUMERIC(5,3) DEFAULT 0.25, -- Guessing
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================
-- SECTION 4: EXAM SESSIONS & ANSWERS
-- ================================================

-- Exam sessions (each attempt by a student)
CREATE TABLE IF NOT EXISTS public.exam_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID REFERENCES public.exams(id) ON DELETE CASCADE NOT NULL,
  student_id UUID REFERENCES public.profiles(id) NOT NULL,
  attempt_number INTEGER DEFAULT 1,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  -- Score
  total_score NUMERIC(5,2),
  max_score NUMERIC(5,2),
  percentage NUMERIC(5,2),
  passed BOOLEAN,
  -- Anti-cheat metrics
  cheat_count INTEGER DEFAULT 0,
  tab_violations INTEGER DEFAULT 0,
  fullscreen_violations INTEGER DEFAULT 0,
  multi_screen_detected BOOLEAN DEFAULT FALSE,
  gaze_away_count INTEGER DEFAULT 0,
  suspicious_object_count INTEGER DEFAULT 0,
  -- Session state
  status TEXT DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'auto_submitted', 'terminated')),
  termination_reason TEXT,
  -- Browser/device info
  user_agent TEXT,
  ip_address TEXT,
  -- Proctoring flags
  is_flagged BOOLEAN DEFAULT FALSE,
  flag_reason TEXT,
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent multiple active sessions
  UNIQUE(exam_id, student_id, attempt_number)
);

-- Student answers
CREATE TABLE IF NOT EXISTS public.answers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES public.exam_sessions(id) ON DELETE CASCADE NOT NULL,
  question_id UUID REFERENCES public.questions(id) ON DELETE CASCADE NOT NULL,
  student_answer JSONB, -- The student's answer
  is_correct BOOLEAN,
  points_earned NUMERIC(5,2) DEFAULT 0,
  -- Flagging and notes
  is_flagged BOOLEAN DEFAULT FALSE, -- Student flagged for review
  student_notes TEXT, -- Scratch notes for this question
  -- Timing
  time_spent_seconds INTEGER DEFAULT 0,
  answered_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(session_id, question_id)
);

-- ================================================
-- SECTION 5: PROCTORING LOGS
-- ================================================

-- Detailed proctoring event log
CREATE TABLE IF NOT EXISTS public.proctoring_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES public.exam_sessions(id) ON DELETE CASCADE NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'tab_switch', 'fullscreen_exit', 'multi_screen', 
    'object_detected', 'face_not_detected', 'gaze_away',
    'copy_paste_attempt', 'right_click', 'keyboard_shortcut',
    'remote_desktop_detected', 'screen_share_detected',
    'ai_alert', 'manual_flag'
  )),
  severity TEXT DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  details JSONB, -- Additional context
  screenshot_url TEXT, -- Optional screenshot
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for fast log queries
CREATE INDEX IF NOT EXISTS idx_proctoring_logs_session 
  ON public.proctoring_logs(session_id, timestamp DESC);

-- ================================================
-- SECTION 6: ROW LEVEL SECURITY (RLS)
-- ================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proctoring_logs ENABLE ROW LEVEL SECURITY;

-- PROFILES POLICIES
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Instructors can view enrolled students"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.classes c
      JOIN public.enrollments e ON e.class_id = c.id
      WHERE c.instructor_id = auth.uid()
      AND e.student_id = profiles.id
    )
  );

-- CLASSES POLICIES
CREATE POLICY "Anyone can view active classes"
  ON public.classes FOR SELECT
  USING (is_active = true);

-- SELECT: Instructors can view their own classes (including inactive)
CREATE POLICY "Instructors can view own classes"
  ON public.classes FOR SELECT
  USING (instructor_id = auth.uid());

-- INSERT: Instructors can create classes if they set themselves as instructor
CREATE POLICY "Instructors can create classes"
  ON public.classes FOR INSERT
  WITH CHECK (
    instructor_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND role IN ('instructor', 'admin')
    )
  );

-- UPDATE: Instructors can update their own classes
CREATE POLICY "Instructors can update own classes"
  ON public.classes FOR UPDATE
  USING (instructor_id = auth.uid())
  WITH CHECK (instructor_id = auth.uid());

-- DELETE: Instructors can delete their own classes
CREATE POLICY "Instructors can delete own classes"
  ON public.classes FOR DELETE
  USING (instructor_id = auth.uid());

-- ENROLLMENTS POLICIES
CREATE POLICY "Students can view own enrollments"
  ON public.enrollments FOR SELECT
  USING (student_id = auth.uid());

-- Instructors can view enrollments for their classes
CREATE POLICY "Instructors can view class enrollments"
  ON public.enrollments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.classes 
      WHERE id = enrollments.class_id 
      AND instructor_id = auth.uid()
    )
  );

-- Instructors can add students to their classes
CREATE POLICY "Instructors can add students to classes"
  ON public.enrollments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.classes 
      WHERE id = class_id 
      AND instructor_id = auth.uid()
    )
  );

-- Instructors can update enrollments for their classes
CREATE POLICY "Instructors can update class enrollments"
  ON public.enrollments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.classes 
      WHERE id = enrollments.class_id 
      AND instructor_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.classes 
      WHERE id = enrollments.class_id 
      AND instructor_id = auth.uid()
    )
  );

-- Instructors can remove students from their classes
CREATE POLICY "Instructors can remove students from classes"
  ON public.enrollments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.classes 
      WHERE id = enrollments.class_id 
      AND instructor_id = auth.uid()
    )
  );

-- EXAMS POLICIES
CREATE POLICY "Students can view published exams for enrolled classes"
  ON public.exams FOR SELECT
  USING (
    status = 'published' AND
    EXISTS (
      SELECT 1 FROM public.enrollments 
      WHERE class_id = exams.class_id 
      AND student_id = auth.uid()
      AND status = 'active'
    )
  );

-- Instructors can view exams for their classes
CREATE POLICY "Instructors can view exams for own classes"
  ON public.exams FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.classes 
      WHERE id = exams.class_id 
      AND instructor_id = auth.uid()
    )
  );

-- Instructors can create exams for their classes
CREATE POLICY "Instructors can create exams for own classes"
  ON public.exams FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.classes 
      WHERE id = class_id 
      AND instructor_id = auth.uid()
    )
    AND created_by = auth.uid()
  );

-- Instructors can update exams for their classes
CREATE POLICY "Instructors can update exams for own classes"
  ON public.exams FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.classes 
      WHERE id = exams.class_id 
      AND instructor_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.classes 
      WHERE id = exams.class_id 
      AND instructor_id = auth.uid()
    )
  );

-- Instructors can delete exams for their classes
CREATE POLICY "Instructors can delete exams for own classes"
  ON public.exams FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.classes 
      WHERE id = exams.class_id 
      AND instructor_id = auth.uid()
    )
  );

-- QUESTIONS POLICIES
CREATE POLICY "Students can view questions during active exam"
  ON public.questions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.exam_sessions es
      JOIN public.exams e ON e.id = es.exam_id
      WHERE e.id = questions.exam_id
      AND es.student_id = auth.uid()
      AND es.status = 'in_progress'
    )
  );

-- Instructors can view questions for their exams
CREATE POLICY "Instructors can view questions for own exams"
  ON public.questions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.exams e
      JOIN public.classes c ON c.id = e.class_id
      WHERE e.id = questions.exam_id
      AND c.instructor_id = auth.uid()
    )
  );

-- Instructors can create questions for their exams
CREATE POLICY "Instructors can create questions for own exams"
  ON public.questions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.exams e
      JOIN public.classes c ON c.id = e.class_id
      WHERE e.id = exam_id
      AND c.instructor_id = auth.uid()
    )
  );

-- Instructors can update questions for their exams
CREATE POLICY "Instructors can update questions for own exams"
  ON public.questions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.exams e
      JOIN public.classes c ON c.id = e.class_id
      WHERE e.id = questions.exam_id
      AND c.instructor_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.exams e
      JOIN public.classes c ON c.id = e.class_id
      WHERE e.id = questions.exam_id
      AND c.instructor_id = auth.uid()
    )
  );

-- Instructors can delete questions for their exams
CREATE POLICY "Instructors can delete questions for own exams"
  ON public.questions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.exams e
      JOIN public.classes c ON c.id = e.class_id
      WHERE e.id = questions.exam_id
      AND c.instructor_id = auth.uid()
    )
  );

-- EXAM SESSIONS POLICIES
CREATE POLICY "Students can view own sessions"
  ON public.exam_sessions FOR SELECT
  USING (student_id = auth.uid());

CREATE POLICY "Students can insert own sessions"
  ON public.exam_sessions FOR INSERT
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students can update own active sessions"
  ON public.exam_sessions FOR UPDATE
  USING (student_id = auth.uid() AND status = 'in_progress');

CREATE POLICY "Instructors can view sessions for own exams"
  ON public.exam_sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.exams e
      JOIN public.classes c ON c.id = e.class_id
      WHERE e.id = exam_sessions.exam_id
      AND c.instructor_id = auth.uid()
    )
  );

-- ANSWERS POLICIES
CREATE POLICY "Students can manage own answers"
  ON public.answers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.exam_sessions 
      WHERE id = answers.session_id 
      AND student_id = auth.uid()
    )
  );

CREATE POLICY "Instructors can view answers for own exams"
  ON public.answers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.exam_sessions es
      JOIN public.exams e ON e.id = es.exam_id
      JOIN public.classes c ON c.id = e.class_id
      WHERE es.id = answers.session_id
      AND c.instructor_id = auth.uid()
    )
  );

-- PROCTORING LOGS POLICIES
CREATE POLICY "Students can insert own proctoring logs"
  ON public.proctoring_logs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.exam_sessions 
      WHERE id = proctoring_logs.session_id 
      AND student_id = auth.uid()
    )
  );

CREATE POLICY "Instructors can view proctoring logs for own exams"
  ON public.proctoring_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.exam_sessions es
      JOIN public.exams e ON e.id = es.exam_id
      JOIN public.classes c ON c.id = e.class_id
      WHERE es.id = proctoring_logs.session_id
      AND c.instructor_id = auth.uid()
    )
  );

-- ================================================
-- SECTION 7: FUNCTIONS FOR CONCURRENCY CONTROL
-- ================================================

-- Function to safely start an exam session (prevents race conditions)
CREATE OR REPLACE FUNCTION public.start_exam_session(
  p_exam_id UUID,
  p_user_agent TEXT DEFAULT NULL,
  p_ip_address TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_session_id UUID;
  v_attempt_number INTEGER;
  v_max_attempts INTEGER;
  v_current_attempts INTEGER;
  v_exam_record RECORD;
BEGIN
  -- Lock the exam row to prevent concurrent modifications
  SELECT * INTO v_exam_record
  FROM public.exams
  WHERE id = p_exam_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exam not found';
  END IF;
  
  -- Check if exam is active
  IF v_exam_record.status != 'published' THEN
    RAISE EXCEPTION 'Exam is not available';
  END IF;
  
  -- Check time window
  IF NOW() < v_exam_record.start_time THEN
    RAISE EXCEPTION 'Exam has not started yet';
  END IF;
  
  IF NOW() > v_exam_record.end_time THEN
    RAISE EXCEPTION 'Exam has ended';
  END IF;
  
  -- Check enrollment
  IF NOT EXISTS (
    SELECT 1 FROM public.enrollments e
    WHERE e.class_id = v_exam_record.class_id
    AND e.student_id = auth.uid()
    AND e.status = 'active'
  ) THEN
    RAISE EXCEPTION 'You are not enrolled in this class';
  END IF;
  
  -- Check attempt limit
  SELECT COUNT(*) INTO v_current_attempts
  FROM public.exam_sessions
  WHERE exam_id = p_exam_id AND student_id = auth.uid();
  
  IF v_current_attempts >= v_exam_record.max_attempts THEN
    RAISE EXCEPTION 'Maximum attempts reached';
  END IF;
  
  -- Check for existing active session
  SELECT id INTO v_session_id
  FROM public.exam_sessions
  WHERE exam_id = p_exam_id 
  AND student_id = auth.uid()
  AND status = 'in_progress';
  
  IF FOUND THEN
    -- Return existing active session
    RETURN v_session_id;
  END IF;
  
  -- Create new session
  v_attempt_number := v_current_attempts + 1;
  
  INSERT INTO public.exam_sessions (
    exam_id, student_id, attempt_number, user_agent, ip_address
  ) VALUES (
    p_exam_id, auth.uid(), v_attempt_number, p_user_agent, p_ip_address
  )
  RETURNING id INTO v_session_id;
  
  RETURN v_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to safely submit an answer (with optimistic locking)
CREATE OR REPLACE FUNCTION public.submit_answer(
  p_session_id UUID,
  p_question_id UUID,
  p_answer JSONB,
  p_time_spent INTEGER DEFAULT 0
)
RETURNS VOID AS $$
DECLARE
  v_session RECORD;
  v_question RECORD;
  v_is_correct BOOLEAN;
  v_points NUMERIC(5,2);
BEGIN
  -- Lock session row
  SELECT * INTO v_session
  FROM public.exam_sessions
  WHERE id = p_session_id
  FOR UPDATE;
  
  IF NOT FOUND OR v_session.student_id != auth.uid() THEN
    RAISE EXCEPTION 'Invalid session';
  END IF;
  
  IF v_session.status != 'in_progress' THEN
    RAISE EXCEPTION 'Exam session is not active';
  END IF;
  
  -- Get question details
  SELECT * INTO v_question
  FROM public.questions
  WHERE id = p_question_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question not found';
  END IF;
  
  -- Check answer correctness
  IF v_question.question_type = 'multiple_choice' THEN
    v_is_correct := p_answer = v_question.correct_answer;
    v_points := CASE WHEN v_is_correct THEN v_question.points ELSE 0 END;
  ELSIF v_question.question_type = 'true_false' THEN
    v_is_correct := p_answer = v_question.correct_answer;
    v_points := CASE WHEN v_is_correct THEN v_question.points ELSE 0 END;
  ELSE
    -- For essay/short answer, needs manual grading
    v_is_correct := NULL;
    v_points := 0;
  END IF;
  
  -- Upsert answer
  INSERT INTO public.answers (
    session_id, question_id, student_answer, is_correct, points_earned, time_spent_seconds
  ) VALUES (
    p_session_id, p_question_id, p_answer, v_is_correct, v_points, p_time_spent
  )
  ON CONFLICT (session_id, question_id) DO UPDATE SET
    student_answer = EXCLUDED.student_answer,
    is_correct = EXCLUDED.is_correct,
    points_earned = EXCLUDED.points_earned,
    time_spent_seconds = answers.time_spent_seconds + EXCLUDED.time_spent_seconds,
    answered_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to submit exam
CREATE OR REPLACE FUNCTION public.submit_exam(
  p_session_id UUID,
  p_auto_submit BOOLEAN DEFAULT FALSE
)
RETURNS JSONB AS $$
DECLARE
  v_session RECORD;
  v_total_score NUMERIC(5,2);
  v_max_score NUMERIC(5,2);
  v_percentage NUMERIC(5,2);
  v_passed BOOLEAN;
  v_passing_score NUMERIC(5,2);
BEGIN
  -- Lock session
  SELECT es.*, e.passing_score INTO v_session
  FROM public.exam_sessions es
  JOIN public.exams e ON e.id = es.exam_id
  WHERE es.id = p_session_id
  FOR UPDATE OF es;
  
  IF NOT FOUND OR v_session.student_id != auth.uid() THEN
    RAISE EXCEPTION 'Invalid session';
  END IF;
  
  IF v_session.status != 'in_progress' THEN
    RAISE EXCEPTION 'Exam already submitted';
  END IF;
  
  -- Calculate scores
  SELECT 
    COALESCE(SUM(points_earned), 0),
    COALESCE(SUM(q.points), 0)
  INTO v_total_score, v_max_score
  FROM public.answers a
  JOIN public.questions q ON q.id = a.question_id
  WHERE a.session_id = p_session_id;
  
  v_percentage := CASE WHEN v_max_score > 0 THEN (v_total_score / v_max_score) * 100 ELSE 0 END;
  v_passed := v_percentage >= v_session.passing_score;
  
  -- Update session
  UPDATE public.exam_sessions SET
    submitted_at = NOW(),
    total_score = v_total_score,
    max_score = v_max_score,
    percentage = v_percentage,
    passed = v_passed,
    status = CASE WHEN p_auto_submit THEN 'auto_submitted' ELSE 'submitted' END
  WHERE id = p_session_id;
  
  RETURN jsonb_build_object(
    'total_score', v_total_score,
    'max_score', v_max_score,
    'percentage', v_percentage,
    'passed', v_passed
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================
-- SECTION 8: INDEXES FOR PERFORMANCE
-- ================================================

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON public.enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_class ON public.enrollments(class_id);
CREATE INDEX IF NOT EXISTS idx_exams_class ON public.exams(class_id);
CREATE INDEX IF NOT EXISTS idx_exams_status ON public.exams(status);
CREATE INDEX IF NOT EXISTS idx_questions_exam ON public.questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exam_student ON public.exam_sessions(exam_id, student_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON public.exam_sessions(status);
CREATE INDEX IF NOT EXISTS idx_answers_session ON public.answers(session_id);

-- ================================================
-- SECTION 9: UPDATED_AT TRIGGER
-- ================================================

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER set_classes_updated_at
  BEFORE UPDATE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER set_exams_updated_at
  BEFORE UPDATE ON public.exams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ================================================
-- SECTION 10: ADD STUDENT TO CLASS (RPC)
-- ================================================

-- Policy to allow instructors to search for students by email
CREATE POLICY "Instructors can search students by email"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
      AND p.role IN ('instructor', 'admin')
    )
  );

-- Function to find profile by email and add to class
CREATE OR REPLACE FUNCTION public.add_student_to_class(
  p_class_id UUID,
  p_student_email TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_student_id UUID;
  v_instructor_id UUID;
BEGIN
  -- Verify caller is the instructor of this class
  SELECT instructor_id INTO v_instructor_id
  FROM public.classes
  WHERE id = p_class_id;
  
  IF v_instructor_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'class_not_found');
  END IF;
  
  IF v_instructor_id != auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authorized');
  END IF;
  
  -- Find student by email
  SELECT id INTO v_student_id
  FROM public.profiles
  WHERE email = LOWER(TRIM(p_student_email));
  
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'student_not_found');
  END IF;
  
  -- Check if already enrolled
  IF EXISTS (
    SELECT 1 FROM public.enrollments
    WHERE class_id = p_class_id AND student_id = v_student_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_enrolled');
  END IF;
  
  -- Add enrollment
  INSERT INTO public.enrollments (class_id, student_id, status)
  VALUES (p_class_id, v_student_id, 'active');
  
  RETURN jsonb_build_object('success', true, 'student_id', v_student_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.add_student_to_class(UUID, TEXT) TO authenticated;

-- ================================================
-- SECTION 11: FACE VERIFICATION
-- ================================================

-- Add face_embedding column to profiles table
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
  verification_type TEXT NOT NULL CHECK (verification_type IN ('start', 'random', 'submit', 'triggered', 'enroll', 'verify')),
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

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.log_face_verification(UUID, TEXT, NUMERIC, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_face_embedding(JSONB, TEXT) TO authenticated;

-- ================================================
-- SECTION 12: STUDENT ANALYTICS
-- ================================================

-- Table for storing student performance analytics
CREATE TABLE IF NOT EXISTS public.student_analytics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  exam_id UUID REFERENCES public.exams(id) ON DELETE CASCADE NOT NULL,
  session_id UUID REFERENCES public.exam_sessions(id) ON DELETE CASCADE NOT NULL,
  -- Performance metrics
  total_questions INTEGER DEFAULT 0,
  correct_answers INTEGER DEFAULT 0,
  incorrect_answers INTEGER DEFAULT 0,
  skipped_answers INTEGER DEFAULT 0,
  -- Time analytics
  total_time_seconds INTEGER DEFAULT 0,
  avg_time_per_question NUMERIC(8,2) DEFAULT 0,
  fastest_question_time INTEGER,
  slowest_question_time INTEGER,
  -- Difficulty analysis
  easy_correct INTEGER DEFAULT 0,
  easy_total INTEGER DEFAULT 0,
  medium_correct INTEGER DEFAULT 0,
  medium_total INTEGER DEFAULT 0,
  hard_correct INTEGER DEFAULT 0,
  hard_total INTEGER DEFAULT 0,
  -- IRT estimated ability
  estimated_ability NUMERIC(5,3) DEFAULT 0,
  ability_std_error NUMERIC(5,3) DEFAULT 0.5,
  -- Integrity metrics
  integrity_score NUMERIC(5,2) DEFAULT 100,
  total_violations INTEGER DEFAULT 0,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(session_id)
);

-- Enable RLS
ALTER TABLE public.student_analytics ENABLE ROW LEVEL SECURITY;

-- Students can view own analytics
CREATE POLICY "Students can view own analytics"
  ON public.student_analytics FOR SELECT
  USING (student_id = auth.uid());

-- Instructors can view analytics for their exams
CREATE POLICY "Instructors can view analytics for own exams"
  ON public.student_analytics FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.exams e
      JOIN public.classes c ON c.id = e.class_id
      WHERE e.id = student_analytics.exam_id
      AND c.instructor_id = auth.uid()
    )
  );

-- System can insert/update analytics
CREATE POLICY "System can manage analytics"
  ON public.student_analytics FOR ALL
  USING (student_id = auth.uid());

-- Indexes
CREATE INDEX IF NOT EXISTS idx_analytics_student ON public.student_analytics(student_id);
CREATE INDEX IF NOT EXISTS idx_analytics_exam ON public.student_analytics(exam_id);
CREATE INDEX IF NOT EXISTS idx_analytics_session ON public.student_analytics(session_id);

-- Function to calculate and store analytics after exam submission
CREATE OR REPLACE FUNCTION public.calculate_exam_analytics(p_session_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_session RECORD;
  v_analytics RECORD;
  v_result JSONB;
BEGIN
  -- Get session info
  SELECT es.*, e.id as exam_id, e.duration_minutes
  INTO v_session
  FROM public.exam_sessions es
  JOIN public.exams e ON e.id = es.exam_id
  WHERE es.id = p_session_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;
  
  -- Calculate analytics
  WITH answer_stats AS (
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE a.is_correct = true) as correct,
      COUNT(*) FILTER (WHERE a.is_correct = false) as incorrect,
      COUNT(*) FILTER (WHERE a.student_answer IS NULL) as skipped,
      SUM(a.time_spent_seconds) as total_time,
      AVG(a.time_spent_seconds) as avg_time,
      MIN(a.time_spent_seconds) FILTER (WHERE a.time_spent_seconds > 0) as min_time,
      MAX(a.time_spent_seconds) as max_time,
      COUNT(*) FILTER (WHERE q.difficulty = 'easy' AND a.is_correct = true) as easy_correct,
      COUNT(*) FILTER (WHERE q.difficulty = 'easy') as easy_total,
      COUNT(*) FILTER (WHERE q.difficulty = 'medium' AND a.is_correct = true) as medium_correct,
      COUNT(*) FILTER (WHERE q.difficulty = 'medium') as medium_total,
      COUNT(*) FILTER (WHERE q.difficulty = 'hard' AND a.is_correct = true) as hard_correct,
      COUNT(*) FILTER (WHERE q.difficulty = 'hard') as hard_total
    FROM public.answers a
    JOIN public.questions q ON q.id = a.question_id
    WHERE a.session_id = p_session_id
  )
  SELECT * INTO v_analytics FROM answer_stats;
  
  -- Calculate integrity score (100 - penalties)
  DECLARE
    v_integrity NUMERIC(5,2) := 100;
  BEGIN
    v_integrity := v_integrity - (v_session.cheat_count * 10);
    v_integrity := v_integrity - (v_session.tab_violations * 5);
    v_integrity := v_integrity - (v_session.fullscreen_violations * 5);
    v_integrity := v_integrity - (v_session.gaze_away_count * 1);
    v_integrity := GREATEST(0, v_integrity);
  END;
  
  -- Insert or update analytics
  INSERT INTO public.student_analytics (
    student_id, exam_id, session_id,
    total_questions, correct_answers, incorrect_answers, skipped_answers,
    total_time_seconds, avg_time_per_question, fastest_question_time, slowest_question_time,
    easy_correct, easy_total, medium_correct, medium_total, hard_correct, hard_total,
    integrity_score, total_violations
  ) VALUES (
    v_session.student_id, v_session.exam_id, p_session_id,
    COALESCE(v_analytics.total, 0),
    COALESCE(v_analytics.correct, 0),
    COALESCE(v_analytics.incorrect, 0),
    COALESCE(v_analytics.skipped, 0),
    COALESCE(v_analytics.total_time, 0),
    COALESCE(v_analytics.avg_time, 0),
    v_analytics.min_time,
    v_analytics.max_time,
    COALESCE(v_analytics.easy_correct, 0),
    COALESCE(v_analytics.easy_total, 0),
    COALESCE(v_analytics.medium_correct, 0),
    COALESCE(v_analytics.medium_total, 0),
    COALESCE(v_analytics.hard_correct, 0),
    COALESCE(v_analytics.hard_total, 0),
    100 - (COALESCE(v_session.cheat_count, 0) * 10 + COALESCE(v_session.tab_violations, 0) * 5 + COALESCE(v_session.fullscreen_violations, 0) * 5 + COALESCE(v_session.gaze_away_count, 0)),
    COALESCE(v_session.cheat_count, 0) + COALESCE(v_session.tab_violations, 0) + COALESCE(v_session.fullscreen_violations, 0)
  )
  ON CONFLICT (session_id) DO UPDATE SET
    correct_answers = EXCLUDED.correct_answers,
    incorrect_answers = EXCLUDED.incorrect_answers,
    skipped_answers = EXCLUDED.skipped_answers,
    total_time_seconds = EXCLUDED.total_time_seconds,
    avg_time_per_question = EXCLUDED.avg_time_per_question,
    integrity_score = EXCLUDED.integrity_score,
    total_violations = EXCLUDED.total_violations,
    updated_at = NOW();
  
  RETURN jsonb_build_object(
    'success', true,
    'total_questions', COALESCE(v_analytics.total, 0),
    'correct_answers', COALESCE(v_analytics.correct, 0),
    'accuracy', CASE WHEN COALESCE(v_analytics.total, 0) > 0 
      THEN ROUND((COALESCE(v_analytics.correct, 0)::NUMERIC / v_analytics.total) * 100, 2) 
      ELSE 0 END
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.calculate_exam_analytics(UUID) TO authenticated;
