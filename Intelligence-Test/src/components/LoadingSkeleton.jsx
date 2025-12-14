// ============================================
// LOADING SKELETON COMPONENTS
// Provides visual feedback during loading states
// ============================================

import { motion } from 'framer-motion';

// Shimmer animation effect
const shimmer = {
  initial: { x: '-100%' },
  animate: { x: '100%' },
  transition: {
    repeat: Infinity,
    duration: 1.5,
    ease: 'linear',
  },
};

// Base skeleton with shimmer effect
function SkeletonBase({ className = '', children }) {
  return (
    <div className={`relative overflow-hidden bg-gray-200 rounded ${className}`}>
      <motion.div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent"
        initial={shimmer.initial}
        animate={shimmer.animate}
        transition={shimmer.transition}
      />
      {children}
    </div>
  );
}

// Text line skeleton
export function SkeletonText({ lines = 1, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBase
          key={i}
          className={`h-4 ${i === lines - 1 && lines > 1 ? 'w-3/4' : 'w-full'}`}
        />
      ))}
    </div>
  );
}

// Avatar/circle skeleton
export function SkeletonAvatar({ size = 'md', className = '' }) {
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
    xl: 'w-24 h-24',
  };
  
  return (
    <SkeletonBase className={`rounded-full ${sizeClasses[size]} ${className}`} />
  );
}

// Card skeleton
export function SkeletonCard({ className = '' }) {
  return (
    <div className={`bg-paper rounded-xl p-4 shadow-sm ${className}`}>
      <div className="flex items-start space-x-4">
        <SkeletonAvatar size="md" />
        <div className="flex-1 space-y-3">
          <SkeletonText lines={1} className="w-1/2" />
          <SkeletonText lines={2} />
        </div>
      </div>
    </div>
  );
}

// Table row skeleton
export function SkeletonTableRow({ cols = 4, className = '' }) {
  return (
    <tr className={className}>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <SkeletonBase className="h-4 w-full" />
        </td>
      ))}
    </tr>
  );
}

// Button skeleton
export function SkeletonButton({ className = '' }) {
  return <SkeletonBase className={`h-10 w-24 rounded-lg ${className}`} />;
}

// Exam card skeleton for dashboard
export function SkeletonExamCard({ className = '' }) {
  return (
    <div className={`bg-paper rounded-xl p-5 shadow-sm ${className}`}>
      <div className="space-y-4">
        <div className="flex justify-between items-start">
          <SkeletonBase className="h-6 w-2/3" />
          <SkeletonBase className="h-6 w-16 rounded-full" />
        </div>
        <SkeletonText lines={2} />
        <div className="flex justify-between items-center pt-2">
          <SkeletonBase className="h-4 w-24" />
          <SkeletonButton />
        </div>
      </div>
    </div>
  );
}

// Full page loading overlay
export function LoadingOverlay({ message = 'Đang tải...' }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-paper rounded-2xl p-8 shadow-lg text-center"
      >
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-text-main font-medium">{message}</p>
      </motion.div>
    </motion.div>
  );
}

// Inline spinner
export function Spinner({ size = 'md', className = '' }) {
  const sizeClasses = {
    sm: 'w-4 h-4 border-2',
    md: 'w-6 h-6 border-2',
    lg: 'w-8 h-8 border-3',
    xl: 'w-12 h-12 border-4',
  };
  
  return (
    <div
      className={`${sizeClasses[size]} border-primary border-t-transparent rounded-full animate-spin ${className}`}
      role="status"
      aria-label="Loading"
    />
  );
}

// Progress bar
export function ProgressBar({ value = 0, max = 100, className = '', showLabel = true }) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  
  return (
    <div className={`space-y-1 ${className}`}>
      {showLabel && (
        <div className="flex justify-between text-sm text-gray-600">
          <span>Tiến độ</span>
          <span>{Math.round(percentage)}%</span>
        </div>
      )}
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="h-full bg-primary rounded-full"
        />
      </div>
    </div>
  );
}

export default {
  SkeletonText,
  SkeletonAvatar,
  SkeletonCard,
  SkeletonTableRow,
  SkeletonButton,
  SkeletonExamCard,
  LoadingOverlay,
  Spinner,
  ProgressBar,
};
