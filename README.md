
# SmartExamPro - Nền tảng khảo thí thông minh

## Tổng quan (Overview)

**SmartExamPro** là nền tảng khảo thí thông minh tích hợp AI, được thiết kế để quản lý và giám sát các kỳ thi trực tuyến với khả năng chống gian lận tiên tiến. Hệ thống sử dụng kiến trúc Hybrid Anti-Cheat (MediaPipe Face Mesh + YOLO) và hỗ trợ thi thích ứng (CAT) với mô hình IRT 3PL.

## Tính năng chính (Key Features)

### 1. Hệ thống chống gian lận lai (Hybrid Anti-Cheat)
- **Phát hiện khuôn mặt (MediaPipe Face Mesh)**: Theo dõi hướng nhìn (pitch/yaw) để phát hiện hành vi nhìn ra ngoài
- **Phát hiện vật thể (YOLO11)**: Nhận diện điện thoại, tài liệu, tai nghe và người lạ
- **Cascade Detection**: MediaPipe luôn chạy, YOLO chỉ kích hoạt khi phát hiện nghi vấn (tiết kiệm tài nguyên)
- **Phát hiện màn hình phụ**: Sử dụng Window Placement API để phát hiện HDMI/Projector
- **Phát hiện phần mềm điều khiển từ xa**: TeamViewer, AnyDesk, UltraViewer...
- **Phát hiện máy ảo**: VMware, VirtualBox, Hyper-V thông qua WebGL renderer

### 2. Quản lý thi (Exam Management)
- **Tạo lớp học và bài thi**: Giao diện trực quan cho giảng viên
- **Thêm sinh viên vào lớp**: Hỗ trợ thêm đơn lẻ hoặc hàng loạt
- **Cấu hình chống gian lận**: Tùy chỉnh số lần vi phạm tối đa
- **Xáo trộn câu hỏi**: Ngẫu nhiên hóa thứ tự câu hỏi cho mỗi thí sinh

### 3. Trải nghiệm thí sinh (Student Experience)
- **Gắn cờ câu hỏi**: Đánh dấu câu hỏi để xem lại sau
- **Ghi chú nháp**: Ô văn bản riêng cho mỗi câu hỏi
- **Điều hướng câu hỏi**: Xem tổng quan và nhảy đến câu bất kỳ
- **Đếm ngược thời gian**: Cảnh báo khi còn 5 phút và 1 phút
- **Tự động nộp bài**: Khi hết giờ

### 4. Giám sát thời gian thực (Real-time Monitoring)
- **Camera giám sát**: Hiển thị video trực tiếp
- **Thống kê vi phạm**: Số lần rời tab, thoát fullscreen, AI phát hiện
- **Proctoring logs**: Ghi lại mọi sự kiện nghi vấn

### 5. Sinh câu hỏi AI (AI Question Generation)
- **Tích hợp Google Gemini**: Tự động tạo câu hỏi trắc nghiệm
- **Hỗ trợ đa độ khó**: Dễ, trung bình, khó
- **Đa ngôn ngữ**: Tiếng Việt và tiếng Anh

## Tech Stack

### Frontend
- **React 18** + Vite
- **TailwindCSS** với hệ thống màu semantic
- **Framer Motion** cho animations
- **Lucide React** icons
- **ONNX Runtime Web** cho AI inference
- **MediaPipe Tasks Vision** cho face detection
- **Zod** cho validation

### Backend
- **Node.js** + Express
- **Supabase** (PostgreSQL + Auth)
- **Google Gemini AI**
- Rate limiting & CORS

### AI/ML
- **MediaPipe Face Landmarker**: Phát hiện khuôn mặt và hướng nhìn
- **YOLO11 (ONNX)**: Phát hiện vật thể (phone, book, headphones)
- **Cascade Architecture**: Tối ưu hiệu năng

## Cài đặt (Installation)

### Yêu cầu
- Node.js v18+
- Supabase Project
- (Optional) Google Gemini API Key

### 1. Cấu hình Database

