-- ================================================================
-- STORAGE BUCKET POLICIES FOR PROCTORING EVIDENCE
-- ================================================================
-- Run this in Supabase SQL Editor to create the bucket and policies
-- This allows students to upload evidence screenshots during exams

-- Create the proctoring-evidence bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'proctoring-evidence',
  'proctoring-evidence', 
  false,  -- Not public - only accessible via authenticated requests
  5242880, -- 5MB max file size
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Enable RLS on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Policy: Students can upload evidence screenshots for their own exam sessions
DROP POLICY IF EXISTS "Students can upload proctoring evidence" ON storage.objects;
CREATE POLICY "Students can upload proctoring evidence"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'proctoring-evidence' AND
  auth.role() = 'authenticated' AND
  -- File path should start with user's session ID or user ID
  (
    -- Check if user has an active exam session
    EXISTS (
      SELECT 1 FROM public.exam_sessions es
      WHERE es.student_id = auth.uid()
      AND es.status = 'in_progress'
    )
  )
);

-- Policy: Students can view their own evidence
DROP POLICY IF EXISTS "Students can view own evidence" ON storage.objects;
CREATE POLICY "Students can view own evidence"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'proctoring-evidence' AND
  auth.role() = 'authenticated' AND
  -- Allow if student owns a session that this evidence belongs to
  EXISTS (
    SELECT 1 FROM public.exam_sessions es
    WHERE es.student_id = auth.uid()
    AND name LIKE es.id::text || '%'
  )
);

-- Policy: Instructors can view evidence for their exams
DROP POLICY IF EXISTS "Instructors can view exam evidence" ON storage.objects;
CREATE POLICY "Instructors can view exam evidence"
ON storage.objects FOR SELECT  
USING (
  bucket_id = 'proctoring-evidence' AND
  auth.role() = 'authenticated' AND
  EXISTS (
    SELECT 1 FROM public.exam_sessions es
    JOIN public.exams e ON e.id = es.exam_id
    JOIN public.classes c ON c.id = e.class_id
    WHERE c.instructor_id = auth.uid()
    AND name LIKE es.id::text || '%'
  )
);

-- Policy: Instructors can delete evidence for their exams
DROP POLICY IF EXISTS "Instructors can delete exam evidence" ON storage.objects;
CREATE POLICY "Instructors can delete exam evidence"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'proctoring-evidence' AND
  auth.role() = 'authenticated' AND
  EXISTS (
    SELECT 1 FROM public.exam_sessions es
    JOIN public.exams e ON e.id = es.exam_id
    JOIN public.classes c ON c.id = e.class_id
    WHERE c.instructor_id = auth.uid()
    AND name LIKE es.id::text || '%'
  )
);
