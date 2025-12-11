import React, { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'react-toastify';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { 
  Flag, FlagOff, StickyNote, ChevronLeft, ChevronRight, 
  Clock, Camera, AlertTriangle, Send, Monitor, Wifi, WifiOff,
  Eye, EyeOff, Shield, XCircle, CheckCircle, Loader2
} from 'lucide-react';

// Remote desktop detection signatures
const REMOTE_DESKTOP_SIGNATURES = [
  'teamviewer', 'anydesk', 'ultraviewer', 'parsec', 'vnc',
  'remotedesktop', 'citrix', 'logmein', 'splashtop', 'chrome remote',
  'microsoft remote', 'rdp', 'ammyy', 'supremo'
];

export default function Exam() {
  const { id: examId } = useParams();
  const { user, profile } = useAuth();
  const videoRef = useRef(null);
  const workerRef = useRef(null);
  const timerRef = useRef(null);
  const navigate = useNavigate();

  // Exam State
  const [examData, setExamData] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [flaggedQuestions, setFlaggedQuestions] = useState(new Set());
  const [notes, setNotes] = useState({});
  const [sessionId, setSessionId] = useState(null);

  // Timer
  const [timeRemaining, setTimeRemaining] = useState(null);
  const [isTimerWarning, setIsTimerWarning] = useState(false);

  // Anti-cheat State
  const [status, setStatus] = useState("Đang khởi tạo hệ thống...");
  const [cheatCount, setCheatCount] = useState(0);
  const [tabViolations, setTabViolations] = useState(0);
  const [fullscreenViolations, setFullscreenViolations] = useState(0);
  const [gazeAwayCount, setGazeAwayCount] = useState(0);

  // Environment State
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasMultiScreen, setHasMultiScreen] = useState(false);
  const [remoteDesktopDetected, setRemoteDesktopDetected] = useState(false);
  const [examStarted, setExamStarted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // UI State
  const [showNotes, setShowNotes] = useState(false);
  const [showQuestionNav, setShowQuestionNav] = useState(true);

  // Current question
  const currentQuestion = questions[currentQuestionIndex];

  // ============================================
  // REMOTE DESKTOP DETECTION
  // ============================================
  const detectRemoteDesktop = useCallback(() => {
    // Method 1: Check user agent
    const ua = navigator.userAgent.toLowerCase();
    for (const sig of REMOTE_DESKTOP_SIGNATURES) {
      if (ua.includes(sig)) {
        return true;
      }
    }

    // Method 2: Check for suspicious screen dimensions
    const screenRatio = window.screen.width / window.screen.height;
    const windowRatio = window.innerWidth / window.innerHeight;
    if (Math.abs(screenRatio - windowRatio) > 0.2) {
      // Large difference might indicate remote desktop
      console.warn('Suspicious screen ratio detected');
    }

    // Method 3: Check for abnormal event timing (remote desktop adds latency)
    // This is done through mouse movement analysis in processFrame

    // Method 4: Check WebGL renderer (VMs and remote sessions often have specific renderers)
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL).toLowerCase();
          const remoteRenderers = ['vmware', 'virtualbox', 'parallels', 'hyper-v', 'swiftshader', 'llvmpipe'];
          for (const r of remoteRenderers) {
            if (renderer.includes(r)) {
              console.warn('Virtual machine renderer detected:', renderer);
              return true;
            }
          }
        }
      }
    } catch (e) {
      console.warn('WebGL check failed:', e);
    }

    return false;
  }, []);

  // ============================================
  // MULTI-SCREEN DETECTION
  // ============================================
  const checkScreens = useCallback(async () => {
    try {
      // Check basic screen extension
      if ('isExtended' in window.screen && window.screen.isExtended) {
        setHasMultiScreen(true);
        toast.error("PHÁT HIỆN 2 MÀN HÌNH! Vui lòng ngắt kết nối màn hình phụ để thi.", { autoClose: false });
        return false;
      }

      // Advanced: Window Placement API (Chrome 100+)
      if ('getScreenDetails' in window) {
        try {
          const screens = await window.getScreenDetails();
          if (screens && screens.screens.length > 1) {
            setHasMultiScreen(true);
            toast.error(`PHÁT HIỆN ${screens.screens.length} MÀN HÌNH! Nghi vấn gian lận.`, { autoClose: false });
            return false;
          }
        } catch (e) {
          // Permission denied or not supported
          console.warn("Screen details permission denied");
        }
      }
    } catch (e) {
      console.warn("Screen API not supported", e);
    }
    setHasMultiScreen(false);
    return true;
  }, []);

  // ============================================
  // FULLSCREEN MANAGEMENT
  // ============================================
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
          logProctoring('fullscreen_exit', { count: newVal });
          return newVal;
        });
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [examStarted]);

  // ============================================
  // TAB VISIBILITY DETECTION
  // ============================================
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && examStarted) {
        setTabViolations(prev => {
          const newVal = prev + 1;
          toast.warning(`CẢNH BÁO: Phát hiện rời tab ${newVal} lần! Hành vi này được ghi lại.`);
          logProctoring('tab_switch', { count: newVal });
          return newVal;
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [examStarted]);

  // ============================================
  // KEYBOARD SHORTCUTS PREVENTION
  // ============================================
  useEffect(() => {
    if (!examStarted) return;

    const handleKeyDown = (e) => {
      // Prevent common cheat shortcuts
      const blockedCombos = [
        { ctrl: true, key: 'c' }, // Copy
        { ctrl: true, key: 'v' }, // Paste
        { ctrl: true, key: 'p' }, // Print
        { ctrl: true, key: 's' }, // Save
        { ctrl: true, key: 'f' }, // Find
        { ctrl: true, shift: true, key: 'i' }, // DevTools
        { key: 'F12' }, // DevTools
        { alt: true, key: 'Tab' }, // Alt+Tab (limited prevention)
        { key: 'PrintScreen' }, // Screenshot
      ];

      for (const combo of blockedCombos) {
        const matches = 
          (!combo.ctrl || e.ctrlKey) &&
          (!combo.shift || e.shiftKey) &&
          (!combo.alt || e.altKey) &&
          (e.key.toLowerCase() === combo.key?.toLowerCase() || e.key === combo.key);
        
        if (matches && combo.key) {
          e.preventDefault();
          toast.warning("Phím tắt bị vô hiệu hóa trong phòng thi!");
          logProctoring('keyboard_shortcut', { key: e.key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey });
          return;
        }
      }
    };

    const handleContextMenu = (e) => {
      e.preventDefault();
      toast.warning("Click chuột phải bị vô hiệu hóa!");
      logProctoring('right_click', {});
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('contextmenu', handleContextMenu);
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [examStarted]);

  // ============================================
  // NETWORK & CAMERA SETUP
  // ============================================
  useEffect(() => {
    const handleOnline = () => { setIsOffline(false); toast.success("Đã kết nối lại mạng."); };
    const handleOffline = () => { setIsOffline(true); toast.error("Mất kết nối mạng! Bài thi sẽ không được lưu."); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initialize AI Worker
    workerRef.current = new Worker(new URL('../workers/ai.worker.js', import.meta.url), { type: 'module' });
    workerRef.current.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'STATUS') setStatus(payload);
      else if (type === 'ALERT') {
        setCheatCount(prev => prev + 1);
        toast.warning(`AI Cảnh báo: ${payload}`);
        logProctoring('ai_alert', { message: payload });
      } else if (type === 'GAZE_AWAY') {
        setGazeAwayCount(prev => prev + 1);
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
        toast.error("Không thể truy cập camera. Vui lòng cấp quyền camera để thi.");
      }
    };
    startCamera();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (workerRef.current) workerRef.current.terminate();
    };
  }, [examStarted]);

  // ============================================
  // TIMER
  // ============================================
  useEffect(() => {
    if (!examStarted || timeRemaining === null) return;

    timerRef.current = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          handleAutoSubmit();
          return 0;
        }
        // Warning at 5 minutes
        if (prev === 300) {
          setIsTimerWarning(true);
          toast.warning("⚠️ Còn 5 phút! Hãy kiểm tra lại bài làm.");
        }
        // Warning at 1 minute
        if (prev === 60) {
          toast.error("⚠️ Còn 1 phút!");
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [examStarted, timeRemaining]);

  // ============================================
  // LOAD EXAM DATA
  // ============================================
  useEffect(() => {
    const loadExamData = async () => {
      // For demo, use mock data
      // In production, fetch from Supabase
      setExamData({
        id: examId,
        title: 'Trí tuệ nhân tạo (AI)',
        code: 'INT3401',
        duration_minutes: 45,
        require_camera: true,
        require_fullscreen: true
      });

      // Mock questions
      setQuestions([
        {
          id: '1',
          question_text: 'Deep Learning là gì?',
          question_type: 'multiple_choice',
          options: [
            { id: 'A', text: 'Một loại máy học dựa trên mạng nơ-ron nhân tạo' },
            { id: 'B', text: 'Một phần mềm chỉnh sửa ảnh' },
            { id: 'C', text: 'Một thuật toán sắp xếp' },
            { id: 'D', text: 'Một ngôn ngữ lập trình' },
          ],
          points: 2
        },
        {
          id: '2',
          question_text: 'Mạng nơ-ron tích chập (CNN) thường được sử dụng cho loại dữ liệu nào?',
          question_type: 'multiple_choice',
          options: [
            { id: 'A', text: 'Dữ liệu văn bản' },
            { id: 'B', text: 'Dữ liệu âm thanh' },
            { id: 'C', text: 'Dữ liệu hình ảnh' },
            { id: 'D', text: 'Dữ liệu bảng' },
          ],
          points: 2
        },
        {
          id: '3',
          question_text: 'Hàm kích hoạt ReLU có công thức là gì?',
          question_type: 'multiple_choice',
          options: [
            { id: 'A', text: 'f(x) = max(0, x)' },
            { id: 'B', text: 'f(x) = 1/(1+e^(-x))' },
            { id: 'C', text: 'f(x) = tanh(x)' },
            { id: 'D', text: 'f(x) = x^2' },
          ],
          points: 2
        },
        {
          id: '4',
          question_text: 'Overfitting xảy ra khi:',
          question_type: 'multiple_choice',
          options: [
            { id: 'A', text: 'Model học quá tốt trên tập train nhưng kém trên tập test' },
            { id: 'B', text: 'Model không học được gì từ dữ liệu' },
            { id: 'C', text: 'Model có quá ít tham số' },
            { id: 'D', text: 'Dữ liệu train quá ít' },
          ],
          points: 2
        },
        {
          id: '5',
          question_text: 'Transformer được giới thiệu trong bài báo nào?',
          question_type: 'multiple_choice',
          options: [
            { id: 'A', text: 'Attention Is All You Need' },
            { id: 'B', text: 'ImageNet Classification with Deep CNNs' },
            { id: 'C', text: 'Playing Atari with Deep RL' },
            { id: 'D', text: 'Generative Adversarial Networks' },
          ],
          points: 2
        },
      ]);

      setTimeRemaining(45 * 60); // 45 minutes in seconds
    };

    loadExamData();
  }, [examId]);

  // ============================================
  // PROCTORING LOG HELPER
  // ============================================
  const logProctoring = async (eventType, details) => {
    if (!sessionId) return;
    
    try {
      await supabase.from('proctoring_logs').insert({
        session_id: sessionId,
        event_type: eventType,
        details: details,
        severity: eventType.includes('detected') ? 'critical' : 'warning'
      });
    } catch (e) {
      console.error('Failed to log proctoring event:', e);
    }
  };

  // ============================================
  // ANSWER HANDLING
  // ============================================
  const handleAnswer = (questionId, answer) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: answer
    }));
  };

  const toggleFlag = (questionId) => {
    setFlaggedQuestions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(questionId)) {
        newSet.delete(questionId);
      } else {
        newSet.add(questionId);
      }
      return newSet;
    });
  };

  const updateNote = (questionId, note) => {
    setNotes(prev => ({
      ...prev,
      [questionId]: note
    }));
  };

  // ============================================
  // NAVIGATION
  // ============================================
  const goToQuestion = (index) => {
    if (index >= 0 && index < questions.length) {
      setCurrentQuestionIndex(index);
    }
  };

  const goNext = () => goToQuestion(currentQuestionIndex + 1);
  const goPrev = () => goToQuestion(currentQuestionIndex - 1);

  // ============================================
  // SUBMIT HANDLERS
  // ============================================
  const handleAutoSubmit = async () => {
    toast.warning("Hết giờ! Bài thi đang được nộp tự động...");
    await handleSubmit(true);
  };

  const handleSubmit = async (isAuto = false) => {
    if (isSubmitting) return;
    
    // Confirmation for manual submit
    if (!isAuto) {
      const unanswered = questions.filter(q => !answers[q.id]).length;
      const flagged = flaggedQuestions.size;
      
      let confirmMsg = "Bạn có chắc chắn muốn nộp bài?";
      if (unanswered > 0) {
        confirmMsg += `\n\n⚠️ Còn ${unanswered} câu chưa trả lời!`;
      }
      if (flagged > 0) {
        confirmMsg += `\n⚠️ Còn ${flagged} câu đang gắn cờ!`;
      }
      
      if (!window.confirm(confirmMsg)) {
        return;
      }
    }

    setIsSubmitting(true);

    try {
      // DEMO MODE: These answers are for demonstration only
      // In production, answers should be validated server-side via supabase RPC
      // The correct answers should NEVER be sent to the client
      const DEMO_MODE = examId === 'demo' || examId === '1';
      
      if (DEMO_MODE) {
        // Demo scoring - this is only for testing purposes
        // In production, this code block should not exist
        const demoCorrectAnswers = { '1': 'A', '2': 'C', '3': 'A', '4': 'A', '5': 'A' };
        let score = 0;
        let total = 0;
        
        questions.forEach(q => {
          total += q.points;
          if (answers[q.id] === demoCorrectAnswers[q.id]) {
            score += q.points;
          }
        });

        toast.success(`Nộp bài thành công! Điểm: ${score}/${total}`);
      } else {
        // Production: Submit to server for secure scoring
        // The server will compare answers and calculate score
        // await submitToServer(sessionId, answers, violations)
        toast.success("Nộp bài thành công!");
      }
      
      // Exit fullscreen
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
      
      navigate('/');
    } catch (error) {
      console.error('Submit error:', error);
      toast.error("Có lỗi xảy ra khi nộp bài. Vui lòng thử lại.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ============================================
  // START EXAM
  // ============================================
  const handleStartExam = async () => {
    // Check remote desktop
    if (detectRemoteDesktop()) {
      setRemoteDesktopDetected(true);
      toast.error("PHÁT HIỆN PHẦN MỀM ĐIỀU KHIỂN TỪ XA! Không thể bắt đầu thi.", { autoClose: false });
      return;
    }

    // Check screens
    const screenSafe = await checkScreens();
    if (!screenSafe) return;

    // Enter fullscreen
    await enterFullscreen();
    
    // Create session (mock - in production use supabase function)
    setSessionId('mock-session-id');
    
    setExamStarted(true);
    toast.info("Bài thi bắt đầu! Chúc bạn làm bài tốt.");
  };

  // ============================================
  // FORMAT TIME
  // ============================================
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // ============================================
  // PRE-EXAM SCREEN
  // ============================================
  if (!examStarted) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-primary-50 to-background p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-paper p-8 rounded-2xl shadow-soft max-w-lg w-full"
        >
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-full mb-4">
              <Shield className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-2xl font-bold text-text-main">Quy định phòng thi</h2>
            <p className="text-gray-500 mt-1">{examData?.title || 'Đang tải...'}</p>
          </div>

          <div className="space-y-3 mb-6">
            <div className="flex items-start space-x-3 p-3 bg-success-50 rounded-lg">
              <CheckCircle className="w-5 h-5 text-success mt-0.5 flex-shrink-0" />
              <span className="text-sm text-gray-700">Bật Camera & Micro trong suốt thời gian thi</span>
            </div>
            <div className="flex items-start space-x-3 p-3 bg-success-50 rounded-lg">
              <CheckCircle className="w-5 h-5 text-success mt-0.5 flex-shrink-0" />
              <span className="text-sm text-gray-700">Sử dụng chế độ Toàn màn hình (Fullscreen)</span>
            </div>
            <div className="flex items-start space-x-3 p-3 bg-danger-50 rounded-lg">
              <XCircle className="w-5 h-5 text-danger mt-0.5 flex-shrink-0" />
              <span className="text-sm text-gray-700">Nghiêm cấm sử dụng màn hình phụ (HDMI/Projector)</span>
            </div>
            <div className="flex items-start space-x-3 p-3 bg-danger-50 rounded-lg">
              <XCircle className="w-5 h-5 text-danger mt-0.5 flex-shrink-0" />
              <span className="text-sm text-gray-700">Nghiêm cấm rời khỏi tab thi (Alt+Tab)</span>
            </div>
            <div className="flex items-start space-x-3 p-3 bg-danger-50 rounded-lg">
              <XCircle className="w-5 h-5 text-danger mt-0.5 flex-shrink-0" />
              <span className="text-sm text-gray-700">Nghiêm cấm sử dụng TeamViewer, AnyDesk, UltraViewer...</span>
            </div>
          </div>

          {/* Warnings */}
          {hasMultiScreen && (
            <div className="p-4 bg-danger-100 border border-danger-200 rounded-lg mb-4 flex items-center space-x-3">
              <Monitor className="w-6 h-6 text-danger" />
              <span className="text-sm font-bold text-danger">PHÁT HIỆN NHIỀU MÀN HÌNH - Vui lòng ngắt kết nối</span>
            </div>
          )}

          {remoteDesktopDetected && (
            <div className="p-4 bg-danger-100 border border-danger-200 rounded-lg mb-4 flex items-center space-x-3">
              <AlertTriangle className="w-6 h-6 text-danger" />
              <span className="text-sm font-bold text-danger">PHÁT HIỆN PHẦN MỀM ĐIỀU KHIỂN TỪ XA</span>
            </div>
          )}

          {/* Camera preview */}
          <div className="mb-6">
            <p className="text-sm font-medium text-gray-700 mb-2">Kiểm tra Camera:</p>
            <div className="relative bg-gray-900 rounded-lg overflow-hidden aspect-video">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              <div className="absolute bottom-2 left-2 flex items-center space-x-1 bg-black/50 text-white text-xs px-2 py-1 rounded">
                <Camera className="w-3 h-3" />
                <span>Camera Preview</span>
              </div>
            </div>
          </div>

          <button 
            onClick={handleStartExam} 
            disabled={hasMultiScreen || remoteDesktopDetected}
            className="btn-primary w-full py-3 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Shield className="w-5 h-5 mr-2" />
            Đồng ý & Bắt đầu làm bài
          </button>
        </motion.div>
      </div>
    );
  }

  // ============================================
  // MAIN EXAM UI
  // ============================================
  return (
    <div className="flex h-screen bg-background no-select">
      {/* Network Alert Overlay */}
      <AnimatePresence>
        {isOffline && (
          <motion.div 
            initial={{ height: 0 }} 
            animate={{ height: 'auto' }} 
            exit={{ height: 0 }}
            className="fixed top-0 left-0 right-0 bg-danger text-white text-center font-bold z-50"
          >
            <div className="flex items-center justify-center space-x-2 p-2">
              <WifiOff className="w-5 h-5" />
              <span>MẤT KẾT NỐI MẠNG - Bài thi sẽ không được lưu!</span>
            </div>
          </motion.div>
        )}

        {/* Fullscreen Exit Warning */}
        {!isFullscreen && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            className="fixed inset-0 bg-black/95 z-40 flex items-center justify-center text-white flex-col"
          >
            <AlertTriangle className="w-20 h-20 text-danger mb-4 animate-bounce" />
            <h2 className="text-3xl font-bold mb-4">⚠️ CẢNH BÁO VI PHẠM</h2>
            <p className="mb-6 text-gray-300">Vui lòng quay lại chế độ toàn màn hình để tiếp tục!</p>
            <button onClick={enterFullscreen} className="btn-danger px-8 py-3 text-lg">
              Quay lại bài thi
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-paper border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="text-lg font-bold text-text-main">{examData?.title}</h1>
            <p className="text-sm text-gray-500">Mã môn: {examData?.code}</p>
          </div>
          
          <div className="flex items-center space-x-4">
            {/* Connection status */}
            <div className={`flex items-center space-x-1 text-sm ${isOffline ? 'text-danger' : 'text-success'}`}>
              {isOffline ? <WifiOff className="w-4 h-4" /> : <Wifi className="w-4 h-4" />}
              <span>{isOffline ? 'Offline' : 'Online'}</span>
            </div>
            
            {/* Timer */}
            <div className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-mono text-lg font-bold ${
              isTimerWarning ? 'bg-danger-100 text-danger animate-pulse' : 'bg-primary-50 text-primary'
            }`}>
              <Clock className="w-5 h-5" />
              <span>{formatTime(timeRemaining || 0)}</span>
            </div>
          </div>
        </header>

        {/* Question Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {currentQuestion && (
            <motion.div
              key={currentQuestion.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="max-w-3xl mx-auto"
            >
              {/* Question Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <span className="inline-flex items-center justify-center w-10 h-10 bg-primary text-white font-bold rounded-full">
                    {currentQuestionIndex + 1}
                  </span>
                  <div>
                    <span className="text-sm text-gray-500">Câu {currentQuestionIndex + 1}/{questions.length}</span>
                    <span className="text-sm text-gray-400 ml-2">({currentQuestion.points} điểm)</span>
                  </div>
                </div>
                
                <button
                  onClick={() => toggleFlag(currentQuestion.id)}
                  className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg transition-colors ${
                    flaggedQuestions.has(currentQuestion.id)
                      ? 'bg-warning-100 text-warning-700'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {flaggedQuestions.has(currentQuestion.id) ? (
                    <>
                      <Flag className="w-4 h-4" />
                      <span className="text-sm font-medium">Đã gắn cờ</span>
                    </>
                  ) : (
                    <>
                      <FlagOff className="w-4 h-4" />
                      <span className="text-sm font-medium">Gắn cờ</span>
                    </>
                  )}
                </button>
              </div>

              {/* Question Content */}
              <div className="card mb-4">
                <h2 className="text-lg font-semibold text-text-main mb-6">{currentQuestion.question_text}</h2>
                
                <div className="space-y-3">
                  {currentQuestion.options.map((option) => (
                    <label
                      key={option.id}
                      className={`flex items-center p-4 border-2 rounded-xl cursor-pointer transition-all ${
                        answers[currentQuestion.id] === option.id
                          ? 'border-primary bg-primary-50'
                          : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`question-${currentQuestion.id}`}
                        value={option.id}
                        checked={answers[currentQuestion.id] === option.id}
                        onChange={() => handleAnswer(currentQuestion.id, option.id)}
                        className="sr-only"
                      />
                      <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center mr-4 flex-shrink-0 ${
                        answers[currentQuestion.id] === option.id
                          ? 'border-primary bg-primary text-white'
                          : 'border-gray-300'
                      }`}>
                        <span className="font-semibold">{option.id}</span>
                      </div>
                      <span className="text-gray-700">{option.text}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Notes Section */}
              <div className="card">
                <button
                  onClick={() => setShowNotes(!showNotes)}
                  className="flex items-center space-x-2 text-gray-600 hover:text-primary transition-colors"
                >
                  <StickyNote className="w-5 h-5" />
                  <span className="font-medium">Ghi chú nháp</span>
                  {notes[currentQuestion.id] && (
                    <span className="w-2 h-2 bg-primary rounded-full" />
                  )}
                </button>
                
                <AnimatePresence>
                  {showNotes && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <textarea
                        placeholder="Ghi chú cá nhân cho câu hỏi này... (chỉ bạn thấy)"
                        value={notes[currentQuestion.id] || ''}
                        onChange={(e) => updateNote(currentQuestion.id, e.target.value)}
                        className="w-full mt-3 p-3 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
                        rows={3}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Navigation */}
              <div className="flex items-center justify-between mt-6">
                <button
                  onClick={goPrev}
                  disabled={currentQuestionIndex === 0}
                  className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-5 h-5 mr-1" />
                  Câu trước
                </button>

                {currentQuestionIndex === questions.length - 1 ? (
                  <button
                    onClick={() => handleSubmit(false)}
                    disabled={isSubmitting}
                    className="btn-success"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    ) : (
                      <Send className="w-5 h-5 mr-2" />
                    )}
                    Nộp bài
                  </button>
                ) : (
                  <button
                    onClick={goNext}
                    className="btn-primary"
                  >
                    Câu sau
                    <ChevronRight className="w-5 h-5 ml-1" />
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-80 bg-paper border-l border-gray-200 flex flex-col flex-shrink-0">
        {/* Camera Feed */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-gray-700 flex items-center space-x-2">
              <Camera className="w-4 h-4" />
              <span>Camera Giám Sát</span>
            </h3>
            <div className="flex items-center space-x-1">
              <div className="w-2 h-2 bg-danger rounded-full animate-pulse" />
              <span className="text-xs text-danger font-bold">REC</span>
            </div>
          </div>
          <div className="relative bg-gray-900 rounded-lg overflow-hidden aspect-video">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          </div>
          <p className="text-xs mt-2 text-gray-500 text-center">{status}</p>
        </div>

        {/* Violation Stats */}
        <div className="p-4 border-b border-gray-200 space-y-2">
          <div className="flex items-center justify-between p-2 bg-danger-50 rounded-lg">
            <span className="text-xs text-gray-600">AI Phát hiện</span>
            <span className="font-bold text-danger">{cheatCount}</span>
          </div>
          <div className="flex items-center justify-between p-2 bg-warning-50 rounded-lg">
            <span className="text-xs text-gray-600">Rời tab</span>
            <span className="font-bold text-warning">{tabViolations}</span>
          </div>
          <div className="flex items-center justify-between p-2 bg-warning-50 rounded-lg">
            <span className="text-xs text-gray-600">Thoát fullscreen</span>
            <span className="font-bold text-warning">{fullscreenViolations}</span>
          </div>
          <div className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
            <span className="text-xs text-gray-600">Nhìn ra ngoài</span>
            <span className="font-bold text-gray-600">{gazeAwayCount}</span>
          </div>
        </div>

        {/* Question Navigation */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-gray-700">Danh sách câu hỏi</h3>
            <button
              onClick={() => setShowQuestionNav(!showQuestionNav)}
              className="text-gray-400 hover:text-gray-600"
            >
              {showQuestionNav ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {showQuestionNav && (
            <div className="grid grid-cols-5 gap-2">
              {questions.map((q, idx) => {
                const isAnswered = !!answers[q.id];
                const isFlagged = flaggedQuestions.has(q.id);
                const isCurrent = idx === currentQuestionIndex;

                return (
                  <button
                    key={q.id}
                    onClick={() => goToQuestion(idx)}
                    className={`relative w-10 h-10 rounded-lg font-medium text-sm transition-all ${
                      isCurrent
                        ? 'bg-primary text-white ring-2 ring-primary ring-offset-2'
                        : isAnswered
                        ? 'bg-success-100 text-success-700 hover:bg-success-200'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {idx + 1}
                    {isFlagged && (
                      <Flag className="absolute -top-1 -right-1 w-3 h-3 text-warning fill-warning" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Legend */}
          <div className="mt-4 space-y-1 text-xs text-gray-500">
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 bg-success-100 rounded" />
              <span>Đã trả lời</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 bg-gray-100 rounded" />
              <span>Chưa trả lời</span>
            </div>
            <div className="flex items-center space-x-2">
              <Flag className="w-4 h-4 text-warning fill-warning" />
              <span>Đã gắn cờ</span>
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <div className="p-4 border-t border-gray-200">
          <button
            onClick={() => handleSubmit(false)}
            disabled={isSubmitting}
            className="btn-success w-full py-3"
          >
            {isSubmitting ? (
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            ) : (
              <Send className="w-5 h-5 mr-2" />
            )}
            Nộp bài ({Object.keys(answers).length}/{questions.length})
          </button>
        </div>
      </div>
    </div>
  );
}
