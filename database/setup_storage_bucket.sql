-- ================================================================
-- SUPABASE STORAGE BUCKET SETUP FOR PROCTORING EVIDENCE
-- ================================================================
-- This script sets up the storage bucket for proctoring evidence screenshots
-- Run this in Supabase SQL Editor or via Supabase Dashboard > Storage

-- ================================================
-- STEP 1: Create Storage Bucket (via Supabase Dashboard > Storage)
-- ================================================
-- Bucket name: proctoring-evidence
-- Public: No (instructors only should access)
-- File size limit: 5MB per file
-- Allowed MIME types: image/jpeg, image/png

-- ================================================
-- STEP 2: Set up RLS policies for the bucket
-- ================================================
-- Note: Storage policies are managed separately from table policies
-- These need to be created via Supabase Dashboard > Storage > proctoring-evidence > Policies

-- Policy 1: Students can INSERT evidence during their own exam
-- Name: "Students can upload evidence during exam"
-- Target roles: authenticated
-- Operation: INSERT
-- WITH CHECK:
--   (auth.uid() IN (
--     SELECT student_id FROM exam_sessions 
--     WHERE id = (storage.foldername(name))[1]::uuid
--     AND status = 'in_progress'
--   ))

-- Policy 2: Instructors can SELECT evidence from their own exams
-- Name: "Instructors can view evidence from their exams"  
-- Target roles: authenticated
-- Operation: SELECT
-- USING:
--   (
--     (auth.jwt() ->> 'role')::text IN ('instructor', 'admin')
--     OR (auth.jwt() -> 'user_metadata' ->> 'role')::text IN ('instructor', 'admin')
--   )
--   AND EXISTS (
--     SELECT 1 FROM exam_sessions es
--     JOIN exams e ON e.id = es.exam_id
--     JOIN classes c ON c.id = e.class_id
--     WHERE es.id = (storage.foldername(name))[1]::uuid
--     AND c.instructor_id = auth.uid()
--   )

-- ================================================
-- ALTERNATIVE: Create bucket programmatically (if using Supabase CLI)
-- ================================================
-- Run this if you're using Supabase CLI and want to automate bucket creation:
--
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES (
--   'proctoring-evidence',
--   'proctoring-evidence', 
--   false,
--   5242880, -- 5MB in bytes
--   ARRAY['image/jpeg', 'image/png']
-- )
-- ON CONFLICT (id) DO NOTHING;

-- ================================================
-- VERIFICATION QUERIES
-- ================================================
-- Check if bucket exists:
-- SELECT * FROM storage.buckets WHERE id = 'proctoring-evidence';

-- Check bucket policies:
-- SELECT * FROM storage.policies WHERE bucket_id = 'proctoring-evidence';

-- Test upload (from application code):
-- const { data, error } = await supabase.storage
--   .from('proctoring-evidence')
--   .upload('test.jpg', file);

-- ================================================
-- CLEANUP (if needed)
-- ================================================
-- To remove all files and the bucket:
-- DELETE FROM storage.objects WHERE bucket_id = 'proctoring-evidence';
-- DELETE FROM storage.buckets WHERE id = 'proctoring-evidence';
