-- ============================================
-- FIX ADD STUDENT RPC
-- Allows instructors to add students to their classes
-- using email lookup with SECURITY DEFINER
-- ============================================

-- 1. Add policy to allow instructors to search for students by email
-- This is needed for the direct method fallback
CREATE POLICY IF NOT EXISTS "Instructors can search students by email"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
      AND p.role IN ('instructor', 'admin')
    )
  );

-- 2. Function to find profile by email and add to class
-- This bypasses RLS to allow instructors to find students
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
