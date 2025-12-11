require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { z } = require('zod');
const UAParser = require('ua-parser-js');

const app = express();
const port = process.env.PORT || 3000;

// CORS configuration for production
const corsOptions = {
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// Rate limiting (simple in-memory implementation)
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 100; // max requests per window

function rateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
  } else {
    const record = requestCounts.get(ip);
    if (now > record.resetTime) {
      record.count = 1;
      record.resetTime = now + RATE_LIMIT_WINDOW;
    } else {
      record.count++;
      if (record.count > RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Too many requests', retryAfter: Math.ceil((record.resetTime - now) / 1000) });
      }
    }
  }
  next();
}

app.use(rateLimiter);

// --- Configuration ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

// Validate required environment variables
const isProduction = process.env.NODE_ENV === 'production';

if (!supabaseUrl || !supabaseKey) {
  const errorMsg = 'Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.';
  console.error(errorMsg);
  
  // In production, fail fast - server cannot function without database
  if (isProduction) {
    process.exit(1);
  }
  // In development, continue with warnings for demo endpoints
  console.warn('Server running in demo mode - database operations will fail');
}

const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
const model = genAI ? genAI.getGenerativeModel({ model: "gemini-pro" }) : null;

// Middleware to check if Supabase is configured
function requireSupabase(req, res, next) {
  if (!supabase) {
    return res.status(503).json({ 
      error: 'Database not configured',
      message: 'Server is running in demo mode. Please configure Supabase credentials.'
    });
  }
  next();
}

// --- Validation Schemas (Zod) ---
const SubmitExamSchema = z.object({
  sessionId: z.string().uuid(),
  answers: z.array(z.object({
    questionId: z.string().uuid(),
    answer: z.any(),
    timeSpent: z.number().optional()
  })),
  violations: z.object({
    cheatCount: z.number().min(0),
    tabViolations: z.number().min(0),
    fullscreenViolations: z.number().min(0),
    gazeAwayCount: z.number().min(0).optional(),
    multiScreenDetected: z.boolean().optional()
  })
});

const StartSessionSchema = z.object({
  examId: z.string().uuid(),
  userAgent: z.string().optional(),
});

const GenerateQuestionSchema = z.object({
  topic: z.string().min(1).max(100),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  count: z.number().min(1).max(10).optional(),
  language: z.enum(['vi', 'en']).optional()
});

const LogProctoringSchema = z.object({
  sessionId: z.string().uuid(),
  eventType: z.enum([
    'tab_switch', 'fullscreen_exit', 'multi_screen', 
    'object_detected', 'face_not_detected', 'gaze_away',
    'copy_paste_attempt', 'right_click', 'keyboard_shortcut',
    'remote_desktop_detected', 'screen_share_detected',
    'ai_alert', 'manual_flag'
  ]),
  details: z.any().optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional()
});

// --- Middleware: Auth verification ---
async function verifyAuth(req, res, next) {
  if (!supabase) {
    return res.status(503).json({ error: 'Database not configured' });
  }
  
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token verification failed' });
  }
}

// --- API Endpoints ---

app.get('/', (req, res) => {
  res.send({ 
    status: "ok", 
    message: "SmartExamPro API Server v2.2",
    features: [
      'Exam Management',
      'Anti-Cheat Proctoring',
      'AI Question Generation',
      'Real-time Monitoring'
    ]
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      database: !!supabase,
      ai: !!genAI
    }
  });
});

// --- Auth Endpoints ---

// Validation schema for registration
const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().min(2),
  role: z.enum(['student', 'instructor']).default('student'),
  studentId: z.string().optional().nullable()
});

// Register new user and auto-confirm email
app.post('/api/auth/register', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const validation = RegisterSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ 
      error: 'Dữ liệu không hợp lệ', 
      details: validation.error.errors 
    });
  }

  const { email, password, fullName, role, studentId } = validation.data;

  try {
    // Check if email already exists
    const { data: existingUsers } = await supabase.auth.admin.listUsers();
    const emailExists = existingUsers?.users?.some(u => u.email === email);
    
    if (emailExists) {
      return res.status(400).json({ error: 'Email này đã được đăng ký' });
    }

    // Create user with admin API (auto-confirms email)
    const { data: userData, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        full_name: fullName,
        role: role,
        student_id: studentId
      }
    });

    if (createError) {
      console.error('Create user error:', createError);
      return res.status(400).json({ 
        error: createError.message || 'Không thể tạo tài khoản' 
      });
    }

    // Create profile in profiles table
    if (userData.user) {
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: userData.user.id,
          email: email,
          full_name: fullName,
          role: role,
          student_id: studentId || null
        }, { onConflict: 'id' });

      if (profileError) {
        console.error('Profile creation error:', profileError);
        // Don't fail the request, profile will be created on first login via trigger
      }
    }

    res.json({ 
      success: true, 
      message: 'Đăng ký thành công! Bạn có thể đăng nhập ngay.',
      user: {
        id: userData.user.id,
        email: userData.user.email
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Có lỗi xảy ra khi đăng ký' });
  }
});

