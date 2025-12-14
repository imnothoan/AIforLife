import React, { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'react-toastify';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { supabase } from '../lib/supabase';
import { 
  Flag, FlagOff, StickyNote, ChevronLeft, ChevronRight, 
  Clock, Camera, AlertTriangle, Send, Monitor, Wifi, WifiOff,
  Eye, EyeOff, Shield, XCircle, CheckCircle, Loader2, User
} from 'lucide-react';
import FaceVerification from '../components/FaceVerification';

// Remote desktop detection signatures
const REMOTE_DESKTOP_SIGNATURES = [
  'teamviewer', 'anydesk', 'ultraviewer', 'parsec', 'vnc',
  'remotedesktop', 'citrix', 'logmein', 'splashtop', 'chrome remote',
  'microsoft remote', 'rdp', 'ammyy', 'supremo'
];

export default function Exam() {
  const { id: examId } = useParams();
  const { user, profile } = useAuth();
  const { t } = useLanguage();
  const videoRef = useRef(null);
  const workerRef = useRef(null);
  const timerRef = useRef(null);
  const randomVerifyRef = useRef(null);
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
  const [status, setStatus] = useState(null);
  const [cheatCount, setCheatCount] = useState(0);
  const [tabViolations, setTabViolations] = useState(0);
  const [fullscreenViolations, setFullscreenViolations] = useState(0);
  const [gazeAwayCount, setGazeAwayCount] = useState(0);

  // Face Verification State
  const [showFaceVerification, setShowFaceVerification] = useState(false);
  const [faceVerificationMode, setFaceVerificationMode] = useState('verify'); // 'enroll' | 'verify' | 'random'
  const [storedFaceEmbedding, setStoredFaceEmbedding] = useState(null);
  const [faceVerificationCount, setFaceVerificationCount] = useState(0);
  const [pendingVerificationCallback, setPendingVerificationCallback] = useState(null);

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
  
  // Detect Safari browser
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  
  const enterFullscreen = async () => {
    try {
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) {
        await docEl.requestFullscreen();
      } else if (docEl.webkitRequestFullscreen) {
        // Safari
        await docEl.webkitRequestFullscreen();
      } else if (docEl.mozRequestFullScreen) {
        await docEl.mozRequestFullScreen();
      } else if (docEl.msRequestFullscreen) {
        await docEl.msRequestFullscreen();
      }
      setIsFullscreen(true);
    } catch (e) {
      // Safari may not fully support fullscreen API - allow exam to continue
      if (isSafari) {
        console.warn("Safari fullscreen not fully supported, continuing without fullscreen requirement");
        setIsFullscreen(true); // Treat as fullscreen on Safari
      } else {
        toast.error("Bạn phải bật chế độ Toàn màn hình để thi!");
      }
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      // Check for different browsers
      const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement || 
                        document.mozFullScreenElement || document.msFullscreenElement);
      setIsFullscreen(isFull);
      
      // Don't trigger violation if submitting or on Safari (which has limited support)
      if (!isFull && examStarted && !isSubmitting) {
        // On Safari, fullscreen exit may happen during submit - ignore it
        if (isSafari) {
          console.warn("Safari fullscreen state change - continuing without violation");
          return;
        }
        
        setFullscreenViolations(prev => {
          const newVal = prev + 1;
          toast.error(`CẢNH BÁO: Bạn đã thoát toàn màn hình ${newVal} lần!`);
          logProctoring('fullscreen_exit', { count: newVal });
          return newVal;
        });
      }
    };
    
    // Listen to both standard and webkit (Safari) events
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, [examStarted, isSubmitting, isSafari]);

  // ============================================
  // TAB VISIBILITY DETECTION
  // ============================================
  useEffect(() => {
    const handleVisibilityChange = () => {
      // Don't trigger violation if submitting
      if (document.hidden && examStarted && !isSubmitting) {
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
  }, [examStarted, isSubmitting]);

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
      // Check if demo mode
      const isDemo = examId === 'demo' || examId === '1';
      
      if (isDemo) {
        // Demo mode - use mock data for testing
        setExamData({
          id: examId,
          title: 'Trí tuệ nhân tạo (AI) - BÀI THI MẪU',
          code: 'INT3401',
          duration_minutes: 45,
          require_camera: true,
          require_fullscreen: true
        });

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

        setTimeRemaining(45 * 60);
        setSessionId('demo-session');
        return;
      }

      // Production mode - fetch from Supabase
      try {
        // Fetch exam data
        const { data: exam, error: examError } = await supabase
          .from('exams')
          .select(`
            *,
            class:classes(name, code)
          `)
          .eq('id', examId)
          .single();

        if (examError) {
          console.error('Failed to load exam:', examError);
          toast.error('Không thể tải thông tin bài thi');
          navigate('/');
          return;
        }

        // Check if exam is available
        const now = new Date();
        const startTime = new Date(exam.start_time);
        const endTime = new Date(exam.end_time);

        if (exam.status !== 'published') {
          toast.error('Bài thi này chưa được công bố');
          navigate('/');
          return;
        }

        if (now < startTime) {
          toast.error('Bài thi chưa bắt đầu');
          navigate('/');
          return;
        }

        if (now > endTime) {
          toast.error('Bài thi đã kết thúc');
          navigate('/');
          return;
        }

        setExamData({
          id: exam.id,
          title: exam.title,
          code: exam.class?.code || 'N/A',
          duration_minutes: exam.duration_minutes,
          require_camera: exam.require_camera,
          require_fullscreen: exam.require_fullscreen,
          max_tab_violations: exam.max_tab_violations,
          max_fullscreen_violations: exam.max_fullscreen_violations
        });

        // Fetch questions
        const { data: questionsData, error: questionsError } = await supabase
          .from('questions')
          .select('id, question_text, question_type, options, points, order_index')
          .eq('exam_id', examId)
          .order('order_index');

        if (questionsError) {
          console.error('Failed to load questions:', questionsError);
          toast.error('Không thể tải câu hỏi');
          navigate('/');
          return;
        }

        // Shuffle questions if required
        const finalQuestions = exam.is_shuffled 
          ? shuffleArray(questionsData) 
          : questionsData;

        setQuestions(finalQuestions);
        setTimeRemaining(exam.duration_minutes * 60);

        // Check for existing session or create new one
        const { data: existingSession } = await supabase
          .from('exam_sessions')
          .select('id, status, started_at')
          .eq('exam_id', examId)
          .eq('student_id', user?.id)
          .eq('status', 'in_progress')
          .single();

        if (existingSession) {
          // Resume existing session
          setSessionId(existingSession.id);
          
          // Calculate remaining time using UTC timestamps to avoid timezone issues
          // Supabase returns timestamps in ISO format with timezone info
          const startedAtUTC = new Date(existingSession.started_at).getTime();
          const nowUTC = Date.now();
          const elapsedSeconds = Math.floor((nowUTC - startedAtUTC) / 1000);
          const remaining = Math.max(0, exam.duration_minutes * 60 - elapsedSeconds);
          setTimeRemaining(remaining);

          // If time has already expired, auto-submit
          if (remaining === 0) {
            toast.warning('Thời gian thi đã hết!');
            setExamStarted(true);
            handleAutoSubmit();
            return;
          }

          // Load existing answers
          const { data: existingAnswers } = await supabase
            .from('answers')
            .select('question_id, student_answer, is_flagged, student_notes')
            .eq('session_id', existingSession.id);

          if (existingAnswers) {
            const answersMap = {};
            const flaggedSet = new Set();
            const notesMap = {};
            
            existingAnswers.forEach(a => {
              answersMap[a.question_id] = a.student_answer;
              if (a.is_flagged) flaggedSet.add(a.question_id);
              if (a.student_notes) notesMap[a.question_id] = a.student_notes;
            });

            setAnswers(answersMap);
            setFlaggedQuestions(flaggedSet);
            setNotes(notesMap);
          }

          toast.info('Đã khôi phục phiên thi trước đó');
        }

      } catch (error) {
        console.error('Error loading exam:', error);
        toast.error('Có lỗi xảy ra khi tải bài thi');
        navigate('/');
      }
    };

    // Helper function to shuffle array
    const shuffleArray = (array) => {
      const shuffled = [...array];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    };

    loadExamData();
  }, [examId, user, navigate]);

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
  // FACE VERIFICATION HANDLERS
  // ============================================
  
  // Load stored face embedding from profile
  useEffect(() => {
    const loadFaceEmbedding = async () => {
      if (!user?.id) return;
      
      try {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('face_embedding')
          .eq('id', user.id)
          .single();
        
        if (profileData?.face_embedding) {
          setStoredFaceEmbedding(profileData.face_embedding);
        }
      } catch (error) {
        console.warn('Could not load face embedding:', error);
      }
    };
    
    loadFaceEmbedding();
  }, [user?.id]);

  // Schedule random face verifications during exam
  useEffect(() => {
    if (!examStarted || !sessionId) return;
    
    // Skip random verification in demo mode
    const isDemo = examId === 'demo' || examId === '1';
    if (isDemo) return;
    
    // Schedule 2-3 random verifications during exam
    const examDuration = (examData?.duration_minutes || 60) * 60 * 1000;
    const numChecks = Math.floor(Math.random() * 2) + 2; // 2-3 checks
    const intervals = [];
    
    for (let i = 0; i < numChecks; i++) {
      // Random time between 20% and 80% of exam duration
      const minTime = examDuration * 0.2;
      const maxTime = examDuration * 0.8;
      const checkTime = minTime + Math.random() * (maxTime - minTime);
      
      const timeout = setTimeout(() => {
        // Only trigger if exam is still in progress
        if (examStarted && !isSubmitting && !showFaceVerification) {
          triggerRandomVerification();
        }
      }, checkTime);
      
      intervals.push(timeout);
    }
    
    randomVerifyRef.current = intervals;
    
    return () => {
      intervals.forEach(clearTimeout);
    };
  }, [examStarted, sessionId, examId, examData?.duration_minutes]);

  const triggerRandomVerification = () => {
    setFaceVerificationMode('random');
    setShowFaceVerification(true);
    logProctoring('face_verification_triggered', { type: 'random' });
  };

  const handleFaceVerificationSuccess = async (similarity) => {
    setShowFaceVerification(false);
    setFaceVerificationCount(prev => prev + 1);
    
    // Log successful verification
    if (sessionId && sessionId !== 'demo-session-id') {
      try {
        await supabase.rpc('log_face_verification', {
          p_session_id: sessionId,
          p_verification_type: faceVerificationMode,
          p_similarity_score: similarity || 1.0,
          p_is_match: true
        });
      } catch (error) {
        console.warn('Could not log face verification:', error);
      }
    }
    
    toast.success(t('face.success'));
    
    // Execute pending callback if any
    if (pendingVerificationCallback) {
      pendingVerificationCallback();
      setPendingVerificationCallback(null);
    }
  };

  const handleFaceVerificationFailure = async (reason, similarity) => {
    // Log failed verification
    if (sessionId && sessionId !== 'demo-session-id') {
      try {
        await supabase.rpc('log_face_verification', {
          p_session_id: sessionId,
          p_verification_type: faceVerificationMode,
          p_similarity_score: similarity || 0,
          p_is_match: false,
          p_error_reason: reason
        });
      } catch (error) {
        console.warn('Could not log face verification:', error);
      }
    }
    
    logProctoring('face_verification_failed', { reason, similarity, type: faceVerificationMode });
    
    // For random checks, just warn but don't block
    if (faceVerificationMode === 'random') {
      toast.warning(t('face.mismatch'));
      setCheatCount(prev => prev + 1);
      setShowFaceVerification(false);
    }
    // For start/submit verifications, they can retry (handled in FaceVerification component)
  };

  const handleFaceEnrollComplete = async (embedding, imageUrl) => {
    setStoredFaceEmbedding(embedding);
    setShowFaceVerification(false);
    
    // Save embedding to profile
    if (user?.id) {
      try {
        await supabase.rpc('update_face_embedding', {
          p_embedding: embedding,
          p_image_url: imageUrl
        });
      } catch (error) {
        console.warn('Could not save face embedding:', error);
      }
    }
    
    toast.success(t('face.enrollSuccess'));
    
    // Execute pending callback
    if (pendingVerificationCallback) {
      pendingVerificationCallback();
      setPendingVerificationCallback(null);
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
  // AUTO-SAVE ANSWERS (every 30 seconds)
  // ============================================
  useEffect(() => {
    if (!examStarted || !sessionId) return;
    
    const isDemo = examId === 'demo' || examId === '1';
    if (isDemo) return; // Don't auto-save in demo mode

    // Track last saved answers to detect changes
    let lastSavedAnswers = { ...answers };
    let lastSavedFlags = new Set(flaggedQuestions);
    let lastSavedNotes = { ...notes };

    const saveAnswers = async () => {
      try {
        // Find all modified answers since last save
        const modifiedQuestions = questions.filter(q => {
          const answerChanged = answers[q.id] !== lastSavedAnswers[q.id];
          const flagChanged = flaggedQuestions.has(q.id) !== lastSavedFlags.has(q.id);
          const noteChanged = notes[q.id] !== lastSavedNotes[q.id];
          return answerChanged || flagChanged || noteChanged;
        });

        if (modifiedQuestions.length === 0) return;

        // Batch upsert all modified answers
        const answersToUpsert = modifiedQuestions.map(q => ({
          session_id: sessionId,
          question_id: q.id,
          student_answer: answers[q.id] || null,
          is_flagged: flaggedQuestions.has(q.id),
          student_notes: notes[q.id] || null
        }));

        const { error } = await supabase
          .from('answers')
          .upsert(answersToUpsert, { onConflict: 'session_id,question_id' });

        if (error) throw error;

        // Update last saved state
        lastSavedAnswers = { ...answers };
        lastSavedFlags = new Set(flaggedQuestions);
        lastSavedNotes = { ...notes };
      } catch (err) {
        console.error('Auto-save error:', err);
        // Don't notify user for auto-save failures to avoid distraction
      }
    };

    const autoSaveInterval = setInterval(saveAnswers, 30000); // Every 30 seconds
    
    return () => clearInterval(autoSaveInterval);
  }, [examStarted, sessionId, examId, questions, answers, flaggedQuestions, notes]);

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
      const isDemo = examId === 'demo' || examId === '1';
      
      if (isDemo) {
        // Demo scoring - for testing purposes only
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
        // Production: Submit answers to database
        // Batch upsert all answers at once for better performance
        const answersToInsert = questions.map(q => ({
          session_id: sessionId,
          question_id: q.id,
          student_answer: answers[q.id] || null,
          is_flagged: flaggedQuestions.has(q.id),
          student_notes: notes[q.id] || null
        }));

        // Batch upsert answers
        const { error: answersError } = await supabase
          .from('answers')
          .upsert(answersToInsert, { onConflict: 'session_id,question_id' });

        if (answersError) {
          console.error('Error saving answers:', answersError);
          throw new Error('Không thể lưu câu trả lời');
        }

        // Update session with violation counts first (before submit)
        const { error: violationError } = await supabase
          .from('exam_sessions')
          .update({
            cheat_count: cheatCount,
            tab_violations: tabViolations,
            fullscreen_violations: fullscreenViolations,
            gaze_away_count: gazeAwayCount
          })
          .eq('id', sessionId);

        if (violationError) {
          console.error('Error saving violations:', violationError);
          // Continue with submission even if violation update fails
          // The core exam data is more important
        }

        // Submit exam via RPC function
        const { data: result, error: submitError } = await supabase
          .rpc('submit_exam', {
            p_session_id: sessionId,
            p_auto_submit: isAuto
          });

        if (submitError) {
          throw submitError;
        }

        if (result) {
          const percentage = result.percentage || 0;
          const passed = result.passed;
          toast.success(
            `Nộp bài thành công! Điểm: ${percentage.toFixed(1)}% ${passed ? '✓ Đạt' : '✗ Không đạt'}`
          );
        } else {
          toast.success("Nộp bài thành công!");
        }
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
      toast.error(t('anticheat.remoteDesktop'), { autoClose: false });
      return;
    }

    // Check screens
    const screenSafe = await checkScreens();
    if (!screenSafe) return;

    // Enter fullscreen
    await enterFullscreen();
    
    const isDemo = examId === 'demo' || examId === '1';
    
    // For production mode, require face verification before starting
    if (!isDemo && examData?.require_camera !== false) {
      // Check if user has enrolled face
      if (!storedFaceEmbedding) {
        // Need to enroll face first
        setFaceVerificationMode('enroll');
        setPendingVerificationCallback(() => proceedWithExamStart);
        setShowFaceVerification(true);
        return;
      } else {
        // Verify face before starting
        setFaceVerificationMode('verify');
        setPendingVerificationCallback(() => proceedWithExamStart);
        setShowFaceVerification(true);
        return;
      }
    }
    
    // Demo mode or camera not required - start directly
    await proceedWithExamStart();
  };

  const proceedWithExamStart = async () => {
    const isDemo = examId === 'demo' || examId === '1';
    
    if (isDemo) {
      // Demo mode - use mock session
      setSessionId('demo-session-id');
    } else if (!sessionId && user) {
      // Production mode - create a new session in database
      try {
        const { data: newSessionId, error } = await supabase
          .rpc('start_exam_session', {
            p_exam_id: examId,
            p_user_agent: navigator.userAgent,
            p_ip_address: null // IP is captured server-side
          });

        if (error) {
          console.error('Failed to create session:', error);
          if (error.message.includes('Maximum attempts')) {
            toast.error(t('error.general'));
          } else if (error.message.includes('not enrolled')) {
            toast.error(t('error.permission'));
          } else {
            toast.error(t('error.general'));
          }
          return;
        }

        setSessionId(newSessionId);
      } catch (err) {
        console.error('Session creation error:', err);
        toast.error(t('error.general'));
        return;
      }
    }
    
    setExamStarted(true);
    toast.info(t('common.success'));
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
            <h2 className="text-2xl font-bold text-text-main">{t('exam.rules.title')}</h2>
            <p className="text-gray-500 mt-1">{examData?.title || t('common.loading')}</p>
          </div>

          <div className="space-y-3 mb-6">
            <div className="flex items-start space-x-3 p-3 bg-success-50 rounded-lg">
              <CheckCircle className="w-5 h-5 text-success mt-0.5 flex-shrink-0" />
              <span className="text-sm text-gray-700">{t('exam.rules.camera')}</span>
            </div>
            <div className="flex items-start space-x-3 p-3 bg-success-50 rounded-lg">
              <CheckCircle className="w-5 h-5 text-success mt-0.5 flex-shrink-0" />
              <span className="text-sm text-gray-700">{t('exam.rules.fullscreen')}</span>
            </div>
            <div className="flex items-start space-x-3 p-3 bg-danger-50 rounded-lg">
              <XCircle className="w-5 h-5 text-danger mt-0.5 flex-shrink-0" />
              <span className="text-sm text-gray-700">{t('exam.rules.noMultiScreen')}</span>
            </div>
            <div className="flex items-start space-x-3 p-3 bg-danger-50 rounded-lg">
              <XCircle className="w-5 h-5 text-danger mt-0.5 flex-shrink-0" />
              <span className="text-sm text-gray-700">{t('exam.rules.noTabSwitch')}</span>
            </div>
            <div className="flex items-start space-x-3 p-3 bg-danger-50 rounded-lg">
              <XCircle className="w-5 h-5 text-danger mt-0.5 flex-shrink-0" />
              <span className="text-sm text-gray-700">{t('exam.rules.noRemoteDesktop')}</span>
            </div>
          </div>

          {/* Warnings */}
          {hasMultiScreen && (
            <div className="p-4 bg-danger-100 border border-danger-200 rounded-lg mb-4 flex items-center space-x-3">
              <Monitor className="w-6 h-6 text-danger" />
              <span className="text-sm font-bold text-danger">{t('anticheat.multiScreen')}</span>
            </div>
          )}

          {remoteDesktopDetected && (
            <div className="p-4 bg-danger-100 border border-danger-200 rounded-lg mb-4 flex items-center space-x-3">
              <AlertTriangle className="w-6 h-6 text-danger" />
              <span className="text-sm font-bold text-danger">{t('anticheat.remoteDesktop')}</span>
            </div>
          )}

          {/* Camera preview */}
          <div className="mb-6">
            <p className="text-sm font-medium text-gray-700 mb-2">{t('exam.rules.cameraCheck')}</p>
            <div className="relative bg-gray-900 rounded-lg overflow-hidden aspect-video">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              <div className="absolute bottom-2 left-2 flex items-center space-x-1 bg-black/50 text-white text-xs px-2 py-1 rounded">
                <Camera className="w-3 h-3" />
                <span>{t('proctoring.camera')}</span>
              </div>
            </div>
          </div>

          <button 
            onClick={handleStartExam} 
            disabled={hasMultiScreen || remoteDesktopDetected}
            className="btn-primary w-full py-3 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Shield className="w-5 h-5 mr-2" />
            {t('exam.rules.agree')}
          </button>
        </motion.div>
        
        {/* Face Verification Modal */}
        <AnimatePresence>
          {showFaceVerification && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
            >
              <FaceVerification
                mode={faceVerificationMode}
                storedEmbedding={storedFaceEmbedding}
                onSuccess={handleFaceVerificationSuccess}
                onFailure={handleFaceVerificationFailure}
                onEnrollComplete={handleFaceEnrollComplete}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ============================================
  // MAIN EXAM UI
  // ============================================
  return (
    <div className="flex h-screen bg-background no-select">
      {/* Face Verification Modal for random checks */}
      <AnimatePresence>
        {showFaceVerification && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4"
          >
            <FaceVerification
              mode={faceVerificationMode}
              storedEmbedding={storedFaceEmbedding}
              onSuccess={handleFaceVerificationSuccess}
              onFailure={handleFaceVerificationFailure}
              onEnrollComplete={handleFaceEnrollComplete}
            />
          </motion.div>
        )}
      </AnimatePresence>
      
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
              <span>{t('anticheat.networkOffline')}</span>
            </div>
          </motion.div>
        )}

        {/* Fullscreen Exit Warning - Don't show when submitting or on Safari */}
        {!isFullscreen && !isSubmitting && !isSafari && (
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
                  {t('common.previous')}
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
                    {t('common.submit')}
                  </button>
                ) : (
                  <button
                    onClick={goNext}
                    className="btn-primary"
                  >
                    {t('common.next')}
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
              <span>{t('proctoring.camera')}</span>
            </h3>
            <div className="flex items-center space-x-1">
              <div className="w-2 h-2 bg-danger rounded-full animate-pulse" />
              <span className="text-xs text-danger font-bold">{t('proctoring.recording')}</span>
            </div>
          </div>
          <div className="relative bg-gray-900 rounded-lg overflow-hidden aspect-video">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          </div>
          <p className="text-xs mt-2 text-gray-500 text-center">{status || t('common.loading')}</p>
        </div>

        {/* Violation Stats */}
        <div className="p-4 border-b border-gray-200 space-y-2">
          <div className="flex items-center justify-between p-2 bg-danger-50 rounded-lg">
            <span className="text-xs text-gray-600">{t('proctoring.aiDetection')}</span>
            <span className="font-bold text-danger">{cheatCount}</span>
          </div>
          <div className="flex items-center justify-between p-2 bg-warning-50 rounded-lg">
            <span className="text-xs text-gray-600">{t('proctoring.tabViolations')}</span>
            <span className="font-bold text-warning">{tabViolations}</span>
          </div>
          <div className="flex items-center justify-between p-2 bg-warning-50 rounded-lg">
            <span className="text-xs text-gray-600">{t('proctoring.fullscreenViolations')}</span>
            <span className="font-bold text-warning">{fullscreenViolations}</span>
          </div>
          <div className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
            <span className="text-xs text-gray-600">{t('proctoring.gazeAway')}</span>
            <span className="font-bold text-gray-600">{gazeAwayCount}</span>
          </div>
        </div>

        {/* Question Navigation */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-gray-700">{t('proctoring.questionList')}</h3>
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
              <span>{t('proctoring.answered')}</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 bg-gray-100 rounded" />
              <span>{t('proctoring.unanswered')}</span>
            </div>
            <div className="flex items-center space-x-2">
              <Flag className="w-4 h-4 text-warning fill-warning" />
              <span>{t('proctoring.flagged')}</span>
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
            {t('common.submit')} ({Object.keys(answers).length}/{questions.length})
          </button>
        </div>
      </div>
    </div>
  );
}
