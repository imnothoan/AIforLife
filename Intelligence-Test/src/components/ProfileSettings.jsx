import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { supabase } from '../lib/supabase';
import { 
  User, Mail, IdCard, Save, Loader2, X, Camera, Shield, 
  GraduationCap, CheckCircle, AlertCircle
} from 'lucide-react';
import FaceVerification from './FaceVerification';

// Validation constants
const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 100;

/**
 * ProfileSettings Modal Component
 * Allows users to update their profile information including name, department, and face registration.
 * 
 * @param {boolean} isOpen - Controls modal visibility
 * @param {function} onClose - Callback when modal is closed
 */
export default function ProfileSettings({ isOpen, onClose }) {
  const { user, profile, updateProfile, refetchProfile } = useAuth();
  const { t } = useLanguage();
  
  const [loading, setLoading] = useState(false);
  const [showFaceRegistration, setShowFaceRegistration] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '',
    student_id: '',
    phone: '',
    department: ''
  });
  
  // Initialize form with profile data
  useEffect(() => {
    if (profile) {
      setFormData({
        full_name: profile.full_name || '',
        student_id: profile.student_id || '',
        phone: profile.phone || '',
        department: profile.department || ''
      });
    }
  }, [profile]);
  
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (loading) return;
    
    // Validate required fields
    const trimmedName = formData.full_name.trim();
    if (!trimmedName) {
      toast.error(t('validation.required') || 'Vui lòng nhập tên');
      return;
    }
    
    if (trimmedName.length < NAME_MIN_LENGTH || trimmedName.length > NAME_MAX_LENGTH) {
      toast.error(t('validation.nameLengthInvalid') || `Tên phải từ ${NAME_MIN_LENGTH}-${NAME_MAX_LENGTH} ký tự`);
      return;
    }
    
    setLoading(true);
    
    try {
      const { error } = await updateProfile({
        full_name: trimmedName,
        student_id: formData.student_id?.trim() || null,
        phone: formData.phone?.trim() || null,
        department: formData.department?.trim() || null
      });
      
      if (error) {
        throw error;
      }
      
      toast.success(t('profile.updateSuccess') || 'Cập nhật thông tin thành công!');
      onClose?.();
    } catch (err) {
      console.error('Profile update error:', err);
      // Provide more specific error message
      const errorMessage = err?.message || err?.details || t('error.general') || 'Có lỗi xảy ra';
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };
  
  const handleFaceEnrollComplete = async (embedding, imageUrl) => {
    try {
      const { error } = await supabase.rpc('update_face_embedding', {
        p_embedding: embedding,
        p_image_url: imageUrl
      });
      
      if (error) {
        console.error('Error saving face embedding:', error);
        toast.error(t('error.general') || 'Có lỗi xảy ra');
        return;
      }
      
      setShowFaceRegistration(false);
      
      // Refresh profile to sync face verification status
      await refetchProfile();
      
      toast.success(t('profile.faceRegisteredSuccess') || 'Cập nhật khuôn mặt thành công!');
    } catch (err) {
      console.error('Face registration error:', err);
      toast.error(t('error.general') || 'Có lỗi xảy ra');
    }
  };
  
  const faceRegistered = !!(profile?.face_embedding || profile?.face_enrolled_at);
  
  // Only students need face verification - instructors and admins don't take exams
  const isStudent = profile?.role === 'student';
  
  if (!isOpen) return null;
  
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-settings-title"
        aria-describedby="profile-settings-desc"
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-paper rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-primary-100 rounded-lg">
                <User className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h2 id="profile-settings-title" className="text-xl font-bold text-text-main">
                  {t('profile.settingsTitle') || 'Cài đặt tài khoản'}
                </h2>
                <p id="profile-settings-desc" className="text-sm text-gray-500">
                  {t('profile.settingsDesc') || 'Cập nhật thông tin cá nhân'}
                </p>
              </div>
            </div>
            <button 
              onClick={onClose} 
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
          
          {/* Content */}
          <div className="p-6 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 100px)' }}>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Email (read-only) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Mail className="w-4 h-4 inline mr-1" />
                  Email
                </label>
                <input
                  type="email"
                  value={user?.email || ''}
                  disabled
                  className="input bg-gray-100 cursor-not-allowed"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {t('profile.emailCannotChange') || 'Email không thể thay đổi'}
                </p>
              </div>
              
              {/* Role (read-only) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <GraduationCap className="w-4 h-4 inline mr-1" />
                  {t('profile.role') || 'Vai trò'}
                </label>
                <div className="flex items-center space-x-2">
                  <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                    profile?.role === 'instructor' || profile?.role === 'admin'
                      ? 'bg-primary-100 text-primary-700'
                      : 'bg-gray-100 text-gray-700'
                  }`}>
                    {profile?.role === 'instructor' ? (t('auth.instructor') || 'Giảng viên') :
                     profile?.role === 'admin' ? 'Admin' :
                     (t('auth.student') || 'Sinh viên')}
                  </span>
                </div>
              </div>
              
              {/* Full Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <User className="w-4 h-4 inline mr-1" />
                  {t('auth.fullName') || 'Họ và tên'} <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  name="full_name"
                  value={formData.full_name}
                  onChange={handleChange}
                  placeholder={t('auth.fullNamePlaceholder') || 'Nguyễn Văn A'}
                  className="input"
                />
              </div>
              
              {/* Student ID (only for students) */}
              {profile?.role === 'student' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <IdCard className="w-4 h-4 inline mr-1" />
                    {t('auth.studentId') || 'Mã sinh viên'}
                  </label>
                  <input
                    type="text"
                    name="student_id"
                    value={formData.student_id}
                    onChange={handleChange}
                    placeholder="20210001"
                    className="input"
                  />
                </div>
              )}
              
              {/* Department */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('profile.department') || 'Khoa/Phòng ban'}
                </label>
                <input
                  type="text"
                  name="department"
                  value={formData.department}
                  onChange={handleChange}
                  placeholder={t('profile.departmentPlaceholder') || 'Ví dụ: Công nghệ thông tin'}
                  className="input"
                />
              </div>
              
              {/* Face Verification Section - Only for students, not instructors/admins */}
              {isStudent && (
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    {faceRegistered ? (
                      <Shield className="w-5 h-5 text-success" />
                    ) : (
                      <Camera className="w-5 h-5 text-warning" />
                    )}
                    <span className="font-medium text-gray-700">
                      {t('profile.faceVerification') || 'Xác minh khuôn mặt'}
                    </span>
                  </div>
                  {faceRegistered ? (
                    <span className="flex items-center text-sm text-success">
                      <CheckCircle className="w-4 h-4 mr-1" />
                      {t('profile.verified') || 'Đã xác minh'}
                    </span>
                  ) : (
                    <span className="flex items-center text-sm text-warning">
                      <AlertCircle className="w-4 h-4 mr-1" />
                      {t('profile.notVerified') || 'Chưa xác minh'}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mb-3">
                  {t('profile.faceDesc') || 'Đăng ký khuôn mặt để xác minh danh tính khi thi'}
                </p>
                <button
                  type="button"
                  onClick={() => setShowFaceRegistration(true)}
                  className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
                    faceRegistered
                      ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      : 'bg-primary text-white hover:bg-primary-600'
                  }`}
                >
                  <Camera className="w-4 h-4 inline mr-2" />
                  {faceRegistered 
                    ? (t('profile.updateFace') || 'Cập nhật ảnh')
                    : (t('profile.registerFace') || 'Đăng ký ngay')}
                </button>
              </div>
              )}
              
              {/* Submit Button */}
              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-secondary"
                >
                  {t('common.cancel') || 'Hủy'}
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-5 h-5 mr-2" />
                  )}
                  {t('common.save') || 'Lưu thay đổi'}
                </button>
              </div>
            </form>
          </div>
        </motion.div>
        
        {/* Face Registration Modal (nested) */}
        <AnimatePresence>
          {showFaceRegistration && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50 flex items-center justify-center p-4"
              onClick={() => setShowFaceRegistration(false)}
              role="dialog"
              aria-modal="true"
              aria-label={t('profile.faceRegistrationTitle') || 'Face Registration'}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="max-w-2xl w-full"
                onClick={(e) => e.stopPropagation()}
              >
                <FaceVerification
                  mode="enroll"
                  onEnrollComplete={handleFaceEnrollComplete}
                  onFailure={() => {
                    toast.error(t('face.failed') || 'Đăng ký thất bại. Vui lòng thử lại.');
                  }}
                />
                <button
                  onClick={() => setShowFaceRegistration(false)}
                  className="mt-4 w-full py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-300 transition-colors"
                >
                  {t('common.cancel') || 'Hủy'}
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}