// Confirm email for existing unconfirmed users
app.post('/api/auth/confirm-email', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email là bắt buộc' });
  }

  try {
    // Find user by email
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    
    if (listError) throw listError;

    const user = users?.find(u => u.email === email);
    
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy tài khoản với email này' });
    }

    if (user.email_confirmed_at) {
      return res.json({ success: true, message: 'Email đã được xác nhận trước đó' });
    }

    // Confirm email using admin API
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      user.id,
      { email_confirm: true }
    );

    if (updateError) throw updateError;

    res.json({ 
      success: true, 
      message: 'Email đã được xác nhận thành công. Bạn có thể đăng nhập ngay.' 
    });

  } catch (error) {
    console.error('Confirm email error:', error);
    res.status(500).json({ error: 'Có lỗi xảy ra khi xác nhận email' });
  }
});

// --- Exam Session Endpoints ---

// Start exam session
app.post('/api/exam/start', verifyAuth, async (req, res) => {
  const validation = StartSessionSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: "Invalid Input", details: validation.error.errors });
  }

  const { examId, userAgent } = validation.data;
  const parser = new UAParser(userAgent);
  const uaResult = parser.getResult();

  try {
    // Call the database function for atomic session creation
    const { data, error } = await supabase.rpc('start_exam_session', {
      p_exam_id: examId,
      p_user_agent: userAgent,
      p_ip_address: req.ip
    });

    if (error) {
      if (error.message.includes('Maximum attempts')) {
        return res.status(400).json({ error: 'Bạn đã hết lượt thi cho bài này' });
      }
      if (error.message.includes('not available')) {
        return res.status(400).json({ error: 'Bài thi chưa sẵn sàng' });
      }
      if (error.message.includes('not enrolled')) {
        return res.status(403).json({ error: 'Bạn chưa đăng ký lớp học này' });
      }
      throw error;
    }

    // Fetch questions for the exam
    const { data: questions, error: qError } = await supabase
      .from('questions')
      .select('id, question_text, question_type, options, points, order_index')
      .eq('exam_id', examId)
      .order('order_index');

    if (qError) throw qError;

    // Fetch exam details
    const { data: exam, error: examError } = await supabase
      .from('exams')
      .select('*')
      .eq('id', examId)
      .single();

    if (examError) throw examError;

    res.json({
      success: true,
      sessionId: data,
      exam: {
        id: exam.id,
        title: exam.title,
        duration_minutes: exam.duration_minutes,
        require_camera: exam.require_camera,
        require_fullscreen: exam.require_fullscreen,
        max_tab_violations: exam.max_tab_violations,
        max_fullscreen_violations: exam.max_fullscreen_violations
      },
      questions: exam.is_shuffled ? shuffleArray(questions) : questions,
      device: {
        browser: uaResult.browser.name,
        os: uaResult.os.name
      }
    });
  } catch (error) {
    console.error("Start Session Error:", error);
    res.status(500).json({ error: "Có lỗi xảy ra khi bắt đầu bài thi" });
  }
});

// Submit exam
app.post('/api/exam/submit', verifyAuth, async (req, res) => {
  const validation = SubmitExamSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: "Invalid Input", details: validation.error.errors });
  }

  const { sessionId, answers, violations } = validation.data;

  try {
    // Verify session belongs to user
    const { data: session, error: sessionError } = await supabase
      .from('exam_sessions')
      .select('*, exam:exams(*)')
      .eq('id', sessionId)
      .eq('student_id', req.user.id)
      .single();

    if (sessionError || !session) {
      return res.status(403).json({ error: 'Phiên thi không hợp lệ' });
    }

    if (session.status !== 'in_progress') {
      return res.status(400).json({ error: 'Bài thi đã được nộp' });
    }

    // Save answers
    for (const answer of answers) {
      await supabase.rpc('submit_answer', {
        p_session_id: sessionId,
        p_question_id: answer.questionId,
        p_answer: answer.answer,
        p_time_spent: answer.timeSpent || 0
      });
    }

    // Update session with violations
    await supabase
      .from('exam_sessions')
      .update({
        cheat_count: violations.cheatCount,
        tab_violations: violations.tabViolations,
        fullscreen_violations: violations.fullscreenViolations,
        gaze_away_count: violations.gazeAwayCount || 0,
        multi_screen_detected: violations.multiScreenDetected || false
      })
      .eq('id', sessionId);

    // Submit and calculate score
    const { data: result, error: submitError } = await supabase.rpc('submit_exam', {
      p_session_id: sessionId,
      p_auto_submit: false
    });

    if (submitError) throw submitError;

    res.json({
      success: true,
      message: "Nộp bài thành công!",
      result: result
    });
  } catch (error) {
    console.error("Submit Error:", error);
    res.status(500).json({ error: "Có lỗi xảy ra khi nộp bài" });
  }
});

