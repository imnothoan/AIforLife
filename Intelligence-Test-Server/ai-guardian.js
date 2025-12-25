// AI Guardian - Live AI Proctoring with Gemini
// Provides intelligent warning messages and integrity reports
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Cache để tránh gọi API quá nhiều
const messageCache = new Map();
const CACHE_TTL = 60000; // 1 phút

// Event descriptions for AI understanding
const EVENT_DESCRIPTIONS = {
  'gaze_away': 'nhìn ra ngoài màn hình',
  'tab_switch': 'chuyển sang tab khác',
  'phone_detected': 'có điện thoại trong khung hình',
  'multi_person': 'có nhiều người trong khung hình',
  'fullscreen_exit': 'thoát chế độ toàn màn hình',
  'face_not_detected': 'không phát hiện khuôn mặt',
  'material_detected': 'có tài liệu/sách trong khung hình',
  'headphones_detected': 'đang sử dụng tai nghe',
  'copy_paste_attempt': 'cố gắng copy/paste',
  'right_click': 'click chuột phải',
  'keyboard_shortcut': 'sử dụng phím tắt bị cấm',
  'speaking_detected': 'phát hiện đang nói chuyện',
  'face_verification_failed': 'xác thực khuôn mặt thất bại'
};

/**
 * Generate intelligent warning message using Gemini AI
 * @param {GoogleGenerativeAI} genAI - Gemini AI instance
 * @param {string} eventType - Type of violation event
 * @param {object} context - Additional context (warningCount, progress)
 * @returns {Promise<string>} AI-generated warning message
 */
async function generateWarningMessage(genAI, eventType, context) {
  if (!genAI) {
    return getDefaultMessage(eventType, context.warningCount);
  }

  // Check cache trước
  const cacheKey = `${eventType}-${context.warningCount}`;
  if (messageCache.has(cacheKey)) {
    const cached = messageCache.get(cacheKey);
    if (Date.now() - cached.time < CACHE_TTL) {
      return cached.message;
    }
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const eventDesc = EVENT_DESCRIPTIONS[eventType] || eventType;
    
    const prompt = `Bạn là AI giám thị của hệ thống thi trực tuyến SmartExamPro.
Sinh viên vừa bị phát hiện hành vi: ${eventDesc}
Đây là lần cảnh báo thứ: ${context.warningCount}
Tiến độ bài thi: ${context.progress}%

Viết một thông báo ngắn gọn (20-40 từ) bằng tiếng Việt để nhắc nhở sinh viên.
- Nếu lần 1-2: giọng nhẹ nhàng, thông cảm
- Nếu lần 3+: giọng nghiêm túc, cảnh báo hậu quả
- Không đe dọa quá mức
- Chỉ trả về nội dung message, không có dấu ngoặc kép hoặc giải thích`;

    const result = await model.generateContent(prompt);
    const message = result.response.text().trim();
    
    // Lưu cache
    messageCache.set(cacheKey, { message, time: Date.now() });
    
    return message;
  } catch (error) {
    console.error('Gemini API error:', error);
    return getDefaultMessage(eventType, context.warningCount);
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
 * @param {GoogleGenerativeAI} genAI - Gemini AI instance
 * @param {object} sessionData - Exam session data with violation counts
 * @param {array} proctoringLogs - Array of proctoring event logs
 * @returns {Promise<object>} Integrity report with score and explanation
 */
async function generateIntegrityReport(genAI, sessionData, proctoringLogs) {
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
  
  // Generate AI explanation if available
  let explanation = '';
  
  if (genAI && proctoringLogs?.length > 0) {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      
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
      console.error('Gemini integrity report error:', error);
      explanation = getDefaultExplanation(score, riskLevel, eventSummary);
    }
  } else {
    explanation = getDefaultExplanation(score, riskLevel, eventSummary);
  }
  
  return {
    score,
    riskLevel,
    explanation,
    eventSummary,
    totalEvents: proctoringLogs?.length || 0,
    criticalEvents: criticalEvents.length
  };
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
