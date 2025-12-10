import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { motion, AnimatePresence } from 'framer-motion';

export default function Exam() {
  const videoRef = useRef(null);
  const workerRef = useRef(null);
  const [status, setStatus] = useState("Đang khởi tạo hệ thống chống gian lận...");
  const [cheatCount, setCheatCount] = useState(0);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    // Network Monitoring
    const handleOnline = () => { setIsOffline(false); toast.success("Đã kết nối lại mạng."); };
    const handleOffline = () => { setIsOffline(true); toast.error("Mất kết nối mạng! Bài thi sẽ không được lưu."); };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initialize Worker
    workerRef.current = new Worker(new URL('../workers/ai.worker.js', import.meta.url), { type: 'module' });

    workerRef.current.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'STATUS') {
        setStatus(payload);
      } else if (type === 'ALERT') {
        setCheatCount(prev => prev + 1);
        toast.warning(`Cảnh báo gian lận: ${payload}`, { autoClose: 2000 });
      }
    };

    // Setup Camera
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadeddata = () => {
             const canvas = document.createElement('canvas');
             canvas.width = 640;
             canvas.height = 480;
             const ctx = canvas.getContext('2d', { willReadFrequently: true });

             setInterval(() => {
               if (videoRef.current && workerRef.current) {
                  ctx.drawImage(videoRef.current, 0, 0, 640, 480);
                  const imageData = ctx.getImageData(0, 0, 640, 480);
                  workerRef.current.postMessage({ type: 'PROCESS_FRAME', payload: imageData }, [imageData.data.buffer]);
               }
             }, 200);
          };
        }
      } catch (err) {
        console.error("Camera error:", err);
        toast.error("Không thể truy cập camera. Vui lòng cấp quyền.");
      }
    };

    startCamera();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (workerRef.current) workerRef.current.terminate();
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Network Alert Overlay */}
      <AnimatePresence>
        {isOffline && (
          <motion.div
            initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            className="fixed top-0 w-full bg-red-600 text-white text-center font-bold z-50 overflow-hidden"
          >
            <div className="p-2">⚠️ MẤT KẾT NỐI MẠNG - Vui lòng kiểm tra đường truyền ngay lập tức!</div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="w-3/4 p-8 overflow-y-auto">
        <header className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold text-gray-800">Bài thi trắc nghiệm</h1>
            <div className="text-gray-500 text-sm">Thời gian còn lại: 45:00</div>
        </header>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-4 hover:shadow-md transition-shadow">
           <h2 className="font-semibold text-lg mb-4 text-gray-800">Câu hỏi 1: Thủ đô của Việt Nam là gì?</h2>
           <div className="space-y-3">
             {['Hà Nội', 'TP. Hồ Chí Minh', 'Đà Nẵng', 'Cần Thơ'].map((opt, idx) => (
                <label key={idx} className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-blue-50 transition-colors">
                    <input type="radio" name="q1" className="h-4 w-4 text-blue-600 focus:ring-blue-500" />
                    <span className="ml-3 text-gray-700">{opt}</span>
                </label>
             ))}
           </div>
        </div>
        {/* More questions would be mapped here */}
      </div>

      <div className="w-1/4 bg-white border-l border-gray-200 p-4 flex flex-col shadow-lg">
        <div className="mb-6">
          <h3 className="font-bold text-gray-700 mb-2 flex items-center">
            <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></span>
            Camera Giám Sát
          </h3>
          <div className="relative bg-black rounded-lg overflow-hidden aspect-video shadow-inner">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover opacity-90" />
            <div className="absolute top-2 left-2 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">REC</div>
          </div>
          <p className="text-xs mt-2 text-gray-500 italic text-center">{status}</p>
        </div>

        <div className={`p-4 rounded-lg border ${cheatCount > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'} transition-colors`}>
           <p className="text-sm font-semibold text-gray-600 mb-1">Số lần cảnh báo:</p>
           <p className={`text-3xl font-bold ${cheatCount > 0 ? 'text-red-600' : 'text-green-600'}`}>{cheatCount}</p>
        </div>
      </div>
    </div>
  );
}
