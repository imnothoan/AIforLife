import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

export default function Exam() {
  const videoRef = useRef(null);
  const workerRef = useRef(null);
  const navigate = useNavigate();

  // Exam State
  const [status, setStatus] = useState("Đang khởi tạo hệ thống...");
  const [cheatCount, setCheatCount] = useState(0);
  const [tabViolations, setTabViolations] = useState(0);
  const [fullscreenViolations, setFullscreenViolations] = useState(0);

  // Environment State
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasMultiScreen, setHasMultiScreen] = useState(false);
  const [examStarted, setExamStarted] = useState(false);

  // --- 1. Advanced Anti-Cheat: Multi-Screen Detection ---
  const checkScreens = async () => {
    try {
      if ('isExtended' in window.screen && window.screen.isExtended) {
         setHasMultiScreen(true);
         toast.error("PHÁT HIỆN 2 MÀN HÌNH! Vui lòng ngắt kết nối màn hình phụ để thi.", { autoClose: false });
         return false;
      }

      // Advanced: Window Placement API (Chrome 100+)
      if ('getScreenDetails' in window) {
        const screens = await window.getScreenDetails().catch(() => null);
        if (screens && screens.screens.length > 1) {
             setHasMultiScreen(true);
             toast.error(`PHÁT HIỆN ${screens.screens.length} MÀN HÌNH! Nghi vấn gian lận.`, { autoClose: false });
             return false;
        }
      }
    } catch (e) {
      console.warn("Screen API not supported", e);
    }
    setHasMultiScreen(false);
    return true;
  };

  // --- 2. Advanced Anti-Cheat: Fullscreen Enforcement ---
  const enterFullscreen = async () => {
      try {
          await document.documentElement.requestFullscreen();
          setIsFullscreen(true);
      } catch (e) {
          toast.error("Bạn phải bật chế độ Toàn màn hình để thi!");
      }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
        const isFull = !!document.fullscreenElement;
        setIsFullscreen(isFull);
        if (!isFull && examStarted) {
            setFullscreenViolations(prev => {
                const newVal = prev + 1;
                toast.error(`CẢNH BÁO: Bạn đã thoát toàn màn hình ${newVal} lần!`);
                return newVal;
            });
        }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [examStarted]);

  // --- 3. Advanced Anti-Cheat: Tab Switching (Visibility) ---
  useEffect(() => {
    const handleVisibilityChange = () => {
        if (document.hidden && examStarted) {
            setTabViolations(prev => {
                const newVal = prev + 1;
                toast.warning(`CẢNH BÁO: Phát hiện rời tab ${newVal} lần! Hành vi này được ghi lại.`);
                return newVal;
            });
        }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [examStarted]);

  // --- 4. Network & AI Worker (Existing) ---
  useEffect(() => {
    const handleOnline = () => { setIsOffline(false); toast.success("Đã kết nối lại mạng."); };
    const handleOffline = () => { setIsOffline(true); toast.error("Mất kết nối mạng! Bài thi sẽ không được lưu."); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    workerRef.current = new Worker(new URL('../workers/ai.worker.js', import.meta.url), { type: 'module' });
    workerRef.current.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'STATUS') setStatus(payload);
      else if (type === 'ALERT') {
        setCheatCount(prev => prev + 1);
        toast.warning(`AI Cảnh báo: ${payload}`);
      }
    };

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
               if (videoRef.current && workerRef.current && examStarted) {
                  ctx.drawImage(videoRef.current, 0, 0, 640, 480);
                  const imageData = ctx.getImageData(0, 0, 640, 480);
                  workerRef.current.postMessage({ type: 'PROCESS_FRAME', payload: imageData }, [imageData.data.buffer]);
               }
             }, 200);
          };
        }
      } catch (err) {
        console.error(err);
        toast.error("Không thể truy cập camera.");
      }
    };
    startCamera();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (workerRef.current) workerRef.current.terminate();
    };
  }, [examStarted]);

  // --- Handlers ---
  const handleStartExam = async () => {
      const screenSafe = await checkScreens();
      if (!screenSafe) return;

      await enterFullscreen();
      setExamStarted(true);
      toast.info("Bài thi bắt đầu! Chúc bạn làm bài tốt.");
  };

  const handleSubmit = () => {
      // Submit logic here
      navigate('/');
      toast.success("Nộp bài thành công!");
  };

  // --- UI Render ---
  if (!examStarted) {
      return (
          <div className="flex flex-col items-center justify-center h-screen bg-gray-50">
              <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full text-center">
                  <h2 className="text-2xl font-bold text-blue-600 mb-4">Quy định phòng thi</h2>
                  <ul className="text-left text-gray-700 space-y-2 mb-6 text-sm">
                      <li>✅ Phải bật Camera & Micro toàn thời gian.</li>
                      <li>✅ Phải sử dụng chế độ Toàn màn hình.</li>
                      <li>🚫 Nghiêm cấm sử dụng màn hình phụ (HDMI/Projector).</li>
                      <li>🚫 Nghiêm cấm rời khỏi tab thi (Alt+Tab).</li>
                  </ul>
                  {hasMultiScreen && <div className="p-3 bg-red-100 text-red-700 rounded mb-4 text-sm font-bold">⚠️ PHÁT HIỆN NHIỀU MÀN HÌNH</div>}
                  <button onClick={handleStartExam} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 transition">
                      Đồng ý & Bắt đầu làm bài
                  </button>
              </div>
          </div>
      );
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Network Alert Overlay */}
      <AnimatePresence>
        {isOffline && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} className="fixed top-0 w-full bg-red-600 text-white text-center font-bold z-50">
            <div className="p-2">⚠️ MẤT KẾT NỐI MẠNG</div>
          </motion.div>
        )}
        {!isFullscreen && (
           <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 bg-black/90 z-40 flex items-center justify-center text-white flex-col">
               <h2 className="text-3xl font-bold mb-4">⚠️ CẢNH BÁO VI PHẠM</h2>
               <p className="mb-6">Vui lòng quay lại chế độ toàn màn hình để tiếp tục!</p>
               <button onClick={enterFullscreen} className="bg-red-600 px-6 py-3 rounded font-bold">Quay lại bài thi</button>
           </motion.div>
        )}
      </AnimatePresence>

      <div className="w-3/4 p-8 overflow-y-auto">
        <header className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold text-gray-800">Môn thi: Trí tuệ nhân tạo</h1>
            <div className="text-blue-600 font-mono text-lg font-bold bg-blue-50 px-4 py-2 rounded">45:00</div>
        </header>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-4">
           <h2 className="font-semibold text-lg mb-4 text-gray-800">Câu 1: Deep Learning là gì?</h2>
           <div className="space-y-3">
             {['Một loại máy học dựa trên mạng nơ-ron nhân tạo', 'Một phần mềm chỉnh sửa ảnh', 'Một thuật toán sắp xếp', 'Một ngôn ngữ lập trình'].map((opt, idx) => (
                <label key={idx} className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-blue-50 transition-colors">
                    <input type="radio" name="q1" className="h-4 w-4 text-blue-600" />
                    <span className="ml-3 text-gray-700">{opt}</span>
                </label>
             ))}
           </div>
        </div>
        <button onClick={handleSubmit} className="mt-8 bg-green-600 text-white px-8 py-3 rounded-lg font-bold hover:bg-green-700">Nộp bài</button>
      </div>

      <div className="w-1/4 bg-white border-l border-gray-200 p-4 flex flex-col shadow-lg">
        <div className="mb-6">
          <h3 className="font-bold text-gray-700 mb-2">Camera Giám Sát</h3>
          <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            <div className="absolute top-2 left-2 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded">REC</div>
          </div>
          <p className="text-xs mt-2 text-gray-500 text-center">{status}</p>
        </div>

        <div className="space-y-4">
            <div className="p-3 bg-red-50 border border-red-100 rounded">
                <p className="text-xs text-gray-500 uppercase font-bold">Phát hiện vật thể</p>
                <p className="text-2xl font-bold text-red-600">{cheatCount}</p>
            </div>
            <div className="p-3 bg-orange-50 border border-orange-100 rounded">
                <p className="text-xs text-gray-500 uppercase font-bold">Rời Tab</p>
                <p className="text-2xl font-bold text-orange-600">{tabViolations}</p>
            </div>
            <div className="p-3 bg-yellow-50 border border-yellow-100 rounded">
                <p className="text-xs text-gray-500 uppercase font-bold">Thoát Fullscreen</p>
                <p className="text-2xl font-bold text-yellow-600">{fullscreenViolations}</p>
            </div>
        </div>
      </div>
    </div>
  );
}
