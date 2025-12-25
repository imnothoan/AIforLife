// IntegrityReport.jsx - AI-powered exam integrity analysis component
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Shield, AlertTriangle, CheckCircle, XCircle, Bot, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';

// API URL for backend
const API_URL = import.meta.env.VITE_API_URL || 'https://smartexampro-api.onrender.com';

/**
 * IntegrityReport - Displays AI-analyzed integrity report for an exam session
 * Shows:
 * - Integrity score (0-100)
 * - Risk level (low/medium/high/critical)
 * - AI-generated explanation
 * - Event summary
 */
export default function IntegrityReport({ sessionId, onClose }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchReport = async () => {
    if (!sessionId) {
      setError('No session ID provided');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        setError('Authentication required');
        setLoading(false);
        return;
      }

      const response = await fetch(`${API_URL}/api/ai/integrity-report/${sessionId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        // Provide specific error messages based on status
        let errorMessage = errData.error || 'Không thể tải báo cáo';
        if (response.status === 404) {
          errorMessage = 'Không tìm thấy phiên thi';
        } else if (response.status === 403) {
          errorMessage = 'Bạn không có quyền xem báo cáo này';
        } else if (response.status >= 500) {
          errorMessage = 'Lỗi máy chủ, vui lòng thử lại sau';
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      
      if (data.success && data.report) {
        setReport(data.report);
      } else {
        throw new Error('Invalid report data');
      }
    } catch (err) {
      console.error('[IntegrityReport] Error:', err);
      setError(err.message || 'Failed to load integrity report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [sessionId]);

  // Get color based on risk level
  const getRiskColor = (riskLevel) => {
    switch (riskLevel) {
      case 'low':
        return { bg: 'bg-success-50', border: 'border-success-200', text: 'text-success', label: 'Thấp' };
      case 'medium':
        return { bg: 'bg-warning-50', border: 'border-warning-200', text: 'text-warning-600', label: 'Trung bình' };
      case 'high':
        return { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-600', label: 'Cao' };
      case 'critical':
        return { bg: 'bg-danger-50', border: 'border-danger-200', text: 'text-danger', label: 'Rất cao' };
      default:
        return { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-600', label: 'Chưa xác định' };
    }
  };

  // Get score color
  const getScoreColor = (score) => {
    if (score >= 90) return 'text-success';
    if (score >= 70) return 'text-warning-600';
    if (score >= 50) return 'text-orange-600';
    return 'text-danger';
  };

  // Event type labels
  const EVENT_LABELS = {
    'gaze_away': 'Nhìn ra ngoài',
    'tab_switch': 'Đổi tab',
    'phone_detected': 'Điện thoại',
    'multi_person': 'Nhiều người',
    'fullscreen_exit': 'Thoát fullscreen',
    'face_not_detected': 'Không thấy mặt',
    'material_detected': 'Tài liệu',
    'headphones_detected': 'Tai nghe',
    'copy_paste_attempt': 'Copy/Paste',
    'right_click': 'Click phải',
    'keyboard_shortcut': 'Phím tắt',
    'ai_alert': 'Cảnh báo AI'
  };

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="bg-paper rounded-xl p-6 shadow-lg max-w-lg w-full"
      >
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-8 h-8 text-primary animate-spin mr-3" />
          <span className="text-gray-600">Đang phân tích báo cáo...</span>
        </div>
      </motion.div>
    );
  }

  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="bg-paper rounded-xl p-6 shadow-lg max-w-lg w-full"
      >
        <div className="text-center py-8">
          <XCircle className="w-12 h-12 text-danger mx-auto mb-3" />
          <p className="text-danger font-medium mb-4">{error}</p>
          <div className="flex justify-center space-x-3">
            <button
              onClick={fetchReport}
              className="btn-secondary px-4 py-2 flex items-center"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Thử lại
            </button>
            {onClose && (
              <button onClick={onClose} className="btn-secondary px-4 py-2">
                Đóng
              </button>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  if (!report) return null;

  const riskColors = getRiskColor(report.riskLevel);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-paper rounded-xl shadow-lg max-w-lg w-full overflow-hidden"
    >
      {/* Header */}
      <div className="bg-primary p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-white/20 p-2 rounded-full">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-white">Báo Cáo Độ Tin Cậy AI</h3>
              <p className="text-white/80 text-sm">Phân tích bởi AI Proctor</p>
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-white/80 hover:text-white p-1"
            >
              <XCircle className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Score Section */}
      <div className="p-6">
        <div className="flex items-center justify-center space-x-8 mb-6">
          {/* Score Circle */}
          <div className="relative">
            <svg className="w-32 h-32">
              <circle
                cx="64"
                cy="64"
                r="56"
                fill="none"
                stroke="#e5e7eb"
                strokeWidth="8"
              />
              <circle
                cx="64"
                cy="64"
                r="56"
                fill="none"
                stroke={report.score >= 70 ? '#22c55e' : report.score >= 50 ? '#f59e0b' : '#ef4444'}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${(report.score / 100) * 352} 352`}
                transform="rotate(-90 64 64)"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-3xl font-bold ${getScoreColor(report.score)}`}>
                {report.score}
              </span>
              <span className="text-xs text-gray-500">/100</span>
            </div>
          </div>

          {/* Risk Level */}
          <div className="text-center">
            <p className="text-sm text-gray-500 mb-2">Mức độ rủi ro</p>
            <span className={`inline-block px-4 py-2 rounded-full font-bold ${riskColors.bg} ${riskColors.border} border ${riskColors.text}`}>
              {riskColors.label}
            </span>
          </div>
        </div>

        {/* AI Explanation */}
        <div className="bg-primary-50 rounded-lg p-4 mb-6">
          <div className="flex items-start space-x-3">
            <Bot className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-primary-800 mb-1">Nhận xét AI</p>
              <p className="text-sm text-primary-700">{report.explanation}</p>
            </div>
          </div>
        </div>

        {/* Event Summary */}
        {report.eventSummary && Object.keys(report.eventSummary).length > 0 && (
          <div>
            <h4 className="font-medium text-gray-900 mb-3 flex items-center">
              <AlertTriangle className="w-4 h-4 mr-2 text-warning" />
              Tổng hợp vi phạm ({report.totalEvents} sự kiện)
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(report.eventSummary).map(([type, count]) => (
                <div
                  key={type}
                  className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2"
                >
                  <span className="text-sm text-gray-700">
                    {EVENT_LABELS[type] || type}
                  </span>
                  <span className="font-bold text-gray-900">{count}</span>
                </div>
              ))}
            </div>
            
            {report.criticalEvents > 0 && (
              <p className="text-xs text-danger mt-2 flex items-center">
                <XCircle className="w-3 h-3 mr-1" />
                {report.criticalEvents} sự kiện nghiêm trọng
              </p>
            )}
          </div>
        )}

        {/* No Events */}
        {(!report.eventSummary || Object.keys(report.eventSummary).length === 0) && (
          <div className="text-center py-4">
            <CheckCircle className="w-12 h-12 text-success mx-auto mb-2" />
            <p className="text-success font-medium">Không có vi phạm được ghi nhận</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
