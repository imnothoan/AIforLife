# 🎯 SMART EXAM PLATFORM - PRODUCTION READINESS CHECKLIST

## ✅ TÓM TẮT TRẠNG THÁI

| Chức năng | Trạng thái | Ghi chú |
|-----------|------------|---------|
| Authentication | ✅ Hoàn thành | Login/Register với Supabase Auth |
| Quản lý lớp học | ✅ Hoàn thành | CRUD classes, add students |
| Quản lý bài thi | ✅ Hoàn thành | Create exam, manage questions |
| Giao diện thi | ✅ Hoàn thành | Fullscreen, timer, navigation |
| Anti-cheat cơ bản | ✅ Hoàn thành | Tab switch, fullscreen exit, keyboard |
| Face Detection | ✅ Hoàn thành | MediaPipe Face Landmarker |
| Face Verification | ✅ Hoàn thành | Chống thi hộ với face embedding |
| YOLO Object Detection | ⚠️ Cần model | Cần đặt model ONNX vào public/models |
| i18n | ✅ Hoàn thành | Tiếng Việt + English |
| Auto-save | ✅ Hoàn thành | Lưu câu trả lời mỗi 30s |
| Session Recovery | ✅ Hoàn thành | Khôi phục phiên thi khi mất kết nối |

---

## 📋 CHECKLIST TRƯỚC KHI DEPLOYMENT

### 1. Database Setup (Supabase)

```sql
-- Run các file SQL theo thứ tự:
1. database/smart_exam_schema.sql        -- Schema chính
2. database/face_verification_schema.sql -- Face verification
3. database/fix_add_student_rpc.sql      -- RPC function cho thêm sinh viên
```

### 2. Environment Variables

Tạo file `.env` trong thư mục `Intelligence-Test/` (xem `.env.example` làm mẫu):

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. YOLO Model Setup

1. Chuẩn bị dataset training với các class: person, phone, material, headphones
   - Sử dụng các công cụ như Roboflow hoặc LabelImg để annotate
   - Đảm bảo có đủ ảnh (ít nhất 100 ảnh/class)
2. Train model YOLO:
   ```bash
   yolo train data=anticheat.yaml model=yolo11s.pt epochs=100 imgsz=640
   ```
3. Export model sang format ONNX:
   ```bash
   yolo export model=anticheat_yolo11s.pt format=onnx opset=12 simplify=True
   ```
4. Copy file `anticheat_yolo11s.onnx` vào `Intelligence-Test/public/models/`

### 4. Build & Deploy

```bash
cd Intelligence-Test
npm install
npm run build
# Deploy thư mục dist/ lên hosting (Vercel, Netlify, etc.)
```

---

## 🔒 HỆ THỐNG ANTI-CHEAT

### Các lớp bảo vệ:

#### 1. **Tab/Window Violations**
- Detect khi thí sinh rời khỏi tab
- Đếm số lần vi phạm và lưu vào database

#### 2. **Fullscreen Enforcement**
- Bắt buộc fullscreen khi thi
- Cảnh báo và đếm khi thoát fullscreen

#### 3. **Keyboard Shortcuts Prevention**
- Block: Ctrl+C, Ctrl+V, Ctrl+P, F12, PrintScreen, Alt+Tab
- Log tất cả các lần cố gắng

#### 4. **Right-click Prevention**
- Vô hiệu hóa context menu

#### 5. **Multi-screen Detection**
- Phát hiện và block khi có 2+ màn hình

#### 6. **Remote Desktop Detection**
- Phát hiện TeamViewer, AnyDesk, VNC, etc.
- Kiểm tra WebGL renderer để phát hiện VM

#### 7. **MediaPipe Face Detection** (Running every 200ms)
- Phát hiện không có mặt trong frame
- Phát hiện nhìn đi chỗ khác (yaw/pitch thresholds)
- Đếm số frames liên tục để tránh false positive

