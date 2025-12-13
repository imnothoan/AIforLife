# 🔧 HƯỚNG DẪN SỬA LỖI: Không thể tạo lớp học mới

## 🐛 Vấn đề

**Triệu chứng**: Instructor không thể tạo lớp học mới - nhận lỗi "permission denied" hoặc form submit không thành công.

**Nguyên nhân**: RLS (Row Level Security) policies ban đầu sử dụng `FOR ALL` với chỉ `USING` clause, không có `WITH CHECK` clause - đây là yêu cầu bắt buộc cho INSERT operations trong PostgreSQL.

## ✅ Giải pháp

Chạy file migration sau trong Supabase SQL Editor:

```
database/migrations/008_fix_classes_rls_policy.sql
```

Hoặc copy và paste trực tiếp nội dung bên dưới:

---

## 📜 Script Fix RLS Policies

```sql
-- ================================================================
-- MIGRATION 008: Fix Classes RLS Policy for INSERT
-- ================================================================
-- Problem: The current "Instructors can manage own classes" policy 
-- uses USING clause only, which doesn't work for INSERT operations.
-- INSERT requires WITH CHECK clause.
--
-- Solution: Drop the old ALL policy and create separate policies for
-- SELECT, INSERT, UPDATE, DELETE with proper clauses.
-- ================================================================

-- Drop the problematic policy
DROP POLICY IF EXISTS "Instructors can manage own classes" ON public.classes;

-- Create separate policies with proper clauses

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

-- ================================================================
-- Also fix the exams table RLS policy for the same issue
-- ================================================================

DROP POLICY IF EXISTS "Instructors can manage exams for own classes" ON public.exams;

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

-- ================================================================
-- Fix enrollments RLS policy for INSERT
-- ================================================================

DROP POLICY IF EXISTS "Instructors can manage class enrollments" ON public.enrollments;

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

-- ================================================================
-- Fix questions RLS policy for INSERT
-- ================================================================

DROP POLICY IF EXISTS "Instructors can manage questions for own exams" ON public.questions;

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
```

---

## 🚀 Cách thực hiện

### Bước 1: Truy cập Supabase Dashboard
1. Đăng nhập vào https://supabase.com
2. Chọn project của bạn
3. Vào **SQL Editor** (thanh bên trái)

### Bước 2: Chạy migration script
1. Copy toàn bộ SQL script ở trên
2. Paste vào SQL Editor
3. Click **Run** hoặc nhấn Ctrl+Enter

### Bước 3: Xác nhận thành công
Nếu thành công, bạn sẽ thấy message: `Success. No rows returned`

### Bước 4: Kiểm tra policies đã được tạo
```sql
SELECT policyname, tablename, cmd 
FROM pg_policies 
WHERE tablename IN ('classes', 'exams', 'enrollments', 'questions')
ORDER BY tablename, policyname;
```

**Kết quả mong đợi**: Khoảng 15-20 policies mới được liệt kê.

---

## 🧪 Kiểm tra lại chức năng

Sau khi chạy migration:

1. **Đăng nhập** với tài khoản instructor
2. **Thử tạo lớp học mới**
3. **Thử tạo bài thi mới** trong lớp đó
4. **Thử thêm sinh viên** vào lớp

Nếu tất cả hoạt động → ✅ Fix thành công!

---

## ⚠️ Troubleshooting

### Vẫn không tạo được lớp?

**Kiểm tra role của user:**
```sql
SELECT id, email, role FROM public.profiles WHERE email = 'your-email@example.com';
```

Role phải là `instructor` hoặc `admin`.

**Cập nhật role nếu cần:**
```sql
UPDATE public.profiles 
SET role = 'instructor' 
WHERE email = 'your-email@example.com';
```

### Lỗi "duplicate policy"?

Chạy script dọn dẹp trước:
```sql
DROP POLICY IF EXISTS "Instructors can view own classes" ON public.classes;
DROP POLICY IF EXISTS "Instructors can create classes" ON public.classes;
DROP POLICY IF EXISTS "Instructors can update own classes" ON public.classes;
DROP POLICY IF EXISTS "Instructors can delete own classes" ON public.classes;
-- ... tương tự cho các tables khác
```

Sau đó chạy lại migration script.

---

## 📅 Cập nhật

- **Version**: 1.0.0
- **Ngày**: 2025-12-13
- **Tác giả**: SmartExamPro Team
