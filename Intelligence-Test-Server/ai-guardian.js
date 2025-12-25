// AI Guardian - Live AI Proctoring with Gemini
// Provides intelligent warning messages and integrity reports
// 
// OPTIMIZATION FOR FREE TIER:
// - Pre-generated messages for common scenarios (no API call needed)
// - Long-term cache (5 minutes) for generated messages
// - Only call API for unique/complex scenarios
// - Fallback to pre-generated messages when rate limited

const { GoogleGenerativeAI } = require("@google/generative-ai");

// ============================================
// CACHING CONFIGURATION
// ============================================
// Cache để tránh gọi API quá nhiều - tăng lên 5 phút
const messageCache = new Map();
const CACHE_TTL = 300000; // 5 phút (tăng từ 1 phút)

// Integrity report cache - cache 10 phút vì ít thay đổi
const reportCache = new Map();
const REPORT_CACHE_TTL = 600000; // 10 phút

// Rate limiting - max 10 requests per minute
const rateLimitWindow = new Map();
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX_REQUESTS = 10;

// ============================================
// PRE-GENERATED MESSAGES (No API call needed)
// ============================================
// Các message được chuẩn bị sẵn cho từng loại vi phạm và mức độ
// Giúp tiết kiệm 90%+ API calls
const PRE_GENERATED_MESSAGES = {
  // Lần 1-2: Nhẹ nhàng
  'gaze_away_1': 'Bạn đang nhìn ra ngoài màn hình. Hãy tập trung vào bài thi nhé!',
  'gaze_away_2': 'Hệ thống ghi nhận bạn nhìn ra ngoài lần thứ 2. Vui lòng giữ tập trung.',
  'tab_switch_1': 'Bạn vừa chuyển tab. Trong quá trình thi, vui lòng chỉ sử dụng tab bài thi.',
  'tab_switch_2': 'Đây là lần chuyển tab thứ 2. Hành vi này đang được ghi nhận.',
  'phone_detected_1': 'Hệ thống phát hiện điện thoại trong khung hình. Vui lòng cất điện thoại đi.',
  'phone_detected_2': 'Điện thoại vẫn xuất hiện trong khung hình lần 2. Hãy để điện thoại xa khỏi bàn thi.',
  'multi_person_1': 'Phát hiện có người khác trong khung hình. Vui lòng đảm bảo chỉ có bạn trong phòng thi.',
  'multi_person_2': 'Lần thứ 2 phát hiện nhiều người. Đây là vi phạm nghiêm trọng.',
  'fullscreen_exit_1': 'Bạn đã thoát chế độ toàn màn hình. Vui lòng quay lại chế độ toàn màn hình.',
  'fullscreen_exit_2': 'Thoát fullscreen lần 2. Hành vi này ảnh hưởng đến độ tin cậy bài thi.',
  'face_not_detected_1': 'Không thấy khuôn mặt của bạn. Hãy đảm bảo camera nhìn rõ mặt bạn.',
  'face_not_detected_2': 'Khuôn mặt không được nhận diện lần 2. Vui lòng điều chỉnh vị trí camera.',
  'material_detected_1': 'Phát hiện tài liệu/sách trong khung hình. Đây là kỳ thi không sử dụng tài liệu.',
  'material_detected_2': 'Tài liệu vẫn xuất hiện lần 2. Vui lòng cất tài liệu ngay.',
  'headphones_detected_1': 'Phát hiện bạn đang sử dụng tai nghe. Vui lòng tháo tai nghe trong khi thi.',
  'headphones_detected_2': 'Tai nghe vẫn được phát hiện lần 2. Đây là vi phạm quy chế thi.',
  
  // Lần 3+: Nghiêm túc
  'gaze_away_3': 'Cảnh báo nghiêm trọng: Đây là lần thứ 3 bạn nhìn ra ngoài. Bài thi có thể bị đánh dấu nghi vấn.',
  'tab_switch_3': 'Cảnh báo: Chuyển tab lần 3. Nếu tiếp tục, bài thi sẽ bị đánh dấu gian lận.',
  'phone_detected_3': 'Cảnh báo cuối: Điện thoại xuất hiện lần 3. Bài thi sẽ bị đánh dấu vi phạm.',
  'multi_person_3': 'Vi phạm nghiêm trọng: Nhiều người trong phòng thi lần 3. Bài thi đang bị giám sát chặt.',
  'fullscreen_exit_3': 'Cảnh báo: Thoát fullscreen lần 3. Tiếp tục vi phạm sẽ ảnh hưởng kết quả.',
  'face_not_detected_3': 'Cảnh báo: Không nhận diện được khuôn mặt lần 3. Vui lòng kiểm tra camera ngay.',
  'material_detected_3': 'Vi phạm nghiêm trọng: Sử dụng tài liệu lần 3. Bài thi đang được đánh dấu.',
  'headphones_detected_3': 'Cảnh báo cuối: Tai nghe lần 3. Hành vi này sẽ được báo cáo giảng viên.',
};

