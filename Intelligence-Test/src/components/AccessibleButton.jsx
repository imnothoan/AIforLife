// ============================================
// ACCESSIBLE BUTTON COMPONENT
// Fully accessible button with loading state, icons, and keyboard support
// ============================================

import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

const variants = {
  primary: 'bg-primary text-white hover:bg-primary-dark focus:ring-primary/50',
  secondary: 'bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-gray-300',
  danger: 'bg-danger text-white hover:bg-red-700 focus:ring-red-300',
  success: 'bg-success text-white hover:bg-green-700 focus:ring-green-300',
  ghost: 'bg-transparent text-gray-600 hover:bg-gray-100 focus:ring-gray-200',
  outline: 'border-2 border-primary text-primary hover:bg-primary/10 focus:ring-primary/30',
};

const sizes = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-6 py-3 text-lg',
  xl: 'px-8 py-4 text-xl',
};

const AccessibleButton = forwardRef(function AccessibleButton({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon: Icon,
  iconPosition = 'left',
  fullWidth = false,
  type = 'button',
  onClick,
  ariaLabel,
  className = '',
  ...props
}, ref) {
  const isDisabled = disabled || loading;
  
  const handleClick = (e) => {
    if (isDisabled) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };
  
  const handleKeyDown = (e) => {
    // Only handle Space key - Enter naturally triggers button click
    if (e.key === ' ' && !isDisabled) {
      e.preventDefault();
      onClick?.(e);
    }
  };

  return (
    <motion.button
      ref={ref}
      type={type}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      disabled={isDisabled}
      aria-label={ariaLabel}
      aria-disabled={isDisabled}
      aria-busy={loading}
      whileTap={!isDisabled ? { scale: 0.98 } : undefined}
      className={`
        inline-flex items-center justify-center font-medium rounded-xl
        transition-all duration-200 ease-out
        focus:outline-none focus:ring-4
        disabled:opacity-50 disabled:cursor-not-allowed
        ${variants[variant]}
        ${sizes[size]}
        ${fullWidth ? 'w-full' : ''}
        ${className}
      `}
      {...props}
    >
      {loading && (
        <Loader2 className="w-5 h-5 animate-spin mr-2" aria-hidden="true" />
      )}
      
      {!loading && Icon && iconPosition === 'left' && (
        <Icon className="w-5 h-5 mr-2" aria-hidden="true" />
      )}
      
      <span>{children}</span>
      
      {!loading && Icon && iconPosition === 'right' && (
        <Icon className="w-5 h-5 ml-2" aria-hidden="true" />
      )}
    </motion.button>
  );
});

export default AccessibleButton;
