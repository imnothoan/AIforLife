import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';

export default function Exam() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const workerRef = useRef(null);
  const [status, setStatus] = useState("Đang khởi tạo hệ thống chống gian lận...");
  const [cheatCount, setCheatCount] = useState(0);

  useEffect(() => {
    // Initialize Worker
    workerRef.current = new Worker(new URL('../workers/ai.worker.js', import.meta.url), { type: 'module' });

    workerRef.current.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'STATUS') {
        setStatus(payload);
      } else if (type === 'ALERT') {
        setCheatCount(prev => prev + 1);
        toast.warning(`Cảnh báo gian lận: ${payload}`);
      }
    };

    // Setup Camera
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadeddata = () => {
             // Send video frames to worker
             const canvas = document.createElement('canvas');
             canvas.width = 640;
             canvas.height = 480;
             const ctx = canvas.getContext('2d', { willReadFrequently: true });

             setInterval(() => {
               if (videoRef.current && workerRef.current) {
                  ctx.drawImage(videoRef.current, 0, 0, 640, 480);
                  const imageData = ctx.getImageData(0, 0, 640, 480);
                  // We transfer buffer to worker for zero-copy if possible, or just send data
                  workerRef.current.postMessage({ type: 'PROCESS_FRAME', payload: imageData }, [imageData.data.buffer]);
               }
             }, 200); // 5 FPS processing
          };
        }
      } catch (err) {
        console.error("Camera error:", err);
        toast.error("Không thể truy cập camera.");
      }
    };

    startCamera();

    return () => {
      if (workerRef.current) workerRef.current.terminate();
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return (
    <div className="flex h-screen">
      <div className="w-3/4 p-8 overflow-y-auto">
        <h1 className="text-2xl font-bold mb-4">Bài thi trắc nghiệm</h1>
        <div className="bg-white p-6 rounded shadow mb-4">
           <h2 className="font-semibold mb-2">Câu hỏi 1: Thủ đô của Việt Nam là gì?</h2>
           <div className="space-y-2">
             <label className="block"><input type="radio" name="q1" /> Hà Nội</label>
             <label className="block"><input type="radio" name="q1" /> TP. Hồ Chí Minh</label>
             <label className="block"><input type="radio" name="q1" /> Đà Nẵng</label>
           </div>
        </div>
        {/* More questions here */}
      </div>
      <div className="w-1/4 bg-gray-200 p-4 border-l flex flex-col">
        <div className="mb-4">
          <h3 className="font-bold mb-2">Camera Giám Sát</h3>
          <div className="relative bg-black rounded overflow-hidden" style={{ height: '180px' }}>
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            <div className="absolute top-0 left-0 bg-red-600 text-white text-xs px-2 py-1">LIVE</div>
          </div>
          <p className="text-sm mt-2 text-gray-600">{status}</p>
        </div>
        <div className="bg-white p-4 rounded shadow">
           <p className="font-bold text-red-600">Vi phạm: {cheatCount}</p>
        </div>
      </div>
    </div>
  );
}