// Event descriptions for AI understanding
const EVENT_DESCRIPTIONS = {
  'gaze_away': 'nhìn ra ngoài màn hình',
  'tab_switch': 'chuyển sang tab khác',
  'phone_detected': 'có điện thoại trong khung hình',
  'phoneDetected': 'có điện thoại trong khung hình',
  'multi_person': 'có nhiều người trong khung hình',
  'multiPerson': 'có nhiều người trong khung hình',
  'fullscreen_exit': 'thoát chế độ toàn màn hình',
  'face_not_detected': 'không phát hiện khuôn mặt',
  'material_detected': 'có tài liệu/sách trong khung hình',
  'materialDetected': 'có tài liệu/sách trong khung hình',
  'headphones_detected': 'đang sử dụng tai nghe',
  'headphonesDetected': 'đang sử dụng tai nghe',
  'copy_paste_attempt': 'cố gắng copy/paste',
  'right_click': 'click chuột phải',
  'keyboard_shortcut': 'sử dụng phím tắt bị cấm',
  'speaking_detected': 'phát hiện đang nói chuyện',
  'face_verification_failed': 'xác thực khuôn mặt thất bại'
};

/**
 * Check rate limit for API calls
 * @returns {boolean} True if within rate limit
 */
function checkRateLimit() {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  
  // Clean old entries
  for (const [time] of rateLimitWindow) {
    if (time < windowStart) {
      rateLimitWindow.delete(time);
    }
  }
  
  // Check limit
  if (rateLimitWindow.size >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  
  rateLimitWindow.set(now, true);
  return true;
}

/**
 * Get pre-generated message if available
 * @param {string} eventType - Type of violation
 * @param {number} warningCount - Warning count
 * @returns {string|null} Pre-generated message or null
 */
function getPreGeneratedMessage(eventType, warningCount) {
  // Normalize event type (handle camelCase variants)
  const normalizedType = eventType.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
  
  // Cap warning count at 3 for pre-generated messages
  const level = Math.min(warningCount, 3);
  const key = `${normalizedType}_${level}`;
  
  return PRE_GENERATED_MESSAGES[key] || null;
}

/**
 * Generate intelligent warning message using Gemini AI
 * OPTIMIZED: Uses pre-generated messages first, then cache, then API
 * 
 * @param {GoogleGenerativeAI} genAI - Gemini AI instance
 * @param {string} eventType - Type of violation event
 * @param {object} context - Additional context (warningCount, progress)
 * @returns {Promise<string>} Warning message
 */
async function generateWarningMessage(genAI, eventType, context) {
  const warningCount = context.warningCount || 1;
  
  // STEP 1: Try pre-generated message first (FREE - no API call)
  const preGenerated = getPreGeneratedMessage(eventType, warningCount);
  if (preGenerated) {
    console.log(`[AI Guardian] Using pre-generated message for ${eventType}_${warningCount}`);
    return preGenerated;
  }
  
  // STEP 2: Check cache (FREE - no API call)
  const cacheKey = `${eventType}-${warningCount}`;
  if (messageCache.has(cacheKey)) {
    const cached = messageCache.get(cacheKey);
    if (Date.now() - cached.time < CACHE_TTL) {
      console.log(`[AI Guardian] Using cached message for ${cacheKey}`);
      return cached.message;
    }
  }
  
  // STEP 3: Use default message if no API or rate limited
  if (!genAI || !checkRateLimit()) {
    console.log(`[AI Guardian] Using default message (no API or rate limited)`);
    return getDefaultMessage(eventType, warningCount);
  }
  
  // STEP 4: Call Gemini API for unique scenarios
  try {
    console.log(`[AI Guardian] Calling Gemini API for ${eventType}_${warningCount}`);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-05-20" });
    const eventDesc = EVENT_DESCRIPTIONS[eventType] || eventType;
    
    const prompt = `Bạn là AI giám thị của hệ thống thi trực tuyến SmartExamPro.
Sinh viên vừa bị phát hiện hành vi: ${eventDesc}
Đây là lần cảnh báo thứ: ${warningCount}
Tiến độ bài thi: ${context.progress}%

Viết một thông báo ngắn gọn (20-40 từ) bằng tiếng Việt để nhắc nhở sinh viên.
- Nếu lần 1-2: giọng nhẹ nhàng, thông cảm
- Nếu lần 3+: giọng nghiêm túc, cảnh báo hậu quả
- Không đe dọa quá mức
- Chỉ trả về nội dung message, không có dấu ngoặc kép hoặc giải thích`;

    const result = await model.generateContent(prompt);
    const message = result.response.text().trim();
    
    // Lưu cache với TTL dài hơn
    messageCache.set(cacheKey, { message, time: Date.now() });
    
    return message;
  } catch (error) {
    console.error('[AI Guardian] Gemini API error:', error.message);
    return getDefaultMessage(eventType, warningCount);
  }
}

/**
 * Get default fallback message when AI is unavailable
 */
function getDefaultMessage(eventType, warningCount) {
  const eventDesc = EVENT_DESCRIPTIONS[eventType] || 'hành vi bất thường';
  
  if (warningCount <= 2) {
    return `Hệ thống phát hiện ${eventDesc}. Vui lòng tập trung vào bài thi.`;
  } else {
    return `Cảnh báo lần ${warningCount}: Phát hiện ${eventDesc}. Nếu tiếp tục vi phạm, bài thi có thể bị đánh dấu.`;
  }
}

/**
 * Generate integrity report after exam submission
 * OPTIMIZED: Cache reports for 10 minutes, use pre-generated explanations when possible
 * 
 * @param {GoogleGenerativeAI} genAI - Gemini AI instance
 * @param {object} sessionData - Exam session data with violation counts
 * @param {array} proctoringLogs - Array of proctoring event logs
 * @returns {Promise<object>} Integrity report with score and explanation
 */
async function generateIntegrityReport(genAI, sessionData, proctoringLogs) {
  // Check cache first using session ID
  const sessionId = sessionData.id;
  if (sessionId && reportCache.has(sessionId)) {
    const cached = reportCache.get(sessionId);
    if (Date.now() - cached.time < REPORT_CACHE_TTL) {
      console.log(`[AI Guardian] Using cached integrity report for session ${sessionId}`);
      return cached.report;
    }
  }
  
  // Calculate base integrity score
  let score = 100;
  
  // Deduct points for violations
  score -= (sessionData.cheat_count || 0) * 10;
  score -= (sessionData.tab_violations || 0) * 5;
  score -= (sessionData.fullscreen_violations || 0) * 5;
  score -= (sessionData.gaze_away_count || 0) * 1;
  score -= (sessionData.face_verification_failures || 0) * 15;
  
  // Critical violations
  const criticalEvents = proctoringLogs?.filter(log => log.severity === 'critical') || [];
  score -= criticalEvents.length * 20;
  
  // Clamp score
  score = Math.max(0, Math.min(100, score));
  
  // Determine risk level
  let riskLevel;
  if (score >= 90) riskLevel = 'low';
  else if (score >= 70) riskLevel = 'medium';
  else if (score >= 50) riskLevel = 'high';
  else riskLevel = 'critical';
  
  // Group events by type for summary
  const eventSummary = {};
  proctoringLogs?.forEach(log => {
    eventSummary[log.event_type] = (eventSummary[log.event_type] || 0) + 1;
  });
  
  // Generate explanation - use default for most cases to save API calls
  // Only call API for critical/high risk cases (need detailed analysis)
  let explanation = '';
  
  const totalEvents = proctoringLogs?.length || 0;
  const shouldCallAPI = genAI && 
                        (riskLevel === 'critical' || riskLevel === 'high') && 
                        totalEvents > 5 &&
                        checkRateLimit();
  
  if (shouldCallAPI) {
    try {
      console.log(`[AI Guardian] Calling Gemini API for integrity report (${riskLevel} risk)`);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-05-20" });
      
      const eventList = Object.entries(eventSummary)
        .map(([type, count]) => `- ${EVENT_DESCRIPTIONS[type] || type}: ${count} lần`)
        .join('\n');
      
      const prompt = `Bạn là AI phân tích độ tin cậy của bài thi trực tuyến.
      
Điểm tin cậy: ${score}/100
Mức độ rủi ro: ${riskLevel === 'low' ? 'thấp' : riskLevel === 'medium' ? 'trung bình' : riskLevel === 'high' ? 'cao' : 'rất cao'}

Các vi phạm được ghi nhận:
${eventList}

Viết một đoạn nhận xét ngắn gọn (50-80 từ) bằng tiếng Việt cho giảng viên về mức độ tin cậy của bài thi này.
- Khách quan, không thiên vị
- Nêu rõ các yếu tố đáng chú ý
- Đề xuất xem xét thêm nếu cần thiết
- Chỉ trả về nội dung nhận xét, không có giải thích`;

      const result = await model.generateContent(prompt);
      explanation = result.response.text().trim();
    } catch (error) {
      console.error('[AI Guardian] Gemini integrity report error:', error.message);
      explanation = getDefaultExplanation(score, riskLevel, eventSummary);
    }
  } else {
    // Use pre-generated explanation (FREE - no API call)
    console.log(`[AI Guardian] Using pre-generated explanation for ${riskLevel} risk`);
    explanation = getDefaultExplanation(score, riskLevel, eventSummary);
  }
  
  const report = {
    score,
    riskLevel,
    explanation,
    eventSummary,
    totalEvents: proctoringLogs?.length || 0,
    criticalEvents: criticalEvents.length
  };
  
  // Cache report for future requests
  if (sessionId) {
    reportCache.set(sessionId, { report, time: Date.now() });
  }
  
  return report;
}

/**
 * Get default explanation when AI is unavailable
 */
function getDefaultExplanation(score, riskLevel, eventSummary) {
  const eventCount = Object.values(eventSummary).reduce((a, b) => a + b, 0);
  
  if (riskLevel === 'low') {
    return `Bài thi có độ tin cậy cao (${score}/100). Sinh viên thực hiện bài thi nghiêm túc với ít hoặc không có vi phạm đáng kể.`;
  } else if (riskLevel === 'medium') {
    return `Bài thi có độ tin cậy trung bình (${score}/100). Ghi nhận ${eventCount} sự kiện vi phạm nhẹ. Có thể xem xét kết quả như bình thường.`;
  } else if (riskLevel === 'high') {
    return `Bài thi có độ tin cậy thấp (${score}/100). Ghi nhận nhiều vi phạm. Đề xuất xem xét lại bằng chứng trước khi công nhận kết quả.`;
  } else {
    return `Cảnh báo: Bài thi có độ tin cậy rất thấp (${score}/100). Phát hiện nhiều vi phạm nghiêm trọng. Cần xem xét kỹ bằng chứng và có thể yêu cầu sinh viên giải trình.`;
  }
}

module.exports = {
  generateWarningMessage,
  generateIntegrityReport,
  EVENT_DESCRIPTIONS
};