#### 8. **YOLO Object Detection** (Running every 500ms)
- Phát hiện điện thoại (phone)
- Phát hiện tài liệu (material)
- Phát hiện tai nghe (headphones)
- **Yêu cầu**: Đặt model ONNX vào public/models/

#### 9. **Face Verification - Chống thi hộ**
- Enroll khuôn mặt trước khi bắt đầu thi
- Verify identity trước khi vào phòng thi
- Random verification 2-3 lần trong bài thi
- Cosine similarity threshold: 0.6

---

## 🔍 CHI TIẾT TECHNICAL

### MediaPipe Face Landmarker

```javascript
// Khả năng:
- Phát hiện 478 điểm landmark (468 face mesh + 10 iris)
- Estimate head pose từ transformation matrix
- Chạy trên GPU với WASM fallback

// Thresholds (configurable in ai.worker.js):
YAW_THRESHOLD: 0.25   // Ngưỡng quay trái/phải
PITCH_THRESHOLD: 0.20 // Ngưỡng ngẩng/cúi
CONSECUTIVE_FRAMES: 5 // Số frame liên tục trước khi alert
```

### YOLO Object Detection

```javascript
// Config (configurable in ai.worker.js CONFIG.YOLO):
MODEL_PATH: '/models/anticheat_yolo11s.onnx'  // Có thể đổi tên model
INPUT_SIZE: 640                               // Phụ thuộc vào model training
CONFIDENCE_THRESHOLD: 0.4                     // Điều chỉnh để giảm false positive
IOU_THRESHOLD: 0.45
CLASSES: ['person', 'phone', 'material', 'headphones']
ALERT_CLASSES: ['phone', 'material', 'headphones']
```

### Face Verification

```javascript
// Algorithm:
1. Extract 478 landmarks từ MediaPipe
2. Chọn ~60 key points quan trọng (mắt, mũi, miệng, viền mặt)
3. Tính toán inter-landmark distances
4. Tạo embedding vector (~180 dimensions)
5. So sánh bằng cosine similarity

// Storage:
- face_embedding: JSONB array trong profiles table
- face_image_url: URL ảnh đã enroll
- face_enrolled_at: Timestamp
```

---

## 📊 QUY TRÌNH THI

### Trước khi thi:
1. Thí sinh đăng nhập
2. Chọn bài thi từ dashboard
3. Đọc và đồng ý quy chế thi
4. Enroll/verify khuôn mặt (nếu chưa có)
5. Vào fullscreen

### Trong khi thi:
1. Timer đếm ngược
2. AI giám sát liên tục (MediaPipe + YOLO)
3. Auto-save mỗi 30 giây
4. Random face verification 2-3 lần
5. Đếm vi phạm realtime

### Khi nộp bài:
1. Kiểm tra câu chưa trả lời
2. Confirm submission
3. Lưu answers + violation counts
4. Tính điểm (nếu có đáp án)
5. Thoát fullscreen và redirect

---

## ⚠️ CÒN CẦN LÀM TRƯỚC PRODUCTION

1. **[CRITICAL]** Đặt YOLO model vào `public/models/anticheat_yolo11s.onnx`
2. **[CRITICAL]** Chạy SQL migrations trên Supabase production
3. **[HIGH]** Test với nhiều browser (Chrome, Firefox, Edge)
4. **[HIGH]** Test với camera khác nhau
5. **[MEDIUM]** Thêm admin dashboard để quản lý violations
6. **[LOW]** Thêm export kết quả thi ra Excel

---

## 🚀 COMMANDS

```bash
# Development
npm run dev

# Build
npm run build

# Preview production build
npm run preview

# Lint
npm run lint
```

---

## 📞 LIÊN HỆ HỖ TRỢ

Nếu có vấn đề với hệ thống, kiểm tra:
1. Console browser (F12 → Console)
2. Network tab để xem API calls
3. Supabase logs trong dashboard

---

**Trạng thái**: Sẵn sàng cho production sau khi thêm YOLO model! ✅