```sql
-- Chạy file database/smart_exam_schema.sql trong Supabase SQL Editor
```

### 2. Backend Setup

```bash
cd Intelligence-Test-Server
npm install

# Tạo file .env từ template
cp .env.example .env

# Cấu hình các biến môi trường trong .env
# - SUPABASE_URL
# - SUPABASE_SERVICE_KEY  
# - GEMINI_API_KEY

npm run dev
```

### 3. Frontend Setup

```bash
cd Intelligence-Test
npm install

# Tạo file .env từ template
cp .env.example .env

# Cấu hình các biến môi trường trong .env
# - VITE_SUPABASE_URL
# - VITE_SUPABASE_ANON_KEY
# - VITE_API_URL

npm run dev
```

### 4. (Optional) YOLO Model

Đặt file ONNX model vào `Intelligence-Test/public/models/`:
- `anticheat_yolo11s.onnx` - Object detection model

Để train model, sử dụng notebook: `Intelligence_Test_YOLO_Training_colab.ipynb`

## Cấu trúc thư mục

```
AIforLife/
├── Intelligence-Test/           # Frontend React App
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Login.jsx        # Đăng nhập/Đăng ký
│   │   │   ├── Dashboard.jsx    # Dashboard sinh viên
│   │   │   ├── InstructorDashboard.jsx  # Dashboard giảng viên
│   │   │   └── Exam.jsx         # Phòng thi
│   │   ├── context/
│   │   │   └── AuthContext.jsx  # Auth state management
│   │   ├── lib/
│   │   │   └── supabase.js      # Supabase client
│   │   ├── workers/
│   │   │   └── ai.worker.js     # AI processing in web worker
│   │   └── App.jsx
│   ├── public/
│   │   └── models/              # ONNX models
│   └── tailwind.config.js       # Semantic colors
│
├── Intelligence-Test-Server/    # Backend Node.js
│   └── index.js                 # Express API server
│
├── database/
│   └── smart_exam_schema.sql    # PostgreSQL schema với RLS
│
└── Intelligence_Test_YOLO_Training_colab.ipynb  # Model training
```

## Hệ thống màu (Color System)

```javascript
// tailwind.config.js
{
  primary: '#2563EB',      // Blue 600
  background: '#F8FAFC',   // Slate 50
  paper: '#FFFFFF',        // White
  'text-main': '#1E293B',  // Slate 800
  success: '#16A34A',
  warning: '#CA8A04',
  danger: '#DC2626'
}
```

## API Endpoints

### Exam
- `POST /api/exam/start` - Bắt đầu phiên thi
- `POST /api/exam/submit` - Nộp bài

### Proctoring
- `POST /api/proctoring/log` - Ghi log vi phạm

### AI
- `POST /api/generate-question` - Sinh câu hỏi AI

### Instructor
- `GET /api/instructor/exam/:id/stats` - Thống kê bài thi
- `GET /api/instructor/session/:id/logs` - Xem logs vi phạm

## Bảo mật (Security)

1. **Row Level Security (RLS)**: Mọi bảng đều có RLS policies
2. **Server-side Validation**: Zod schemas cho mọi input
3. **Rate Limiting**: Giới hạn request để chống DDoS
4. **CORS Configuration**: Chỉ cho phép origin được cấu hình
5. **Auth Verification**: Middleware kiểm tra JWT token
6. **Atomic Operations**: Sử dụng PostgreSQL functions để tránh race conditions

## Xử lý đồng thời (Concurrency)

- **Pessimistic Locking**: `SELECT FOR UPDATE` trong các hàm PostgreSQL
- **Atomic Session Creation**: Hàm `start_exam_session` với transaction
- **Idempotent Answer Submission**: Upsert answers với `ON CONFLICT`

## Đóng góp (Contributing)

1. Fork repository
2. Tạo branch: `git checkout -b feature/ten-tinh-nang`
3. Commit: `git commit -m 'Add some feature'`
4. Push: `git push origin feature/ten-tinh-nang`
5. Tạo Pull Request

## License

MIT License

---

**Trạng thái**: Production Ready ✅
