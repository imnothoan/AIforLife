// AIWarningToast.jsx - AI Proctor intelligent warning component
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, X } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * AI Warning Toast - Displays intelligent AI-generated warnings during exams
 * Features:
 * - Smooth animations with Framer Motion
 * - Auto-hide after duration
 * - Manual dismiss
 * - Responsive design
 */
export default function AIWarningToast({ 
  message, 
  onClose, 
  duration = 8000, // Auto-hide after 8 seconds
  severity = 'warning' // 'info' | 'warning' | 'critical'
}) {
  const [isVisible, setIsVisible] = useState(!!message);

  // Auto-hide timer
  useEffect(() => {
    if (!message) {
      setIsVisible(false);
      return;
    }
    
    setIsVisible(true);
    
    const timer = setTimeout(() => {
      setIsVisible(false);
      onClose?.();
    }, duration);

    return () => clearTimeout(timer);
  }, [message, duration, onClose]);

  // Get colors based on severity
  const getColors = () => {
    switch (severity) {
      case 'critical':
        return {
          bg: 'bg-danger-50',
          border: 'border-danger-200',
          icon: 'bg-danger-100',
          iconColor: 'text-danger',
          title: 'text-danger-800',
          text: 'text-danger-700',
          close: 'text-danger-400 hover:text-danger-600'
        };
      case 'info':
        return {
          bg: 'bg-primary-50',
          border: 'border-primary-200',
          icon: 'bg-primary-100',
          iconColor: 'text-primary',
          title: 'text-primary-800',
          text: 'text-primary-700',
          close: 'text-primary-400 hover:text-primary-600'
        };
      default: // warning
        return {
          bg: 'bg-warning-50',
          border: 'border-warning-200',
          icon: 'bg-warning-100',
          iconColor: 'text-warning-600',
          title: 'text-warning-800',
          text: 'text-warning-700',
          close: 'text-warning-400 hover:text-warning-600'
        };
    }
  };

  const colors = getColors();

  const handleClose = () => {
    setIsVisible(false);
    onClose?.();
  };

  return (
    <AnimatePresence>
      {isVisible && message && (
        <motion.div
          initial={{ opacity: 0, y: -50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -50, scale: 0.95 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] max-w-md w-full px-4"
        >
          <div className={`${colors.bg} ${colors.border} border rounded-xl p-4 shadow-lg backdrop-blur-sm`}>
            <div className="flex items-start space-x-3">
              {/* AI Icon */}
              <div className={`${colors.icon} p-2 rounded-full flex-shrink-0`}>
                <Bot className={`w-5 h-5 ${colors.iconColor}`} />
              </div>
              
              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className={`font-medium ${colors.title} flex items-center`}>
                  AI Proctor
                  {severity === 'critical' && (
                    <span className="ml-2 px-1.5 py-0.5 text-[10px] leading-tight uppercase font-bold bg-danger text-white rounded">
                      Nghiêm trọng
                    </span>
                  )}
                </p>
                <p className={`text-sm ${colors.text} mt-1 break-words`}>
                  {message}
                </p>
              </div>
              
              {/* Close button */}
              <button 
                onClick={handleClose} 
                className={`${colors.close} p-1 rounded-lg hover:bg-white/50 transition-colors flex-shrink-0`}
                aria-label="Đóng"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {/* Progress bar for auto-hide */}
            <motion.div
              initial={{ width: '100%' }}
              animate={{ width: '0%' }}
              transition={{ duration: duration / 1000, ease: 'linear' }}
              className={`h-1 ${colors.iconColor} rounded-full mt-3 opacity-30`}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Hook to manage AI warning state
 * Usage:
 * const { showWarning, dismissWarning, aiWarning } = useAIWarning();
 * showWarning('Message here', 'warning');
 */
export function useAIWarning() {
  const [aiWarning, setAiWarning] = useState(null);
  const [severity, setSeverity] = useState('warning');

  const showWarning = (message, warningType = 'warning') => {
    setAiWarning(message);
    setSeverity(warningType);
  };

  const dismissWarning = () => {
    setAiWarning(null);
  };

  return { showWarning, dismissWarning, aiWarning, severity };
}
