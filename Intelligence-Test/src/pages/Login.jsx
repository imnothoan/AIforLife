import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { motion, AnimatePresence } from 'framer-motion';
import { z } from 'zod';
import { FileText, Eye, EyeOff, Mail, Lock, User, IdCard, Loader2 } from 'lucide-react';

const loginSchema = z.object({
  email: z.string().email({ message: "Email không hợp lệ" }),
  password: z.string().min(6, { message: "Mật khẩu phải có ít nhất 6 ký tự" }),
});

const registerSchema = z.object({
  fullName: z.string().min(2, { message: "Họ tên phải có ít nhất 2 ký tự" }),
  email: z.string().email({ message: "Email không hợp lệ" }),
  password: z.string().min(6, { message: "Mật khẩu phải có ít nhất 6 ký tự" }),
  confirmPassword: z.string(),
  studentId: z.string().optional(),
  role: z.enum(['student', 'instructor']),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Mật khẩu xác nhận không khớp",
  path: ["confirmPassword"],
});

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
  
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setFullName('');
    setConfirmPassword('');
    setStudentId('');
    setRole('student');
    setShowPassword(false);
  };

  const handleLogin = async (e) => {
    e.preventDefault();

    const validation = loginSchema.safeParse({ email, password });
    if (!validation.success) {
      toast.error(validation.error.errors[0].message);
      return;
    }

    setLoading(true);
    try {
      const { error } = await login(email, password);
      if (error) throw error;
      toast.success("Đăng nhập thành công!");
      navigate('/');
    } catch (error) {
      const errorMessage = error.message === 'Invalid login credentials' 
        ? 'Email hoặc mật khẩu không đúng'
        : error.message || "Đăng nhập thất bại";
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();

    const validation = registerSchema.safeParse({ 
      fullName, email, password, confirmPassword, studentId, role 
    });
    
    if (!validation.success) {
      toast.error(validation.error.errors[0].message);
      return;
    }

    setLoading(true);
    try {
      await register(email, password, fullName, role, studentId || null);
      toast.success("Đăng ký thành công! Vui lòng kiểm tra email để xác nhận tài khoản.");
      setIsRegister(false);
      resetForm();
    } catch (error) {
      const errorMessage = error.message?.includes('already registered')
        ? 'Email này đã được đăng ký'
        : error.message || "Đăng ký thất bại";
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setIsRegister(!isRegister);
    resetForm();
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-primary-50 via-background to-primary-100">
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
              Nền tảng khảo thí thông minh
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
                  <h3 className="text-2xl font-bold text-center text-text-main mb-6">Đăng nhập</h3>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">Mật khẩu</label>
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
                        Đang xử lý...
                      </span>
                    ) : 'Đăng nhập'}
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
                  <h3 className="text-2xl font-bold text-center text-text-main mb-4">Đăng ký</h3>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Họ và tên</label>
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
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
                      <label className="block text-sm font-medium text-gray-700 mb-1">Mật khẩu</label>
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
                      <label className="block text-sm font-medium text-gray-700 mb-1">Xác nhận</label>
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">Vai trò</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setRole('student')}
                        className={`px-4 py-2.5 rounded-lg border-2 font-medium transition-all ${
                          role === 'student'
                            ? 'border-primary bg-primary-50 text-primary'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        Thí sinh
                      </button>
                      <button
                        type="button"
                        onClick={() => setRole('instructor')}
                        className={`px-4 py-2.5 rounded-lg border-2 font-medium transition-all ${
                          role === 'instructor'
                            ? 'border-primary bg-primary-50 text-primary'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                      >
                        Giảng viên
                      </button>
                    </div>
                  </div>

                  {role === 'student' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <label className="block text-sm font-medium text-gray-700 mb-1">Mã sinh viên (tuỳ chọn)</label>
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
                        Đang xử lý...
                      </span>
                    ) : 'Đăng ký'}
                  </button>
                </motion.form>
              )}
            </AnimatePresence>

            {/* Toggle */}
            <div className="mt-6 text-center text-sm text-gray-600">
              {isRegister ? 'Đã có tài khoản?' : 'Chưa có tài khoản?'}{' '}
              <button
                type="button"
                onClick={toggleMode}
                className="text-primary font-semibold hover:text-primary-700 transition-colors"
              >
                {isRegister ? 'Đăng nhập ngay' : 'Đăng ký ngay'}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-gray-500 text-xs mt-4">
          © 2024 SmartExamPro. Nền tảng khảo thí thông minh.
        </p>
      </motion.div>
    </div>
  );
}
