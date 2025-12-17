import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { motion, AnimatePresence } from 'framer-motion';
import { z } from 'zod';
import { FileText, Eye, EyeOff, Loader2, Mail, Lock, User, IdCard } from 'lucide-react';
import LanguageSwitcher from '../components/LanguageSwitcher';

// Validation schemas with error codes (not messages)
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const registerSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  confirmPassword: z.string(),
  studentId: z.string().optional(),
  role: z.enum(['student', 'instructor']),
}).refine((data) => data.password === data.confirmPassword, {
  path: ["confirmPassword"],
});

// Maximum navigation attempts to prevent infinite loops
const MAX_NAVIGATION_ATTEMPTS = 10;

export default function Login() {
  const [isRegister, setIsRegister] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Register state
  const [fullName, setFullName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [studentId, setStudentId] = useState('');
  const [role, setRole] = useState('student');

  const { user, login, register, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const navigationStateRef = useRef({
    hasRedirected: false,
    lastUserId: null,
    redirectCount: 0,
    lastRedirectTime: 0
  });

  // Redirect if already authenticated (prevents showing login when already logged in)
  // Uses ref guard with throttling to ensure navigation only happens once
  useEffect(() => {
    const state = navigationStateRef.current;
    const now = Date.now();
    
    // Only redirect when auth is fully loaded and user exists
    if (!authLoading && user) {
      // Check if we already redirected for this user
      if (state.hasRedirected && state.lastUserId === user.id) {
        return;
      }
      
      // Throttle navigation - max once per 500ms
      if ((now - state.lastRedirectTime) < 500) {
        return;
      }
      
      // Limit total redirects to prevent loops
      if (state.redirectCount > MAX_NAVIGATION_ATTEMPTS) {
        console.warn('[Login] Too many redirect attempts, stopping');
        return;
      }
      
      state.hasRedirected = true;
      state.lastUserId = user.id;
      state.redirectCount++;
      state.lastRedirectTime = now;
      
      if (import.meta.env.DEV) {
        console.log('[Login] User authenticated, redirecting to home');
      }
      
      // Navigate to home - the ref guard prevents multiple calls
      navigate('/', { replace: true });
    }
  }, [user, authLoading, navigate]);

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setFullName('');
    setConfirmPassword('');
    setStudentId('');
    setRole('student');
    setShowPassword(false);
  };

  // Helper function to translate Zod validation errors
  const translateValidationError = (error) => {
    // Check if error has valid issues/errors
    // Zod v3 uses 'issues' but some versions use 'errors'
    const errorList = error?.issues || error?.errors || [];
    
    if (errorList.length === 0) {
      // Try to parse from message if no issues array
      if (error?.message) {
        try {
          const parsed = JSON.parse(error.message);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const firstError = parsed[0];
            return getErrorMessage(firstError);
          }
        } catch (e) {
          // Not JSON format - this is expected for non-Zod errors
          console.debug('Validation error message is not JSON:', error.message);
        }
      }
      return t('validation.required');
    }
    
    return getErrorMessage(errorList[0]);
  };
  
  // Get user-friendly error message based on Zod error
  const getErrorMessage = (errorItem) => {
    const code = errorItem?.code;
    const path = errorItem?.path?.[0];
    const message = errorItem?.message || '';
    const format = errorItem?.format;
    
    // Handle email field errors
    if (path === 'email') {
      // Check for invalid format (email validation failed)
      if (code === 'invalid_format' && format === 'email') {
        // Empty email shows as invalid format too
        return t('validation.emailRequired');
      }
      if (code === 'invalid_string' || code === 'too_small' || code === 'invalid_type') {
        return t('validation.emailRequired');
      }
      return t('validation.emailRequired');
    }
    
    // Handle password field errors
    if (path === 'password') {
      if (code === 'too_small' || code === 'invalid_type') {
        return t('validation.passwordRequired');
      }
      return t('validation.minLength', { min: 6 });
    }
    
    // Handle fullName field errors
    if (path === 'fullName') {
      if (code === 'too_small' || code === 'invalid_type') {
        return t('validation.minLength', { min: 2 });
      }
    }
    
    // Handle password confirmation mismatch
    if (path === 'confirmPassword') {
      return t('validation.passwordMismatch');
    }
    
    return t('validation.required');
  };

  const handleLogin = async (e) => {
    e.preventDefault();

    // Prevent double-click
    if (loading) return;

    const validation = loginSchema.safeParse({ email, password });
    if (!validation.success) {
      toast.error(translateValidationError(validation.error));
      return;
    }

    setLoading(true);
    try {
      const { error } = await login(email, password);
      if (error) throw error;
      toast.success(t('auth.loginSuccess'));
      // Navigation is now handled by the useEffect that watches for user auth state
      // This prevents race conditions between auth state updates and navigation
    } catch (error) {
      let errorMessage = t('auth.loginFailed');

      // User-friendly error messages
      const errorMsg = error.message?.toLowerCase() || '';

      if (errorMsg.includes('invalid login credentials') || errorMsg.includes('invalid password')) {
        errorMessage = t('auth.invalidCredentials');
      } else if (errorMsg.includes('email not confirmed')) {
        errorMessage = t('auth.emailNotConfirmed');
        // Try to auto-confirm email via backend (only if API configured)
        const apiUrl = import.meta.env.VITE_API_URL;
        if (apiUrl) {
          try {
            const confirmResponse = await fetch(`${apiUrl}/api/auth/confirm-email`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email })
            });

            if (confirmResponse.ok) {
              toast.info(t('auth.loginNow'));
              setLoading(false);
              return;
            }
          } catch (confirmError) {
            // Silent fail - user will see the original error message
          }
        }
      } else if (errorMsg.includes('too many requests') || errorMsg.includes('rate limit')) {
        errorMessage = t('auth.tooManyRequests');
      } else if (errorMsg.includes('network') || errorMsg.includes('fetch') || errorMsg.includes('failed to fetch')) {
        errorMessage = t('auth.networkError');
      } else if (errorMsg.includes('user not found')) {
        errorMessage = t('auth.invalidCredentials'); // Account doesn't exist - show generic error for security
      } else {
        errorMessage = t('auth.loginFailed');
      }

      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();

    // Prevent double-click
    if (loading) return;

    const validation = registerSchema.safeParse({
      fullName, email, password, confirmPassword, studentId, role
    });

    if (!validation.success) {
      toast.error(translateValidationError(validation.error));
      return;
    }

    setLoading(true);
    try {
      await register(email, password, fullName, role, studentId || null);
      toast.success(t('auth.registerSuccess'));
      setIsRegister(false);
      resetForm();
    } catch (error) {
      const errorMsg = error.message?.toLowerCase() || '';
      let errorMessage;

      // User-friendly error messages
      if (errorMsg.includes('already registered') || errorMsg.includes('đã được đăng ký') || errorMsg.includes('already exists')) {
        errorMessage = t('auth.emailExists');
      } else if (errorMsg.includes('invalid email') || errorMsg.includes('email')) {
        errorMessage = t('validation.invalidEmail');
      } else if (errorMsg.includes('password') && errorMsg.includes('weak')) {
        errorMessage = t('validation.minLength', { min: 6 });
      } else if (errorMsg.includes('network') || errorMsg.includes('fetch') || errorMsg.includes('failed to fetch')) {
        errorMessage = t('auth.networkError');
      } else if (errorMsg.includes('too many requests') || errorMsg.includes('rate limit')) {
        errorMessage = t('auth.tooManyRequests');
      } else {
        errorMessage = t('auth.registerFailed');
      }

      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setIsRegister(!isRegister);
    resetForm();
  };

  // Show loading if user is authenticated and we're about to redirect
  if (!authLoading && user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-primary-50 via-background to-primary-100">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
          <p className="text-gray-600 text-sm">{t('auth.redirecting')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-primary-50 via-background to-primary-100">
      {/* Language Switcher */}
      <div className="absolute top-4 right-4 z-20">
        <LanguageSwitcher compact />
      </div>
      
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary-200 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-primary-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-md mx-4"
      >
        <div className="bg-paper shadow-soft rounded-2xl overflow-hidden">
          {/* Header */}
          <div className="bg-primary px-8 py-6 text-center">
            <div className="flex items-center justify-center space-x-2 mb-2">
              <div className="bg-white/20 p-2 rounded-lg">
                <FileText className="text-white w-6 h-6" />
              </div>
              <span className="text-2xl font-bold text-white tracking-tight">
                SmartExam<span className="text-primary-200">Pro</span>
              </span>
            </div>
            <p className="text-primary-100 text-sm">
              {t('app.subtitle')}
            </p>
          </div>

          {/* Form */}
          <div className="px-8 py-8">
            <AnimatePresence mode="wait">
              {!isRegister ? (
                <motion.form
                  key="login"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3 }}
                  onSubmit={handleLogin}
                  className="space-y-5"
                >
                  <h3 className="text-2xl font-bold text-center text-text-main mb-6">{t('auth.login')}</h3>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.email')}</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type="email"
                        placeholder="student@example.com"
                        className="input pl-10"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.password')}</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        className="input pl-10 pr-10"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="btn-primary w-full py-3"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center">
                        <Loader2 className="animate-spin -ml-1 mr-2 h-5 w-5" />
                        {t('auth.processing')}
                      </span>
                    ) : t('auth.login')}
                  </button>
                </motion.form>
              ) : (
                <motion.form
                  key="register"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                  onSubmit={handleRegister}
                  className="space-y-4"
                >
                  <h3 className="text-2xl font-bold text-center text-text-main mb-4">{t('auth.register')}</h3>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.fullName')}</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Nguyễn Văn A"
                        className="input pl-10"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.email')}</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type="email"
                        placeholder="student@example.com"
                        className="input pl-10"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.password')}</label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          placeholder="••••••"
                          className="input pl-10 text-sm"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.confirmPassword')}</label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          placeholder="••••••"
                          className="input pl-10 text-sm"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.role')}</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setRole('student')}
                        className={`px-4 py-2.5 rounded-lg border-2 font-medium transition-all ${role === 'student'
                            ? 'border-primary bg-primary-50 text-primary'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                          }`}
                      >
                        {t('auth.student')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRole('instructor')}
                        className={`px-4 py-2.5 rounded-lg border-2 font-medium transition-all ${role === 'instructor'
                            ? 'border-primary bg-primary-50 text-primary'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                          }`}
                      >
                        {t('auth.instructor')}
                      </button>
                    </div>
                  </div>

                  {role === 'student' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <label className="block text-sm font-medium text-gray-700 mb-1">{t('auth.studentId')} ({t('auth.optional')})</label>
                      <div className="relative">
                        <IdCard className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                          type="text"
                          placeholder="21020001"
                          className="input pl-10"
                          value={studentId}
                          onChange={(e) => setStudentId(e.target.value)}
                        />
                      </div>
                    </motion.div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="btn-primary w-full py-3"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center">
                        <Loader2 className="animate-spin -ml-1 mr-2 h-5 w-5" />
                        {t('auth.processing')}
                      </span>
                    ) : t('auth.register')}
                  </button>
                </motion.form>
              )}
            </AnimatePresence>

            {/* Toggle */}
            <div className="mt-6 text-center text-sm text-gray-600">
              {isRegister ? t('auth.hasAccount') : t('auth.noAccount')}{' '}
              <button
                type="button"
                onClick={toggleMode}
                className="text-primary font-semibold hover:text-primary-700 transition-colors"
              >
                {isRegister ? t('auth.loginNow') : t('auth.registerNow')}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-gray-500 text-xs mt-4">
          © 2025 {t('app.name')}. {t('app.subtitle')}.
        </p>
      </motion.div>
    </div>
  );
}
