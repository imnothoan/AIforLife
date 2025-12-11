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

CREATE POLICY "Instructors can manage own classes"
  ON public.classes FOR ALL
  USING (instructor_id = auth.uid());

-- ENROLLMENTS POLICIES
CREATE POLICY "Students can view own enrollments"
  ON public.enrollments FOR SELECT
  USING (student_id = auth.uid());

CREATE POLICY "Instructors can manage class enrollments"
  ON public.enrollments FOR ALL
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

CREATE POLICY "Instructors can manage exams for own classes"
  ON public.exams FOR ALL
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

CREATE POLICY "Instructors can manage questions for own exams"
  ON public.questions FOR ALL
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