// Log proctoring event
app.post('/api/proctoring/log', verifyAuth, async (req, res) => {
  const validation = LogProctoringSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: "Invalid Input", details: validation.error.errors });
  }

  const { sessionId, eventType, details, severity } = validation.data;

  try {
    const { error } = await supabase
      .from('proctoring_logs')
      .insert({
        session_id: sessionId,
        event_type: eventType,
        details: details || {},
        severity: severity || 'warning',
        timestamp: new Date().toISOString()
      });

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error("Proctoring Log Error:", error);
    res.status(500).json({ error: "Failed to log event" });
  }
});

// --- AI Question Generation ---

app.post('/api/generate-question', verifyAuth, async (req, res) => {
  if (!model) {
    return res.status(503).json({ error: "AI service not available" });
  }

  const validation = GenerateQuestionSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: "Invalid Input", details: validation.error.errors });
  }

  const { topic, difficulty, count = 1, language = 'vi' } = validation.data;
  const lang = language === 'vi' ? 'Vietnamese' : 'English';

  try {
    const prompt = `Create ${count} ${difficulty} multiple-choice question(s) about "${topic}" in ${lang}.
    
Requirements:
- Each question should have exactly 4 options (A, B, C, D)
- Only one correct answer per question
- Questions should test understanding, not just memorization
- Include brief explanation for the correct answer

Format strictly as JSON array:
[{
  "question": "Question text here",
  "options": [
    {"id": "A", "text": "Option A text"},
    {"id": "B", "text": "Option B text"},
    {"id": "C", "text": "Option C text"},
    {"id": "D", "text": "Option D text"}
  ],
  "correctAnswer": "A",
  "explanation": "Brief explanation",
  "difficulty": "${difficulty}"
}]`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // Extract JSON from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('Invalid AI response format');
    }
    
    const questions = JSON.parse(jsonMatch[0]);

    res.json({ success: true, data: questions });
  } catch (error) {
    console.error("Gemini Error:", error);
    res.status(500).json({ error: "Failed to generate question" });
  }
});

// --- Instructor Endpoints ---

// Get exam statistics
app.get('/api/instructor/exam/:examId/stats', verifyAuth, async (req, res) => {
  const { examId } = req.params;

  try {
    // Get exam sessions with aggregated data
    const { data: sessions, error } = await supabase
      .from('exam_sessions')
      .select(`
        id,
        status,
        percentage,
        cheat_count,
        tab_violations,
        fullscreen_violations,
        is_flagged,
        student:profiles(full_name, email, student_id)
      `)
      .eq('exam_id', examId);

    if (error) throw error;

    const stats = {
      totalSessions: sessions.length,
      completed: sessions.filter(s => s.status === 'submitted' || s.status === 'auto_submitted').length,
      inProgress: sessions.filter(s => s.status === 'in_progress').length,
      flagged: sessions.filter(s => s.is_flagged).length,
      averageScore: sessions.filter(s => s.percentage != null).reduce((sum, s) => sum + s.percentage, 0) / 
                    Math.max(1, sessions.filter(s => s.percentage != null).length),
      averageViolations: sessions.reduce((sum, s) => sum + (s.cheat_count || 0) + (s.tab_violations || 0), 0) / 
                         Math.max(1, sessions.length)
    };

    res.json({ success: true, stats, sessions });
  } catch (error) {
    console.error("Stats Error:", error);
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

// Get proctoring logs for a session
app.get('/api/instructor/session/:sessionId/logs', verifyAuth, async (req, res) => {
  const { sessionId } = req.params;

  try {
    const { data: logs, error } = await supabase
      .from('proctoring_logs')
      .select('*')
      .eq('session_id', sessionId)
      .order('timestamp', { ascending: false });

    if (error) throw error;

    res.json({ success: true, logs });
  } catch (error) {
    console.error("Logs Error:", error);
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

// --- Helper Functions ---

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// --- Error Handler ---
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// --- Start Server ---
app.listen(port, () => {
  console.log(`SmartExamPro API Server running on port ${port}`);
  console.log(`Database: ${supabase ? 'Connected' : 'Not configured'}`);
  console.log(`AI: ${genAI ? 'Available' : 'Not configured'}`);
});
