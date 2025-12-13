# 🎓 SmartExamPro - Nền Tảng Khảo Thí Thông Minh

## Hướng Dẫn Triển Khai & Sử Dụng

---

## 📋 Mục lục

1. [Tổng quan hệ thống](#tổng-quan-hệ-thống)
2. [Yêu cầu triển khai](#yêu-cầu-triển-khai)
3. [Cài đặt Database (Supabase)](#cài-đặt-database)
4. [Cấu hình Backend Server](#cấu-hình-backend-server)
5. [Cấu hình Frontend](#cấu-hình-frontend)
6. [Hướng dẫn sử dụng](#hướng-dẫn-sử-dụng)
7. [Checklist trước kỳ thi](#checklist-trước-kỳ-thi)
8. [Troubleshooting](#troubleshooting)

---

## 🏗️ Tổng quan hệ thống

SmartExamPro là nền tảng khảo thí thông minh với các tính năng:

### ✅ Tính năng chính

| Tính năng | Mô tả |
|-----------|-------|
| **Quản lý lớp học** | Tạo/xóa/sửa lớp học, thêm sinh viên |
| **Quản lý bài thi** | Tạo bài thi với nhiều loại câu hỏi |
| **Chống gian lận** | AI phát hiện khuôn mặt, vật thể lạ |
| **Giám sát thời gian thực** | Camera, phát hiện rời tab, fullscreen |
| **Tự động chấm điểm** | Chấm tức thì cho câu hỏi trắc nghiệm |
| **Báo cáo chi tiết** | Thống kê vi phạm, điểm số |

### 🔒 Tính năng bảo mật

- Row Level Security (RLS) trên tất cả bảng
- Xác thực JWT Token
- Rate Limiting
- Input validation với Zod
- Chống SQL Injection, XSS
- Phát hiện Remote Desktop / TeamViewer

---

## 📦 Yêu cầu triển khai

### Dịch vụ bắt buộc

1. **Supabase Account** (miễn phí): https://supabase.com
2. **Node.js 18+** cho backend
3. **Hosting** cho frontend (Vercel, Netlify, Firebase)
4. **Hosting** cho backend (Railway, Render, Fly.io)

### Tùy chọn

- **Google Gemini API** cho tạo câu hỏi AI
- **Custom YOLO Model** cho phát hiện vật thể

---

## 🗄️ Cài đặt Database

### Bước 1: Tạo project Supabase

1. Đăng nhập https://supabase.com
2. Click "New Project"
3. Đặt tên, chọn region gần Việt Nam (Singapore)
4. Lưu lại:
   - `SUPABASE_URL`
   - `ANON_KEY` (public)
   - `SERVICE_ROLE_KEY` (secret - chỉ dùng cho backend)

### Bước 2: Chạy schema chính

1. Vào **SQL Editor**
2. Copy nội dung file `database/smart_exam_schema.sql`
3. Paste và chạy

### Bước 3: Chạy migration fix RLS ⚠️ QUAN TRỌNG

> **Lưu ý**: Bước này bắt buộc để tạo được lớp học!

1. Vào **SQL Editor**
2. Copy nội dung file `database/migrations/008_fix_classes_rls_policy.sql`
3. Paste và chạy

Hoặc xem chi tiết tại: `database/FIX_CREATE_CLASS_ERROR.md`

### Bước 4: Xác minh

```sql
-- Kiểm tra bảng
SELECT tablename FROM pg_tables WHERE schemaname = 'public';

-- Kiểm tra policies
SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public';
```

---

## ⚙️ Cấu hình Backend Server

### Bước 1: Cài đặt dependencies

```bash
cd Intelligence-Test-Server
npm install
```

### Bước 2: Tạo file `.env`

```bash
# Server Configuration
PORT=3000

# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key-here

# Google Gemini AI API Key (optional)
GEMINI_API_KEY=your-gemini-api-key-here

# Frontend URL for CORS
FRONTEND_URL=https://your-frontend-domain.com
NODE_ENV=production
```

### Bước 3: Chạy server

```bash
# Development
npm run dev

# Production
npm start
```

### Bước 4: Kiểm tra

```bash
curl http://localhost:3000/health
# Expected: {"status":"healthy","services":{"database":true,"ai":true}}
```

---

## 🖥️ Cấu hình Frontend

### Bước 1: Cài đặt dependencies

```bash
cd Intelligence-Test
npm install
```

### Bước 2: Tạo file `.env`

```bash
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

# API Server URL
VITE_API_URL=https://your-backend-domain.com
```

### Bước 3: Build & Deploy

```bash
# Development
npm run dev

# Production build
npm run build
npm run preview
```

### Bước 4: Deploy lên hosting

**Vercel:**
```bash
npx vercel
```

**Netlify:**
```bash
npm run build
# Upload thư mục dist/
```

---

## 📖 Hướng dẫn sử dụng

### 👨‍🏫 Dành cho Giảng viên (Instructor)

#### 1. Đăng ký tài khoản Instructor

1. Truy cập trang đăng nhập
2. Click "Đăng ký"
3. Chọn vai trò **Giảng viên**
4. Điền thông tin và submit

#### 2. Tạo lớp học

1. Đăng nhập vào hệ thống
2. Click nút **+ Tạo lớp học** (góc trên sidebar)
3. Điền thông tin:
   - Tên lớp: VD "Trí tuệ nhân tạo K66"
   - Mã lớp: VD "INT3401-20241" (duy nhất)
   - Học kỳ, Năm học
4. Submit

#### 3. Thêm sinh viên

1. Chọn lớp từ sidebar
2. Chuyển tab "Sinh viên"
3. Click **+ Thêm sinh viên**
4. Nhập email sinh viên (phải đã đăng ký tài khoản)
5. Hoặc thêm nhiều sinh viên (mỗi email 1 dòng)

#### 4. Tạo bài thi

1. Chọn lớp học
2. Chuyển tab "Bài thi"
3. Click **+ Tạo bài thi mới**
4. Điền thông tin:
   - Tên bài thi
   - Thời lượng (phút)
   - Thời gian bắt đầu/kết thúc
   - Cài đặt chống gian lận
5. Submit → Bài thi ở trạng thái "Nháp"

#### 5. Thêm câu hỏi (Sử dụng SQL hoặc Admin UI)

```sql
INSERT INTO public.questions (exam_id, question_text, question_type, options, correct_answer, points)
VALUES (
  'exam-uuid-here',
  'Deep Learning là gì?',
  'multiple_choice',
  '[{"id":"A","text":"Mạng nơ-ron sâu"},{"id":"B","text":"Phần mềm"},{"id":"C","text":"Thuật toán sắp xếp"},{"id":"D","text":"Ngôn ngữ lập trình"}]',
  '"A"',
  2
);
```

#### 6. Công bố bài thi

1. Trong danh sách bài thi, click nút **Công bố**
2. Sinh viên đã đăng ký lớp sẽ thấy bài thi

---

### 👨‍🎓 Dành cho Sinh viên

#### 1. Đăng ký tài khoản

1. Truy cập trang đăng nhập
2. Click "Đăng ký"
3. Chọn vai trò **Thí sinh**
4. Điền thông tin và MSSV (tùy chọn)

#### 2. Được thêm vào lớp

Giảng viên sẽ thêm email của bạn vào lớp học.

#### 3. Làm bài thi

1. Đăng nhập
2. Xem danh sách bài thi khả dụng
3. Click **Vào phòng thi**
4. Đồng ý quy định và bật camera
5. Làm bài trong fullscreen
6. Nộp bài khi hoàn thành

---

## ✅ Checklist trước kỳ thi

### Database

- [ ] Schema đã được deploy
- [ ] RLS policies đã được fix (migration 008)
- [ ] Tài khoản instructor đã có role đúng
- [ ] Test tạo lớp học thành công
- [ ] Test tạo bài thi thành công
- [ ] Test thêm sinh viên thành công

### Backend Server

- [ ] Server đang chạy và healthy
- [ ] Supabase credentials đúng
- [ ] CORS configured cho frontend domain
- [ ] Rate limiting hoạt động

### Frontend

- [ ] Build production không lỗi
- [ ] Deploy lên hosting thành công
- [ ] Supabase URL và key đúng
- [ ] API URL đúng

### Trước giờ thi

- [ ] Bài thi đã công bố (status: published)
- [ ] Thời gian start_time/end_time chính xác
- [ ] Tất cả sinh viên đã được thêm vào lớp
- [ ] Sinh viên đã được hướng dẫn sử dụng hệ thống
- [ ] Test 1-2 bài thi mẫu với tài khoản test

### Môi trường thi

- [ ] Sinh viên có camera hoạt động
- [ ] Sinh viên sử dụng Chrome/Edge (khuyến nghị)
- [ ] Kết nối mạng ổn định
- [ ] Không dùng nhiều màn hình

---

## 🔧 Troubleshooting

### Vấn đề: Không tạo được lớp học

**Nguyên nhân**: RLS policy chưa được fix

**Giải pháp**:
1. Chạy `database/migrations/008_fix_classes_rls_policy.sql`
2. Hoặc xem chi tiết: `database/FIX_CREATE_CLASS_ERROR.md`

### Vấn đề: "Email not confirmed"

**Giải pháp 1**: Dùng backend để đăng ký (auto-confirm)

**Giải pháp 2**: Confirm thủ công trong Supabase:
```sql
UPDATE auth.users SET email_confirmed_at = NOW() WHERE email = 'user@example.com';
```

### Vấn đề: Camera không hoạt động

**Giải pháp**:
1. Kiểm tra quyền camera trong trình duyệt
2. Dùng Chrome/Edge (Safari có thể có vấn đề)
3. Kiểm tra camera có bị ứng dụng khác chiếm không

### Vấn đề: Không thấy bài thi

**Kiểm tra**:
1. Bài thi đã được **công bố** (published) chưa?
2. Sinh viên đã được **thêm vào lớp** chưa?
3. Thời gian thi đã **bắt đầu** chưa?

### Vấn đề: Lỗi kết nối

**Giải pháp**:
1. Kiểm tra `.env` có đúng URL/Key không
2. Kiểm tra CORS settings trên backend
3. Kiểm tra RLS policies trên Supabase

---

## 📊 Đánh giá sẵn sàng cho kỳ thi thực

### ✅ Đã hoàn thành

| Thành phần | Trạng thái |
|------------|------------|
| Xác thực người dùng | ✅ Hoàn thành |
| Quản lý lớp học | ✅ Hoàn thành (sau fix RLS) |
| Quản lý bài thi | ✅ Hoàn thành |
| Quản lý sinh viên | ✅ Hoàn thành |
| Giao diện làm bài | ✅ Hoàn thành |
| Timer & Auto-submit | ✅ Hoàn thành |
| Anti-cheat cơ bản | ✅ Hoàn thành |
| AI Face Detection | ✅ Hoàn thành |
| Tab/Fullscreen monitoring | ✅ Hoàn thành |
| Auto-save answers | ✅ Hoàn thành |
| Chấm điểm tự động | ✅ Hoàn thành |
| UI/UX responsive | ✅ Hoàn thành |
| Error handling | ✅ Hoàn thành |
| Rate limiting | ✅ Hoàn thành |
| RLS security | ✅ Hoàn thành |

### ⚠️ Khuyến nghị trước production

1. **Load testing**: Test với số lượng sinh viên dự kiến
2. **Backup**: Bật automated backups trên Supabase
3. **Monitoring**: Setup alerts cho server errors
4. **Documentation**: Hướng dẫn cho sinh viên

### 🏁 Kết luận

**Hệ thống SẴN SÀNG để triển khai cho kỳ thi thực** sau khi:

1. ✅ Chạy migration fix RLS
2. ✅ Cấu hình đúng môi trường
3. ✅ Test đầy đủ các chức năng
4. ✅ Hướng dẫn người dùng

---

**Version**: 2.0.0  
**Cập nhật**: 2025-12-13  
**Tác giả**: SmartExamPro Team
