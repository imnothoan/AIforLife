# 🚀 HƯỚNG DẪN TRIỂN KHAI SMARTEXAMPRO LÊN NAMECHEAP

## Mục lục
1. [Yêu cầu](#yêu-cầu)
2. [Chuẩn bị Database (Supabase)](#1-chuẩn-bị-database-supabase)
3. [Build Frontend](#2-build-frontend)
4. [Deploy Backend lên Namecheap](#3-deploy-backend-lên-namecheap)
5. [Deploy Frontend lên Namecheap](#4-deploy-frontend-lên-namecheap)
6. [Cấu hình DNS](#5-cấu-hình-dns)
7. [SSL Certificate](#6-ssl-certificate)
8. [Kiểm tra sau triển khai](#7-kiểm-tra-sau-triển-khai)

---

## Yêu cầu

- ✅ Tài khoản Namecheap (có thể dùng GitHub Student Pack)
- ✅ Domain đã đăng ký trên Namecheap
- ✅ Supabase project đã cấu hình
- ✅ Node.js 18+ trên máy local
- ✅ Git

---

## 1. Chuẩn bị Database (Supabase)

### 1.1 Tạo Supabase Project
1. Truy cập [supabase.com](https://supabase.com)
2. Tạo project mới
3. Lưu lại các thông tin:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **Anon Key**: (trong Project Settings > API)
   - **Service Role Key**: (trong Project Settings > API)

### 1.2 Chạy Database Schema
1. Mở SQL Editor trong Supabase Dashboard
2. Copy nội dung file `database/smart_exam_schema.sql`
3. Chạy SQL để tạo tables và RLS policies

### 1.3 Cấu hình Authentication
1. Vào Authentication > Providers
2. Bật Email provider
3. Tắt "Confirm email" nếu muốn đăng ký không cần xác nhận

---

## 2. Build Frontend

### 2.1 Cấu hình Environment Variables
Tạo file `.env.production` trong thư mục `Intelligence-Test/`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_URL=https://api.yourdomain.com
```

### 2.2 Build Production
```bash
cd Intelligence-Test
npm install
npm run build
```

Output sẽ nằm trong thư mục `dist/`

---

## 3. Deploy Backend lên Namecheap

### Option A: Sử dụng Namecheap Shared Hosting (cPanel)

⚠️ **Lưu ý**: Shared Hosting của Namecheap KHÔNG hỗ trợ Node.js trực tiếp.

### Option B: Sử dụng VPS (Khuyến nghị)

Nếu bạn có VPS hoặc sử dụng Namecheap VPS:

#### 3.1 SSH vào VPS
```bash
ssh root@your-vps-ip
```

#### 3.2 Cài đặt Node.js
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### 3.3 Clone và cấu hình Backend
```bash
cd /var/www
git clone https://github.com/imnothoan/AIforLife.git
cd AIforLife/Intelligence-Test-Server
npm install
```

#### 3.4 Tạo file .env
```bash
nano .env
```

Thêm nội dung:
```env
PORT=3000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
GEMINI_API_KEY=your-gemini-api-key
FRONTEND_URL=https://yourdomain.com
NODE_ENV=production
```

#### 3.5 Cài đặt PM2 để chạy Node.js
```bash
npm install -g pm2
pm2 start index.js --name "smartexam-api"
pm2 startup
pm2 save
```

### Option C: Sử dụng Railway/Render (Miễn phí với GitHub Student)

Nếu không có VPS, bạn có thể deploy backend lên:
- **Railway**: [railway.app](https://railway.app) - Miễn phí $5/tháng với GitHub Student
- **Render**: [render.com](https://render.com) - Free tier

---

## 4. Deploy Frontend lên Namecheap

### 4.1 Sử dụng cPanel File Manager

1. Đăng nhập vào cPanel của Namecheap
2. Mở **File Manager**
3. Truy cập thư mục `public_html`
4. Upload toàn bộ nội dung thư mục `dist/` vào `public_html`

### 4.2 Cấu hình .htaccess cho React Router

Tạo file `.htaccess` trong `public_html`:

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  
  # Handle React Router
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteCond %{REQUEST_FILENAME} !-l
  RewriteRule . /index.html [L]
</IfModule>

# Enable gzip compression
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/plain text/xml text/css application/javascript application/json
</IfModule>

# Cache static assets
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType image/jpg "access 1 year"
  ExpiresByType image/jpeg "access 1 year"
  ExpiresByType image/gif "access 1 year"
  ExpiresByType image/png "access 1 year"
  ExpiresByType image/svg+xml "access 1 year"
  ExpiresByType text/css "access 1 month"
  ExpiresByType application/javascript "access 1 month"
  ExpiresByType application/wasm "access 1 year"
</IfModule>
```

---

## 5. Cấu hình DNS

### 5.1 Nếu dùng Namecheap Hosting
1. Vào Namecheap Dashboard > Domain List
2. Chọn domain > Manage
3. Vào Advanced DNS
4. Thêm record:
   - **Type**: A Record
   - **Host**: @
   - **Value**: IP của hosting (lấy từ cPanel)
   - **TTL**: Automatic

### 5.2 Nếu dùng VPS riêng
1. Thêm A Record trỏ đến IP của VPS
2. Thêm CNAME cho www nếu cần

---

## 6. SSL Certificate

### 6.1 Sử dụng SSL miễn phí từ Namecheap
1. Vào cPanel > Security > SSL/TLS
2. Chọn "Manage SSL sites"
3. Sử dụng AutoSSL hoặc Let's Encrypt

### 6.2 Hoặc cài Let's Encrypt trên VPS
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

---

## 7. Kiểm tra sau triển khai

### Checklist

- [ ] Website load được tại https://yourdomain.com
- [ ] Đăng ký tài khoản mới hoạt động
- [ ] Đăng nhập hoạt động
- [ ] Instructor redirect đúng role
- [ ] Tạo lớp học thành công
- [ ] Tạo bài thi thành công
- [ ] Thêm sinh viên vào lớp
- [ ] Sinh viên làm bài thi được
- [ ] Camera/AI anticheat hoạt động
- [ ] Song ngữ Vi/En hoạt động

### Test Performance
1. Mở Chrome DevTools > Lighthouse
2. Chạy audit cho Performance, Accessibility, SEO
3. Đảm bảo điểm > 80 cho mỗi hạng mục

---

## 🔐 Bảo mật quan trọng

1. **QUAN TRỌNG**: Thay đổi (rotate) tất cả API keys trước khi deploy production
2. Không commit file `.env` lên Git
3. Sử dụng HTTPS cho tất cả connections
4. Enable RLS trên Supabase

---

## 📞 Hỗ trợ

Nếu gặp vấn đề khi triển khai, kiểm tra:
1. Console logs trong Browser DevTools
2. Network tab để xem API calls
3. Supabase Dashboard > Logs để xem database errors

---

## 🎉 Hoàn thành!

Sau khi hoàn thành các bước trên, nền tảng SmartExamPro của bạn đã sẵn sàng cho kỳ thi thực tế!

**Khuyến nghị trước khi dùng cho kỳ thi thật:**
1. Test với 10-20 người dùng trước
2. Kiểm tra load time trong điều kiện mạng chậm
3. Có backup plan nếu hệ thống gặp sự cố

---

## 🎓 HƯỚNG DẪN ĐẶC BIỆT CHO GITHUB STUDENT PACK

### Các dịch vụ miễn phí bạn có thể sử dụng:

#### 1. Namecheap (Domain miễn phí 1 năm)
- Đăng ký tại: https://nc.me/
- Chọn domain `.me` miễn phí
- Liên kết với GitHub Education

#### 2. Supabase (Database)
- Free tier: 500MB database, 50K monthly active users
- Đủ dùng cho hầu hết các kỳ thi

#### 3. Railway/Render (Backend Hosting)
- **Railway**: $5/tháng credit miễn phí
- **Render**: Free tier với 750 hours/tháng

#### 4. Vercel/Netlify (Frontend Hosting)
- Hoàn toàn miễn phí cho static sites
- Tự động deploy từ GitHub

---

## 🔒 BẢO MẬT TRƯỚC KHI PRODUCTION

### Checklist bắt buộc:

```bash
# 1. Đổi tất cả API keys
# Vào Supabase > Settings > API > Regenerate keys

# 2. Kiểm tra RLS policies
# Đảm bảo tất cả tables có RLS enabled

# 3. Đổi mật khẩu database
# Supabase > Settings > Database > Connection Pooling

# 4. Cấu hình CORS đúng domain
# Trong server .env: FRONTEND_URL=https://yourdomain.com

# 5. Enable 2FA cho tất cả accounts
```

---

## 📊 MONITORING SAU DEPLOY

### 1. Kiểm tra Health
```bash
# Test API
curl https://api.yourdomain.com/api/health

# Test Frontend
curl -I https://yourdomain.com
```

### 2. Logs quan trọng cần theo dõi
- Supabase Dashboard > Logs
- Railway/Render Dashboard > Logs
- Browser Console (F12)

---

## 🆘 XỬ LÝ SỰ CỐ THƯỜNG GẶP

### Lỗi 1: "Failed to fetch" hoặc CORS error
**Giải pháp:**
```javascript
// Kiểm tra FRONTEND_URL trong server .env
FRONTEND_URL=https://yourdomain.com

// Hoặc tạm thời cho phép all origins
FRONTEND_URL=*
```

### Lỗi 2: Database connection timeout
**Giải pháp:**
- Kiểm tra Supabase project có đang active không
- Kiểm tra RLS policies có quá phức tạp không
- Tăng connection pool size trong Supabase

### Lỗi 3: AI Model không load được
**Giải pháp:**
- Đảm bảo file `.onnx` được copy vào thư mục `dist/models/`
- Kiểm tra CORS headers cho model files
- Thử load model từ CDN thay vì local

### Lỗi 4: Camera không hoạt động
**Giải pháp:**
- Đảm bảo sử dụng HTTPS
- Kiểm tra permissions trong browser
- Test trên Chrome/Edge trước (Safari có một số hạn chế)

---

## ✅ CHECKLIST TRƯỚC KỲ THI THỰC TẾ

- [ ] Test với 10-20 học sinh thử nghiệm
- [ ] Kiểm tra backup database
- [ ] Chuẩn bị plan B (giấy) nếu hệ thống gặp sự cố
- [ ] Thông báo cho học sinh về yêu cầu:
  - Camera hoạt động
  - Microphone tắt
  - Mạng ổn định
  - Sử dụng Chrome/Edge
- [ ] Có người hỗ trợ kỹ thuật túc trực
- [ ] Ghi lại số điện thoại liên hệ khẩn cấp

---

*Cập nhật lần cuối: $(date +%Y-%m-%d)*
