# YOLO Model Folder

Thư mục này chứa các model AI cho hệ thống chống gian lận.

## Cách lấy model:

### Tùy chọn 1: Train model mới (khuyến nghị)
1. Mở file `Intelligence_Test_YOLO_Training_colab.ipynb` trên Google Colab
2. Chạy tất cả các cells theo hướng dẫn
3. Download file `best.onnx` từ Google Drive
4. Đổi tên thành `anticheat_yolo11s.onnx` và đặt vào thư mục này

### Tùy chọn 2: Sử dụng model có sẵn
1. Download từ releases page của repository
2. Giải nén và copy vào thư mục này

## Các file cần có:
- `anticheat_yolo11s.onnx` (~40MB) - Model phát hiện phone/book/headphones

## Lưu ý:
- File ONNX không được commit lên git (do kích thước lớn)
- Mỗi lần deploy cần copy model vào thư mục này
