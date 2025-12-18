import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import {
  FileText, Users, Plus, Clock, BarChart3, CheckCircle, Trash2,
  Calendar, X, Save, Loader2, BookOpen, Shield, ClipboardList,
  Edit2, GraduationCap, Activity, AlertTriangle, Search, LogOut, User, Settings
} from 'lucide-react';
import LanguageSwitcher from '../components/LanguageSwitcher';
import ProfileSettings from '../components/ProfileSettings';
import { ACADEMIC_YEAR_PAST_YEARS, ACADEMIC_YEAR_FUTURE_YEARS } from '../lib/constants';

// ============================================
// UTILITY FUNCTIONS
// ============================================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return EMAIL_REGEX.test(email);
}

// Validate class code format (alphanumeric with hyphens)
function isValidClassCode(code) {
  return /^[A-Za-z0-9-_]+$/.test(code);
}

/**
 * Convert datetime-local value to ISO string for database storage
 * datetime-local input gives a string like "2024-12-18T12:00" which is local time
 * new Date() interprets this as local time, then toISOString() converts to UTC
 * Supabase TIMESTAMPTZ stores in UTC and converts back to local when reading
 * This ensures consistent timezone handling across the application
 * @param {string} datetimeLocalValue - Value from datetime-local input (e.g., "2024-12-18T12:00")
 * @returns {string} ISO string in UTC (e.g., "2024-12-18T05:00:00.000Z" for UTC+7)
 */
function toISOWithTimezone(datetimeLocalValue) {
  if (!datetimeLocalValue) return null;
  // Create date from local datetime string - JavaScript interprets this as local time
  const date = new Date(datetimeLocalValue);
  // Convert to ISO/UTC format for database storage
  return date.toISOString();
}

/**
 * Convert ISO/database timestamp to datetime-local format for input
 * @param {string} isoString - ISO string or database timestamp
 * @returns {string} datetime-local format (YYYY-MM-DDTHH:mm)
 */
function toDatetimeLocal(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  // Format as local datetime for input
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// ============================================
// MODAL COMPONENTS
// ============================================

function Modal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null;
  
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-paper rounded-2xl shadow-soft max-w-2xl w-full max-h-[90vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <h2 className="text-xl font-bold text-text-main">{title}</h2>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-150px)]">
            {children}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ============================================
// CREATE EXAM FORM
// ============================================

function CreateExamForm({ classId, onClose, onSuccess }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    duration_minutes: 60,
    start_time: '',
    end_time: '',
    is_shuffled: true,
    show_result_immediately: false,
    allow_review: false,
    passing_score: 50,
    max_attempts: 1,
    require_camera: true,
    require_fullscreen: true,
    max_tab_violations: 3,
    max_fullscreen_violations: 3,
  });

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Prevent double-click
    if (loading) return;

    const trimmedTitle = formData.title.trim();
    
    // Validate title
    if (!trimmedTitle) {
      toast.error(t('validation.enterExamTitle'));
      return;
    }
    if (trimmedTitle.length > 200) {
      toast.error(t('validation.examTitleTooLong'));
      return;
    }
    
    // Validate time
    if (!formData.start_time || !formData.end_time) {
      toast.error(t('validation.selectTime'));
      return;
    }
    
    const startTime = new Date(formData.start_time);
    const endTime = new Date(formData.end_time);
    
    if (endTime <= startTime) {
      toast.error(t('validation.endAfterStart'));
      return;
    }
    
    // Validate duration
    const durationMinutes = parseInt(formData.duration_minutes);
    if (isNaN(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) {
      toast.error(t('validation.durationRange'));
      return;
    }

    setLoading(true);
    
    const createExam = async (attempt = 0) => {
      const MAX_RETRIES = 3;
      const TIMEOUT_MS = 30000; // Increased to 30 seconds
      try {
        // Use Promise.race for timeout since Supabase doesn't support AbortController
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('REQUEST_TIMEOUT')), TIMEOUT_MS)
        );

        const supabasePromise = supabase
          .from('exams')
          .insert({
            title: trimmedTitle,
            description: formData.description?.trim() || null,
            duration_minutes: durationMinutes,
            start_time: toISOWithTimezone(formData.start_time),
            end_time: toISOWithTimezone(formData.end_time),
            is_shuffled: formData.is_shuffled,
            show_result_immediately: formData.show_result_immediately,
            allow_review: formData.allow_review,
            passing_score: parseFloat(formData.passing_score) || 50,
            max_attempts: parseInt(formData.max_attempts) || 1,
            require_camera: formData.require_camera,
            require_fullscreen: formData.require_fullscreen,
            max_tab_violations: parseInt(formData.max_tab_violations) || 3,
            max_fullscreen_violations: parseInt(formData.max_fullscreen_violations) || 3,
            class_id: classId,
            created_by: user.id,
            status: 'draft'
          })
          .select()
          .single();

        const { data, error } = await Promise.race([supabasePromise, timeoutPromise]);

        if (error) throw error;

        toast.success(t('exam.createSuccess'));
        onSuccess?.(data);
        onClose();
      } catch (error) {
        console.error('Create exam error:', error);
        console.error('Error details:', { code: error.code, message: error.message, details: error.details, hint: error.hint });
        
        if (error.message === 'REQUEST_TIMEOUT') {
          if (attempt < MAX_RETRIES) {
            toast.info(t('error.retrying', { attempt: attempt + 1, max: MAX_RETRIES }));
            await new Promise(resolve => setTimeout(resolve, 1000));
            return createExam(attempt + 1);
          }
          toast.error(t('error.timeout'));
        } else if (error.code === '42501' || error.message?.includes('permission') || error.message?.includes('denied')) {
          toast.error(t('error.permission'));
        } else if (error.message?.includes('network') || error.message?.includes('fetch') || error.message?.includes('Failed to fetch')) {
          toast.error(t('error.network'));
        } else if (error.code === '23503') {
          // Foreign key violation - class or user doesn't exist
          toast.error(t('exam.createError'));
        } else {
          // Don't expose raw error messages to users
          toast.error(t('exam.createError'));
        }
      } finally {
        setLoading(false);
      }
    };

    await createExam(0);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Info */}
      <div className="space-y-4">
        <h3 className="font-semibold text-gray-900 flex items-center space-x-2">
          <BookOpen className="w-5 h-5 text-primary" />
          <span>{t('exam.basicInfo')}</span>
        </h3>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('exam.title')} <span className="text-danger">*</span>
          </label>
          <input
            type="text"
            name="title"
            value={formData.title}
            onChange={handleChange}
            placeholder={t('exam.titlePlaceholder')}
            className="input"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('exam.description')}
          </label>
          <textarea
            name="description"
            value={formData.description}
            onChange={handleChange}
            placeholder={t('exam.descriptionPlaceholder')}
            rows={3}
            className="input resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('exam.durationMinutes')}
            </label>
            <input
              type="number"
              name="duration_minutes"
              value={formData.duration_minutes}
              onChange={handleChange}
              min={5}
              max={300}
              className="input"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('exam.passingScore')}
            </label>
            <input
              type="number"
              name="passing_score"
              value={formData.passing_score}
              onChange={handleChange}
              min={0}
              max={100}
              className="input"
            />
          </div>
        </div>
      </div>

      {/* Time Settings */}
      <div className="space-y-4">
        <h3 className="font-semibold text-gray-900 flex items-center space-x-2">
          <Clock className="w-5 h-5 text-primary" />
          <span>{t('exam.timeSettings')}</span>
        </h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('exam.startTime')} <span className="text-danger">*</span>
            </label>
            <input
              type="datetime-local"
              name="start_time"
              value={formData.start_time}
              onChange={handleChange}
              className="input"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('exam.endTime')} <span className="text-danger">*</span>
            </label>
            <input
              type="datetime-local"
              name="end_time"
              value={formData.end_time}
              onChange={handleChange}
              className="input"
            />
          </div>
        </div>
      </div>

      {/* Anti-Cheat Settings */}
      <div className="space-y-4">
        <h3 className="font-semibold text-gray-900 flex items-center space-x-2">
          <Shield className="w-5 h-5 text-primary" />
          <span>{t('exam.antiCheatSettings')}</span>
        </h3>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              name="require_camera"
              checked={formData.require_camera}
              onChange={handleChange}
              className="w-5 h-5 text-primary rounded"
            />
            <span className="text-sm text-gray-700">{t('exam.requireCamera')}</span>
          </label>

          <label className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              name="require_fullscreen"
              checked={formData.require_fullscreen}
              onChange={handleChange}
              className="w-5 h-5 text-primary rounded"
            />
            <span className="text-sm text-gray-700">{t('exam.requireFullscreen')}</span>
          </label>

          <label className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              name="is_shuffled"
              checked={formData.is_shuffled}
              onChange={handleChange}
              className="w-5 h-5 text-primary rounded"
            />
            <span className="text-sm text-gray-700">{t('exam.shuffleQuestions')}</span>
          </label>

          <label className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              name="show_result_immediately"
              checked={formData.show_result_immediately}
              onChange={handleChange}
              className="w-5 h-5 text-primary rounded"
            />
            <span className="text-sm text-gray-700">{t('exam.showResultImmediately')}</span>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('exam.maxTabViolations')}
            </label>
            <input
              type="number"
              name="max_tab_violations"
              value={formData.max_tab_violations}
              onChange={handleChange}
              min={0}
              max={10}
              className="input"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('exam.maxFullscreenViolations')}
            </label>
            <input
              type="number"
              name="max_fullscreen_violations"
              value={formData.max_fullscreen_violations}
              onChange={handleChange}
              min={0}
              max={10}
              className="input"
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-200">
        <button type="button" onClick={onClose} className="btn-secondary">
          {t('common.cancel')}
        </button>
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? (
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          ) : (
            <Save className="w-5 h-5 mr-2" />
          )}
          {t('exam.create')}
        </button>
      </div>
    </form>
  );
}

// ============================================
// EDIT EXAM FORM
// ============================================

function EditExamForm({ exam, onClose, onSuccess }) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: exam?.title || '',
    description: exam?.description || '',
    duration_minutes: exam?.duration_minutes || 60,
    start_time: toDatetimeLocal(exam?.start_time) || '',
    end_time: toDatetimeLocal(exam?.end_time) || '',
    is_shuffled: exam?.is_shuffled ?? true,
    show_result_immediately: exam?.show_result_immediately ?? false,
    allow_review: exam?.allow_review ?? false,
    passing_score: exam?.passing_score || 50,
    max_attempts: exam?.max_attempts || 1,
    require_camera: exam?.require_camera ?? true,
    require_fullscreen: exam?.require_fullscreen ?? true,
    max_tab_violations: exam?.max_tab_violations || 3,
    max_fullscreen_violations: exam?.max_fullscreen_violations || 3,
  });

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validation
    const trimmedTitle = formData.title?.trim();
    if (!trimmedTitle) {
      toast.error(t('validation.examTitleRequired'));
      return;
    }
    
    if (!formData.start_time || !formData.end_time) {
      toast.error(t('validation.selectTime'));
      return;
    }
    
    const startTime = new Date(formData.start_time);
    const endTime = new Date(formData.end_time);
    
    if (endTime <= startTime) {
      toast.error(t('validation.endAfterStart'));
      return;
    }
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('exams')
        .update({
          title: trimmedTitle,
          description: formData.description?.trim() || null,
          duration_minutes: parseInt(formData.duration_minutes) || 60,
          start_time: toISOWithTimezone(formData.start_time),
          end_time: toISOWithTimezone(formData.end_time),
          is_shuffled: formData.is_shuffled,
          show_result_immediately: formData.show_result_immediately,
          allow_review: formData.allow_review,
          passing_score: parseFloat(formData.passing_score) || 50,
          max_attempts: parseInt(formData.max_attempts) || 1,
          require_camera: formData.require_camera,
          require_fullscreen: formData.require_fullscreen,
          max_tab_violations: parseInt(formData.max_tab_violations) || 3,
          max_fullscreen_violations: parseInt(formData.max_fullscreen_violations) || 3,
        })
        .eq('id', exam.id)
        .select()
        .single();

      if (error) throw error;

      toast.success(t('exam.updateSuccess'));
      onSuccess?.(data);
      onClose();
    } catch (error) {
      console.error('Update exam error:', error);
      toast.error(t('exam.updateError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Info */}
      <div className="space-y-4">
        <h3 className="font-semibold text-gray-900 flex items-center space-x-2">
          <BookOpen className="w-5 h-5 text-primary" />
          <span>{t('exam.basicInfo')}</span>
        </h3>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('exam.title')} <span className="text-danger">*</span>
          </label>
          <input
            type="text"
            name="title"
            value={formData.title}
            onChange={handleChange}
            placeholder={t('exam.titlePlaceholder')}
            className="input"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('exam.description')}
          </label>
          <textarea
            name="description"
            value={formData.description}
            onChange={handleChange}
            placeholder={t('exam.descriptionPlaceholder')}
            rows={3}
            className="input resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('exam.durationMinutes')}
            </label>
            <input
              type="number"
              name="duration_minutes"
              value={formData.duration_minutes}
              onChange={handleChange}
              min={5}
              max={300}
              className="input"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('exam.passingScore')}
            </label>
            <input
              type="number"
              name="passing_score"
              value={formData.passing_score}
              onChange={handleChange}
              min={0}
              max={100}
              className="input"
            />
          </div>
        </div>
      </div>

      {/* Time Settings */}
      <div className="space-y-4">
        <h3 className="font-semibold text-gray-900 flex items-center space-x-2">
          <Clock className="w-5 h-5 text-primary" />
          <span>{t('exam.timeSettings')}</span>
        </h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('exam.startTime')} <span className="text-danger">*</span>
            </label>
            <input
              type="datetime-local"
              name="start_time"
              value={formData.start_time}
              onChange={handleChange}
              className="input"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('exam.endTime')} <span className="text-danger">*</span>
            </label>
            <input
              type="datetime-local"
              name="end_time"
              value={formData.end_time}
              onChange={handleChange}
              className="input"
            />
          </div>
        </div>
      </div>

      {/* Anti-Cheat Settings */}
      <div className="space-y-4">
        <h3 className="font-semibold text-gray-900 flex items-center space-x-2">
          <Shield className="w-5 h-5 text-primary" />
          <span>{t('exam.antiCheatSettings')}</span>
        </h3>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              name="require_camera"
              checked={formData.require_camera}
              onChange={handleChange}
              className="w-5 h-5 text-primary rounded"
            />
            <span className="text-sm text-gray-700">{t('exam.requireCamera')}</span>
          </label>

          <label className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              name="require_fullscreen"
              checked={formData.require_fullscreen}
              onChange={handleChange}
              className="w-5 h-5 text-primary rounded"
            />
            <span className="text-sm text-gray-700">{t('exam.requireFullscreen')}</span>
          </label>

          <label className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              name="is_shuffled"
              checked={formData.is_shuffled}
              onChange={handleChange}
              className="w-5 h-5 text-primary rounded"
            />
            <span className="text-sm text-gray-700">{t('exam.shuffleQuestions')}</span>
          </label>

          <label className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              name="show_result_immediately"
              checked={formData.show_result_immediately}
              onChange={handleChange}
              className="w-5 h-5 text-primary rounded"
            />
            <span className="text-sm text-gray-700">{t('exam.showResultImmediately')}</span>
          </label>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-200">
        <button type="button" onClick={onClose} className="btn-secondary">
          {t('common.cancel')}
        </button>
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? (
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          ) : (
            <Save className="w-5 h-5 mr-2" />
          )}
          {t('exam.update')}
        </button>
      </div>
    </form>
  );
}

// ============================================
// ADD STUDENT FORM
// ============================================

function AddStudentForm({ classId, onClose, onSuccess }) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [bulkEmails, setBulkEmails] = useState('');
  const [mode, setMode] = useState('single'); // 'single' | 'bulk'

  // Add student using RPC function (preferred method - bypasses RLS issues)
  const addStudentViaRPC = async (studentEmail) => {
    try {
      if (import.meta.env.DEV) {
        console.log('[AddStudent] Calling RPC add_student_to_class with:', { classId, studentEmail: studentEmail.toLowerCase().trim() });
      }
      const { data, error } = await supabase.rpc('add_student_to_class', {
        p_class_id: classId,
        p_student_email: studentEmail.toLowerCase().trim()
      });

      if (import.meta.env.DEV) {
        console.log('[AddStudent] RPC response:', { data, error });
      }

      if (error) {
        console.error('RPC add_student_to_class error:', error);
        return { success: false, error: 'rpc_failed' };
      }

      // RPC returns JSONB with success and optional error
      if (data && data.success) {
        if (import.meta.env.DEV) {
          console.log('[AddStudent] Successfully added student with ID:', data.student_id);
        }
        return { success: true, student_id: data.student_id };
      }
      
      // Return the error code from RPC response
      if (import.meta.env.DEV) {
        console.log('[AddStudent] RPC returned error:', data?.error);
      }
      return { success: false, error: data?.error || 'unknown_error' };
    } catch (err) {
      console.error('RPC call exception:', err);
      return { success: false, error: 'rpc_exception' };
    }
  };

  // Fallback direct method (used if RPC is not available)
  const addStudentDirect = async (studentEmail) => {
    // Find user by email directly
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('id, role')
      .eq('email', studentEmail.toLowerCase().trim())
      .single();

    if (profileError) {
      if (profileError.code === 'PGRST116') {
        return { success: false, error: 'student_not_found' };
      }
      console.error('Profile lookup error:', profileError);
      return { success: false, error: 'lookup_failed' };
    }

    if (!profileData) {
      return { success: false, error: 'student_not_found' };
    }

    // Add enrollment directly
    const { error: enrollError } = await supabase
      .from('enrollments')
      .insert({
        class_id: classId,
        student_id: profileData.id,
        status: 'active'
      });

    if (enrollError) {
      if (enrollError.code === '23505') {
        return { success: false, error: 'already_enrolled' };
      }
      console.error('Enroll error:', enrollError);
      return { success: false, error: 'enroll_failed' };
    }

    return { success: true };
  };

  // Try RPC first, fallback to direct method
  const addStudent = async (studentEmail) => {
    // First try RPC (preferred - bypasses RLS)
    const rpcResult = await addStudentViaRPC(studentEmail);
    
    if (rpcResult.success) {
      return rpcResult;
    }
    
    // If RPC failed due to function not existing, try direct method
    if (rpcResult.error === 'rpc_failed' || rpcResult.error === 'rpc_exception') {
      console.log('RPC not available, falling back to direct method');
      return addStudentDirect(studentEmail);
    }
    
    // Return the RPC error (student_not_found, already_enrolled, etc.)
    return rpcResult;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Prevent double-click
    if (loading) return;
    
    const emails = mode === 'single' 
      ? [email.trim()]
      : bulkEmails.split('\n').map(e => e.trim()).filter(e => e);

    if (emails.length === 0) {
      toast.error(t('validation.enterStudentEmail'));
      return;
    }

    // Limit bulk emails to 100 at a time
    if (emails.length > 100) {
      toast.error(t('validation.maxEmails'));
      return;
    }

    // Validate email format using utility function
    const invalidEmails = emails.filter(e => !isValidEmail(e));
    if (invalidEmails.length > 0) {
      toast.error(t('validation.invalidEmails', { emails: invalidEmails.slice(0, 3).join(', ') + (invalidEmails.length > 3 ? '...' : '') }));
      return;
    }

    setLoading(true);
    let successCount = 0;
    let errorCount = 0;
    const errorMessages = [];
    const TIMEOUT_MS = 15000; // 15 second timeout per request

    for (const studentEmail of emails) {
      try {
        // Create timeout promise
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('REQUEST_TIMEOUT')), TIMEOUT_MS)
        );

        // Use unified method (RPC first, then direct fallback)
        const addPromise = addStudent(studentEmail);
        const result = await Promise.race([addPromise, timeoutPromise]);

        if (result.success) {
          successCount++;
        } else {
          // Handle error responses
          const errorKey = result.error;
          if (errorKey === 'student_not_found') {
            errorMessages.push(`${studentEmail}: ${t('student.notRegistered')}`);
          } else if (errorKey === 'already_enrolled') {
            errorMessages.push(`${studentEmail}: ${t('student.alreadyInClass')}`);
          } else if (errorKey === 'class_not_found') {
            errorMessages.push(`${studentEmail}: ${t('error.classNotFound')}`);
          } else if (errorKey === 'not_authorized') {
            errorMessages.push(`${studentEmail}: ${t('error.permission')}`);
          } else {
            errorMessages.push(`${studentEmail}: ${t('student.addError')}`);
          }
          errorCount++;
        }
      } catch (err) {
        console.error('Add student error:', err);
        if (err.message === 'REQUEST_TIMEOUT') {
          errorMessages.push(`${studentEmail}: ${t('error.timeout')}`);
        } else {
          errorMessages.push(`${studentEmail}: ${t('error.network')}`);
        }
        errorCount++;
      }
    }

    setLoading(false);

    if (successCount > 0) {
      toast.success(t('student.addSuccess', { count: successCount }));
      onSuccess?.();
    }
    
    if (errorCount > 0) {
      // Show first 3 error messages
      const displayErrors = errorMessages.slice(0, 3).join('\n');
      const moreErrors = errorMessages.length > 3 ? `\n... ${errorMessages.length - 3} ${t('common.more')}` : '';
      toast.warning(`${displayErrors}${moreErrors}`, { autoClose: 8000 });
    }

    if (successCount > 0 && errorCount === 0) {
      onClose();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Mode Toggle */}
      <div className="flex space-x-2 p-1 bg-gray-100 rounded-lg">
        <button
          type="button"
          onClick={() => setMode('single')}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
            mode === 'single' ? 'bg-white shadow text-primary' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {t('student.addSingle')}
        </button>
        <button
          type="button"
          onClick={() => setMode('bulk')}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
            mode === 'bulk' ? 'bg-white shadow text-primary' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {t('student.addBulk')}
        </button>
      </div>

      {mode === 'single' ? (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('student.email')}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="student@example.com"
            className="input"
          />
          <p className="text-xs text-gray-500 mt-1">
            {t('student.emailNote')}
          </p>
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('student.emailList')}
          </label>
          <textarea
            value={bulkEmails}
            onChange={(e) => setBulkEmails(e.target.value)}
            placeholder="student1@example.com&#10;student2@example.com&#10;student3@example.com"
            rows={8}
            className="input resize-none font-mono text-sm"
          />
        </div>
      )}

      <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-200">
        <button type="button" onClick={onClose} className="btn-secondary">
          {t('common.cancel')}
        </button>
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? (
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          ) : (
            <Plus className="w-5 h-5 mr-2" />
          )}
          {t('student.add')}
        </button>
      </div>
    </form>
  );
}

// ============================================
// MANAGE QUESTIONS FORM
// ============================================

function ManageQuestionsForm({ examId, examTitle, onClose }) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [editingQuestion, setEditingQuestion] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // Load questions
  useEffect(() => {
    const loadQuestions = async () => {
      try {
        const { data, error } = await supabase
          .from('questions')
          .select('*')
          .eq('exam_id', examId)
          .order('order_index');

        if (error) throw error;
        setQuestions(data || []);
      } catch (err) {
        console.error('Load questions error:', err);
        toast.error(t('error.general'));
      } finally {
        setLoading(false);
      }
    };

    loadQuestions();
  }, [examId, t]);

  const handleDeleteQuestion = async (questionId) => {
    if (!window.confirm(t('question.deleteConfirm'))) return;

    try {
      const { error } = await supabase
        .from('questions')
        .delete()
        .eq('id', questionId);

      if (error) throw error;
      setQuestions(prev => prev.filter(q => q.id !== questionId));
      toast.success(t('common.success'));
    } catch (err) {
      toast.error(t('error.general'));
    }
  };

  const handleSaveQuestion = async (questionData) => {
    setSaving(true);
    try {
      if (editingQuestion) {
        // Update existing question
        const { error } = await supabase
          .from('questions')
          .update({
            question_text: questionData.question_text,
            question_type: questionData.question_type,
            options: questionData.options,
            correct_answer: questionData.correct_answer,
            points: questionData.points,
            difficulty: questionData.difficulty,
            explanation: questionData.explanation
          })
          .eq('id', editingQuestion.id);

        if (error) throw error;
        setQuestions(prev => prev.map(q => 
          q.id === editingQuestion.id ? { ...q, ...questionData } : q
        ));
      } else {
        // Create new question
        const { data, error } = await supabase
          .from('questions')
          .insert({
            exam_id: examId,
            question_text: questionData.question_text,
            question_type: questionData.question_type,
            options: questionData.options,
            correct_answer: questionData.correct_answer,
            points: questionData.points,
            difficulty: questionData.difficulty,
            explanation: questionData.explanation,
            order_index: questions.length
          })
          .select()
          .single();

        if (error) throw error;
        setQuestions(prev => [...prev, data]);
      }

      toast.success(t('question.saveSuccess'));
      setEditingQuestion(null);
      setShowAddForm(false);
    } catch (err) {
      console.error('Save question error:', err);
      toast.error(t('question.saveError'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">{examTitle}</h3>
          <p className="text-sm text-gray-500">{t('exam.questionsCount', { count: questions.length })}</p>
        </div>
        <button
          onClick={() => { setEditingQuestion(null); setShowAddForm(true); }}
          className="btn-primary"
        >
          <Plus className="w-5 h-5 mr-2" />
          {t('question.add')}
        </button>
      </div>

      {/* Question Form */}
      {(showAddForm || editingQuestion) && (
        <QuestionForm
          question={editingQuestion}
          onSave={handleSaveQuestion}
          onCancel={() => { setEditingQuestion(null); setShowAddForm(false); }}
          saving={saving}
        />
      )}

      {/* Question List */}
      {questions.length > 0 ? (
        <div className="space-y-3">
          {questions.map((question, idx) => (
            <div key={question.id} className="p-4 border border-gray-200 rounded-lg hover:border-primary-300 transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-2">
                    <span className="w-6 h-6 bg-primary-100 text-primary text-sm font-bold rounded-full flex items-center justify-center">
                      {idx + 1}
                    </span>
                    <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                      {question.question_type === 'multiple_choice' ? t('question.multipleChoice') :
                       question.question_type === 'true_false' ? t('question.trueFalse') :
                       question.question_type === 'short_answer' ? t('question.shortAnswer') : t('question.essay')}
                    </span>
                    <span className="text-xs text-gray-500">{question.points} {t('exam.points')}</span>
                  </div>
                  <p className="text-gray-800">{question.question_text}</p>
                  {question.options && question.options.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {question.options.map((opt, optIdx) => (
                        <div key={opt.id || optIdx} className={`text-sm px-2 py-1 rounded ${
                          JSON.stringify(question.correct_answer) === JSON.stringify(opt.id) 
                            ? 'bg-success-50 text-success-700' 
                            : 'text-gray-600'
                        }`}>
                          {opt.id}. {opt.text}
                          {JSON.stringify(question.correct_answer) === JSON.stringify(opt.id) && ' ✓'}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center space-x-1 ml-4">
                  <button
                    onClick={() => { setEditingQuestion(question); setShowAddForm(false); }}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    title={t('question.edit')}
                  >
                    <Edit2 className="w-4 h-4 text-gray-500" />
                  </button>
                  <button
                    onClick={() => handleDeleteQuestion(question.id)}
                    className="p-2 hover:bg-danger-50 rounded-lg transition-colors"
                    title={t('question.delete')}
                  >
                    <Trash2 className="w-4 h-4 text-danger" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : !showAddForm && (
        <div className="text-center py-12 bg-gray-50 rounded-xl">
          <ClipboardList className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500 mb-2">{t('question.noQuestions')}</p>
          <p className="text-sm text-gray-400 mb-4">{t('question.noQuestionsDesc')}</p>
          <button
            onClick={() => { setEditingQuestion(null); setShowAddForm(true); }}
            className="btn-primary"
          >
            <Plus className="w-5 h-5 mr-2" />
            {t('question.add')}
          </button>
        </div>
      )}

      {/* Close button */}
      <div className="flex justify-end pt-4 border-t border-gray-200">
        <button onClick={onClose} className="btn-secondary">
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}

// ============================================
// QUESTION FORM (for add/edit)
// ============================================

// Minimum number of options for multiple choice questions
const MIN_QUESTION_OPTIONS = 2;
const MAX_QUESTION_OPTIONS = 6;

function QuestionForm({ question, onSave, onCancel, saving }) {
  const { t } = useLanguage();
  const [formData, setFormData] = useState({
    question_text: question?.question_text || '',
    question_type: question?.question_type || 'multiple_choice',
    options: question?.options || [
      { id: 'A', text: '' },
      { id: 'B', text: '' },
      { id: 'C', text: '' },
      { id: 'D', text: '' }
    ],
    correct_answer: question?.correct_answer || 'A',
    points: question?.points || 1,
    difficulty: question?.difficulty || 'medium',
    explanation: question?.explanation || ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.question_text.trim()) {
      toast.error(t('validation.required'));
      return;
    }
    onSave(formData);
  };

  const handleOptionChange = (index, value) => {
    const newOptions = [...formData.options];
    newOptions[index] = { ...newOptions[index], text: value };
    setFormData(prev => ({ ...prev, options: newOptions }));
  };

  const addOption = () => {
    const nextLetter = String.fromCharCode(65 + formData.options.length);
    setFormData(prev => ({
      ...prev,
      options: [...prev.options, { id: nextLetter, text: '' }]
    }));
  };

  const removeOption = (index) => {
    if (formData.options.length <= MIN_QUESTION_OPTIONS) return;
    const newOptions = formData.options.filter((_, i) => i !== index);
    // Re-assign letters
    const reorderedOptions = newOptions.map((opt, i) => ({
      ...opt,
      id: String.fromCharCode(65 + i)
    }));
    setFormData(prev => ({
      ...prev,
      options: reorderedOptions,
      correct_answer: reorderedOptions[0]?.id || 'A'
    }));
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 bg-gray-50 rounded-xl space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('question.text')} <span className="text-danger">*</span>
        </label>
        <textarea
          value={formData.question_text}
          onChange={(e) => setFormData(prev => ({ ...prev, question_text: e.target.value }))}
          placeholder={t('question.textPlaceholder')}
          rows={3}
          className="input resize-none"
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('question.type')}</label>
          <select
            value={formData.question_type}
            onChange={(e) => setFormData(prev => ({ ...prev, question_type: e.target.value }))}
            className="input"
          >
            <option value="multiple_choice">{t('question.multipleChoice')}</option>
            <option value="true_false">{t('question.trueFalse')}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('question.points')}</label>
          <input
            type="number"
            value={formData.points}
            onChange={(e) => setFormData(prev => ({ ...prev, points: parseFloat(e.target.value) || 1 }))}
            min={0.5}
            step={0.5}
            className="input"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('question.difficulty')}</label>
          <select
            value={formData.difficulty}
            onChange={(e) => setFormData(prev => ({ ...prev, difficulty: e.target.value }))}
            className="input"
          >
            <option value="easy">{t('question.difficultyEasy')}</option>
            <option value="medium">{t('question.difficultyMedium')}</option>
            <option value="hard">{t('question.difficultyHard')}</option>
          </select>
        </div>
      </div>

      {formData.question_type === 'multiple_choice' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">{t('question.options')}</label>
          <div className="space-y-2">
            {formData.options.map((option, idx) => (
              <div key={idx} className="flex items-center space-x-2">
                <input
                  type="radio"
                  name="correct_answer"
                  checked={formData.correct_answer === option.id}
                  onChange={() => setFormData(prev => ({ ...prev, correct_answer: option.id }))}
                  className="w-4 h-4 text-primary"
                />
                <span className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-sm font-medium">
                  {option.id}
                </span>
                <input
                  type="text"
                  value={option.text}
                  onChange={(e) => handleOptionChange(idx, e.target.value)}
                  placeholder={t('question.optionPlaceholder')}
                  className="input flex-1"
                />
                {formData.options.length > MIN_QUESTION_OPTIONS && (
                  <button
                    type="button"
                    onClick={() => removeOption(idx)}
                    className="p-2 hover:bg-danger-50 rounded-lg transition-colors text-danger"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {formData.options.length < MAX_QUESTION_OPTIONS && (
            <button
              type="button"
              onClick={addOption}
              className="mt-2 text-sm text-primary hover:text-primary-700 flex items-center"
            >
              <Plus className="w-4 h-4 mr-1" />
              {t('question.addOption')}
            </button>
          )}
        </div>
      )}

      {formData.question_type === 'true_false' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">{t('question.correctAnswer')}</label>
          <div className="flex space-x-4">
            <label className="flex items-center space-x-2">
              <input
                type="radio"
                name="tf_answer"
                checked={formData.correct_answer === true || formData.correct_answer === 'true'}
                onChange={() => setFormData(prev => ({ ...prev, correct_answer: true }))}
                className="w-4 h-4 text-primary"
              />
              <span>{t('common.yes')}</span>
            </label>
            <label className="flex items-center space-x-2">
              <input
                type="radio"
                name="tf_answer"
                checked={formData.correct_answer === false || formData.correct_answer === 'false'}
                onChange={() => setFormData(prev => ({ ...prev, correct_answer: false }))}
                className="w-4 h-4 text-primary"
              />
              <span>{t('common.no')}</span>
            </label>
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">{t('question.explanation')}</label>
        <textarea
          value={formData.explanation}
          onChange={(e) => setFormData(prev => ({ ...prev, explanation: e.target.value }))}
          placeholder={t('question.explanationPlaceholder')}
          rows={2}
          className="input resize-none"
        />
      </div>

      <div className="flex items-center justify-end space-x-3">
        <button type="button" onClick={onCancel} className="btn-secondary">
          {t('common.cancel')}
        </button>
        <button type="submit" disabled={saving} className="btn-primary">
          {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {t('common.save')}
        </button>
      </div>
    </form>
  );
}

// ============================================
// STUDENT ANALYTICS TAB
// ============================================

function StudentAnalyticsTab({ classId, exams }) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false); // Start with false since no exam is selected
  const [selectedExamId, setSelectedExamId] = useState('');
  const [sessions, setSessions] = useState([]);
  const [analyticsData, setAnalyticsData] = useState(null);

  // Load sessions for selected exam
  useEffect(() => {
    const loadSessions = async () => {
      if (!selectedExamId) {
        setSessions([]);
        setAnalyticsData(null);
        return;
      }

      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('exam_sessions')
          .select(`
            *,
            student:profiles(id, full_name, email, student_id)
          `)
          .eq('exam_id', selectedExamId)
          .order('submitted_at', { ascending: false });

        if (error) throw error;
        setSessions(data || []);

        // Calculate aggregate analytics
        if (data && data.length > 0) {
          const submitted = data.filter(s => s.status === 'submitted' || s.status === 'auto_submitted');
          const avgScore = submitted.length > 0 
            ? submitted.reduce((acc, s) => acc + (s.percentage || 0), 0) / submitted.length 
            : 0;
          const passCount = submitted.filter(s => s.passed).length;
          const avgViolations = submitted.length > 0
            ? submitted.reduce((acc, s) => acc + (s.cheat_count || 0) + (s.tab_violations || 0), 0) / submitted.length
            : 0;
          const flaggedCount = submitted.filter(s => s.is_flagged || (s.cheat_count || 0) > 2).length;

          setAnalyticsData({
            totalStudents: data.length,
            submittedCount: submitted.length,
            avgScore: avgScore.toFixed(1),
            passRate: submitted.length > 0 ? ((passCount / submitted.length) * 100).toFixed(1) : 0,
            avgViolations: avgViolations.toFixed(1),
            flaggedCount,
            highestScore: submitted.length > 0 ? Math.max(...submitted.map(s => s.percentage || 0)).toFixed(1) : 0,
            lowestScore: submitted.length > 0 ? Math.min(...submitted.map(s => s.percentage || 0)).toFixed(1) : 0,
          });
        } else {
          setAnalyticsData(null);
        }
      } catch (err) {
        console.error('Load sessions error:', err);
        toast.error(t('error.general'));
      } finally {
        setLoading(false);
      }
    };

    loadSessions();
  }, [selectedExamId, t]);

  const formatDateTime = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getIntegrityStatus = (session) => {
    const violations = (session.cheat_count || 0) + (session.tab_violations || 0) + (session.fullscreen_violations || 0);
    if (violations === 0) return { label: t('analytics.integrity.good'), color: 'bg-success-100 text-success-700' };
    if (violations <= 3) return { label: t('analytics.integrity.warning'), color: 'bg-warning-100 text-warning-700' };
    return { label: t('analytics.integrity.suspicious'), color: 'bg-danger-100 text-danger-700' };
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text-main">{t('tabs.analytics')}</h2>
        <div className="w-64">
          <select
            value={selectedExamId}
            onChange={(e) => setSelectedExamId(e.target.value)}
            className="input"
          >
            <option value="">{t('analytics.selectExam')}</option>
            {exams.map((exam) => (
              <option key={exam.id} value={exam.id}>{exam.title}</option>
            ))}
          </select>
        </div>
      </div>

      {!selectedExamId ? (
        <div className="text-center py-12 bg-gray-50 rounded-xl">
          <BarChart3 className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500">{t('analytics.selectExamPrompt')}</p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : !analyticsData ? (
        <div className="text-center py-12 bg-gray-50 rounded-xl">
          <BarChart3 className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <p className="text-gray-500">{t('analytics.noData')}</p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-4 gap-4">
            <div className="card">
              <p className="text-sm text-gray-500 mb-1">{t('analytics.totalStudents')}</p>
              <p className="text-2xl font-bold text-text-main">{analyticsData.submittedCount}/{analyticsData.totalStudents}</p>
            </div>
            <div className="card">
              <p className="text-sm text-gray-500 mb-1">{t('analytics.avgScore')}</p>
              <p className="text-2xl font-bold text-primary">{analyticsData.avgScore}%</p>
            </div>
            <div className="card">
              <p className="text-sm text-gray-500 mb-1">{t('analytics.passRate')}</p>
              <p className="text-2xl font-bold text-success">{analyticsData.passRate}%</p>
            </div>
            <div className="card">
              <p className="text-sm text-gray-500 mb-1">{t('analytics.flagged')}</p>
              <p className="text-2xl font-bold text-danger">{analyticsData.flaggedCount}</p>
            </div>
          </div>

          {/* Score Distribution - Visual Bar Chart */}
          <div className="card">
            <h3 className="font-semibold text-gray-900 mb-4">{t('analytics.scoreDistribution')}</h3>
            
            {/* Visual Score Distribution Bars */}
            <div className="space-y-3 mb-6">
              {/* Calculate score ranges */}
              {(() => {
                const ranges = [
                  { label: '90-100%', min: 90, max: 100, color: 'bg-success-600' },
                  { label: '80-89%', min: 80, max: 89, color: 'bg-success-500' },
                  { label: '70-79%', min: 70, max: 79, color: 'bg-primary' },
                  { label: '60-69%', min: 60, max: 69, color: 'bg-warning-500' },
                  { label: '50-59%', min: 50, max: 59, color: 'bg-warning-600' },
                  { label: '0-49%', min: 0, max: 49, color: 'bg-danger' },
                ];
                
                const submitted = sessions.filter(s => s.status === 'submitted' || s.status === 'auto_submitted');
                const total = submitted.length || 1;
                
                return ranges.map((range) => {
                  const count = submitted.filter(s => 
                    (s.percentage || 0) >= range.min && (s.percentage || 0) <= range.max
                  ).length;
                  const percentage = (count / total) * 100;
                  
                  return (
                    <div key={range.label} className="flex items-center space-x-3">
                      <span className="text-sm text-gray-600 w-20">{range.label}</span>
                      <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
                        <div 
                          className={`h-full ${range.color} transition-all duration-500`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium text-gray-700 w-16 text-right">
                        {count} ({percentage.toFixed(0)}%)
                      </span>
                    </div>
                  );
                });
              })()}
            </div>
            
            {/* Summary Stats */}
            <div className="flex items-center space-x-4 text-sm pt-4 border-t border-gray-100">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-success rounded-full"></div>
                <span>{t('analytics.highestScore')}: {analyticsData.highestScore}%</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-danger rounded-full"></div>
                <span>{t('analytics.lowestScore')}: {analyticsData.lowestScore}%</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-primary rounded-full"></div>
                <span>{t('analytics.avgScore')}: {analyticsData.avgScore}%</span>
              </div>
            </div>
          </div>

          {/* Session Details Table */}
          <div className="card overflow-hidden p-0">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">{t('table.number')}</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">{t('table.name')}</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">{t('analytics.score')}</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">{t('analytics.submittedAt')}</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">{t('analytics.violations')}</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">{t('analytics.integrity')}</th>
                  <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">{t('table.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sessions.map((session, idx) => {
                  const integrity = getIntegrityStatus(session);
                  return (
                    <tr key={session.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-500">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium text-text-main">{session.student?.full_name || 'N/A'}</p>
                          <p className="text-xs text-gray-500">{session.student?.email}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-bold ${session.passed ? 'text-success' : 'text-danger'}`}>
                          {session.percentage?.toFixed(1) || 0}%
                        </span>
                        <span className="text-xs text-gray-500 ml-1">
                          ({session.total_score}/{session.max_score})
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {formatDateTime(session.submitted_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center space-x-2 text-xs">
                          <span className="px-2 py-0.5 bg-warning-50 text-warning-700 rounded">
                            AI: {session.cheat_count || 0}
                          </span>
                          <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                            Tab: {session.tab_violations || 0}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${integrity.color}`}>
                          {integrity.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`badge ${
                          session.status === 'submitted' ? 'badge-success' :
                          session.status === 'auto_submitted' ? 'bg-warning-100 text-warning-700' :
                          session.status === 'in_progress' ? 'bg-primary-100 text-primary-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {session.status === 'submitted' ? t('analytics.status.submitted') :
                           session.status === 'auto_submitted' ? t('analytics.status.autoSubmitted') :
                           session.status === 'in_progress' ? t('analytics.status.inProgress') :
                           session.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================
// CREATE CLASS FORM
// ============================================

// Generate academic year options (Vietnamese format: YYYY-YYYY+1)
function generateAcademicYearOptions() {
  const currentYear = new Date().getFullYear();
  const options = [];
  // Generate past and future years based on configuration
  for (let i = -ACADEMIC_YEAR_PAST_YEARS; i <= ACADEMIC_YEAR_FUTURE_YEARS; i++) {
    const startYear = currentYear + i;
    options.push(`${startYear}-${startYear + 1}`);
  }
  return options;
}

function CreateClassForm({ onClose, onSuccess }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const MAX_RETRIES = 3;
  const currentYear = new Date().getFullYear();
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
    semester: '',
    academic_year: `${currentYear}-${currentYear + 1}`, // Vietnamese format: 2025-2026
  });
  
  const academicYearOptions = generateAcademicYearOptions();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Prevent double-click
    if (loading) return;

    const trimmedName = formData.name.trim();
    const trimmedCode = formData.code.trim();

    if (!trimmedName || !trimmedCode) {
      toast.error(t('validation.enterNameAndCode'));
      return;
    }

    // Validate class code format
    if (!isValidClassCode(trimmedCode)) {
      toast.error(t('validation.invalidClassCode'));
      return;
    }

    // Validate name length
    if (trimmedName.length > 100) {
      toast.error(t('validation.classNameTooLong'));
      return;
    }

    setLoading(true);
    
    const createClass = async (attempt = 0) => {
      try {
        // Use Promise.race for timeout since Supabase doesn't support AbortController
        const TIMEOUT_MS = 15000;
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('REQUEST_TIMEOUT')), TIMEOUT_MS)
        );

        // Use RPC function for reliable class creation (bypasses RLS issues)
        const supabasePromise = supabase.rpc('create_class', {
          p_name: trimmedName,
          p_code: trimmedCode,
          p_description: formData.description?.trim() || null,
          p_semester: formData.semester || null,
          p_academic_year: formData.academic_year || null
        });

        const { data, error } = await Promise.race([supabasePromise, timeoutPromise]);

        if (error) throw error;
        
        // Check the result from RPC function
        if (data && !data.success) {
          // Handle RPC-level errors
          if (data.error === 'duplicate_code') {
            toast.error(t('class.duplicateCode'));
          } else if (data.error === 'not_authorized') {
            toast.error(t('class.noPermission'));
          } else if (data.error === 'profile_not_found') {
            toast.error(t('error.sessionExpired'));
          } else {
            toast.error(t('class.createError'));
          }
          return;
        }

        toast.success(t('class.createSuccess'));
        onSuccess?.(data);
        onClose();
      } catch (error) {
        console.error('Create class error:', error);
        
        // Handle specific error cases with user-friendly messages
        if (error.message === 'REQUEST_TIMEOUT') {
          if (attempt < MAX_RETRIES) {
            setRetryCount(attempt + 1);
            toast.info(t('error.retrying', { attempt: attempt + 1, max: MAX_RETRIES }));
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
            return createClass(attempt + 1);
          }
          toast.error(t('error.timeout'));
        } else if (error.code === '23505') {
          toast.error(t('class.duplicateCode'));
        } else if (error.code === '42501' || error.message?.includes('permission')) {
          toast.error(t('class.noPermission'));
        } else if (error.message?.includes('network') || error.message?.includes('fetch')) {
          toast.error(t('error.network'));
        } else {
          toast.error(t('class.createError'));
        }
        setRetryCount(0);
      } finally {
        setLoading(false);
      }
    };

    await createClass(0);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('class.name')} <span className="text-danger">*</span>
        </label>
        <input
          type="text"
          name="name"
          value={formData.name}
          onChange={handleChange}
          placeholder={t('class.namePlaceholder')}
          className="input"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('class.code')} <span className="text-danger">*</span>
        </label>
        <input
          type="text"
          name="code"
          value={formData.code}
          onChange={handleChange}
          placeholder={t('class.codePlaceholder')}
          className="input"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('class.description')}
        </label>
        <textarea
          name="description"
          value={formData.description}
          onChange={handleChange}
          placeholder={t('class.descriptionPlaceholder')}
          rows={2}
          className="input resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('class.semester')}
          </label>
          <select
            name="semester"
            value={formData.semester}
            onChange={handleChange}
            className="input"
          >
            <option value="">{t('class.semesterSelect')}</option>
            <option value="1">{t('class.semester1')}</option>
            <option value="2">{t('class.semester2')}</option>
            <option value="3">{t('class.semesterSummer')}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('class.year')}
          </label>
          <select
            name="academic_year"
            value={formData.academic_year}
            onChange={handleChange}
            className="input"
          >
            {academicYearOptions.map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-200">
        <button type="button" onClick={onClose} className="btn-secondary">
          {t('common.cancel')}
        </button>
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? (
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          ) : (
            <Save className="w-5 h-5 mr-2" />
          )}
          {t('instructor.createClass')}
        </button>
      </div>
    </form>
  );
}

// ============================================
// MAIN INSTRUCTOR DASHBOARD
// ============================================

export default function InstructorDashboard() {
  const { user, profile, logout } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  
  // Data state
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);
  const [exams, setExams] = useState([]);
  const [students, setStudents] = useState([]);
  const [stats, setStats] = useState({
    totalStudents: 0,
    totalExams: 0,
    activeExams: 0,
    flaggedSessions: 0
  });

  // UI state
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('exams'); // 'exams' | 'students' | 'analytics'
  const [showCreateExam, setShowCreateExam] = useState(false);
  const [showEditExam, setShowEditExam] = useState(false);
  const [examToEdit, setExamToEdit] = useState(null);
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [showCreateClass, setShowCreateClass] = useState(false);
  const [showManageQuestions, setShowManageQuestions] = useState(false);
  const [selectedExam, setSelectedExam] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [examSessions, setExamSessions] = useState([]);
  const [selectedExamForAnalytics, setSelectedExamForAnalytics] = useState(null);
  const [showProfileSettings, setShowProfileSettings] = useState(false);

  // Handler to open edit exam modal
  const handleEditExam = (exam) => {
    setExamToEdit(exam);
    setShowEditExam(true);
  };

  // Load classes
  useEffect(() => {
    const loadClasses = async () => {
      if (!user) return;

      try {
        const { data, error } = await supabase
          .from('classes')
          .select('*')
          .eq('instructor_id', user.id)
          .order('created_at', { ascending: false });

        if (error) throw error;
        setClasses(data || []);
        
        if (data && data.length > 0 && !selectedClass) {
          setSelectedClass(data[0]);
        }
      } catch (err) {
        console.error('Load classes error:', err);
      } finally {
        setLoading(false);
      }
    };

    loadClasses();
  }, [user]);

  // Load class data when selected class changes
  useEffect(() => {
    if (!selectedClass) return;

    const loadClassData = async () => {
      try {
        // Load exams
        const { data: examsData } = await supabase
          .from('exams')
          .select('*')
          .eq('class_id', selectedClass.id)
          .order('created_at', { ascending: false });
        setExams(examsData || []);

        // Load enrollments with student profiles using RPC (more reliable than direct query with RLS)
        if (import.meta.env.DEV) {
          console.log('[InstructorDashboard] Loading enrollments for class:', selectedClass.id);
        }
        
        // Try RPC first for better reliability, fallback to direct query
        let enrollmentsData = [];
        let enrollError = null;
        
        try {
          const { data: rpcResult, error: rpcError } = await supabase.rpc('get_class_enrollments', {
            p_class_id: selectedClass.id
          });
          
          if (!rpcError && rpcResult?.success) {
            enrollmentsData = rpcResult.enrollments || [];
            if (import.meta.env.DEV) {
              console.log('[InstructorDashboard] Loaded enrollments via RPC:', enrollmentsData.length, enrollmentsData);
            }
          } else {
            // Provide detailed error for debugging
            const errorDetail = rpcError?.message || rpcResult?.error || 'Unknown RPC error';
            throw new Error(`get_class_enrollments RPC failed: ${errorDetail}. This may occur if the RPC function is not deployed in Supabase.`);
          }
        } catch (rpcErr) {
          console.warn('[InstructorDashboard] RPC get_class_enrollments failed, trying direct query:', rpcErr.message || rpcErr);
          // Fallback to direct query
          const result = await supabase
            .from('enrollments')
            .select(`
              *,
              student:profiles(*)
            `)
            .eq('class_id', selectedClass.id);
          
          enrollmentsData = result.data || [];
          enrollError = result.error;
          
          if (enrollError) {
            console.error('[InstructorDashboard] Error loading enrollments:', enrollError);
          } else if (import.meta.env.DEV) {
            console.log('[InstructorDashboard] Loaded enrollments via direct query:', enrollmentsData.length, enrollmentsData);
          }
        }
        
        setStudents(enrollmentsData);

        // Calculate stats
        const activeExams = (examsData || []).filter(e => e.status === 'published').length;
        setStats({
          totalStudents: (enrollmentsData || []).length,
          totalExams: (examsData || []).length,
          activeExams,
          flaggedSessions: 0 // Would need to query exam_sessions
        });
      } catch (err) {
        console.error('Load class data error:', err);
      }
    };

    loadClassData();

    // Subscribe to realtime enrollment changes for this class
    const enrollmentSubscription = supabase
      .channel(`enrollments-class-${selectedClass.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'enrollments',
          filter: `class_id=eq.${selectedClass.id}`
        },
        (payload) => {
          console.log('Enrollment change detected:', payload);
          // Reload enrollments when any change occurs
          loadClassData();
          
          // Show toast notification for new enrollments
          if (payload.eventType === 'INSERT') {
            toast.success(t('student.studentJoined'));
          }
        }
      )
      .subscribe();

    return () => {
      enrollmentSubscription.unsubscribe();
    };
  }, [selectedClass, t]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handlePublishExam = async (examId) => {
    try {
      const { error } = await supabase
        .from('exams')
        .update({ status: 'published' })
        .eq('id', examId);

      if (error) throw error;

      setExams(prev => prev.map(e => 
        e.id === examId ? { ...e, status: 'published' } : e
      ));
      toast.success(t('exam.published'));
    } catch (err) {
      toast.error(t('error.general'));
    }
  };

  const handleRemoveStudent = async (enrollmentId) => {
    if (!window.confirm(t('student.removeConfirm'))) return;

    try {
      const { error } = await supabase
        .from('enrollments')
        .delete()
        .eq('id', enrollmentId);

      if (error) throw error;

      setStudents(prev => prev.filter(s => s.id !== enrollmentId));
      toast.success(t('student.removeSuccess'));
    } catch (err) {
      toast.error(t('error.general'));
    }
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getExamStatus = (exam) => {
    const now = new Date();
    const start = new Date(exam.start_time);
    const end = new Date(exam.end_time);

    if (exam.status === 'draft') return { label: t('exam.status.draft'), color: 'bg-gray-100 text-gray-700' };
    if (now < start) return { label: t('exam.status.upcoming'), color: 'bg-primary-100 text-primary-700' };
    if (now > end) return { label: t('exam.status.ended'), color: 'bg-gray-100 text-gray-600' };
    return { label: t('exam.status.active'), color: 'bg-success-100 text-success-700' };
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="bg-paper shadow-sm border-b border-gray-200 px-6 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center space-x-3">
          <div className="bg-primary p-2 rounded-lg">
            <FileText className="text-white w-6 h-6" />
          </div>
          <div>
            <span className="text-xl font-bold text-text-main tracking-tight">
              SmartExam<span className="text-primary">Pro</span>
            </span>
            <span className="text-xs text-gray-500 ml-2">{t('instructor.title')}</span>
          </div>
        </div>
        
        <div className="flex items-center space-x-4">
          <LanguageSwitcher compact />
          <button
            onClick={() => setShowProfileSettings(true)}
            className="flex items-center space-x-2 text-sm font-medium text-gray-600 bg-gray-100 px-3 py-1.5 rounded-full hover:bg-gray-200 transition-colors cursor-pointer"
            title={t('profile.settings') || 'Cài đặt tài khoản'}
          >
            <GraduationCap className="w-4 h-4" />
            <span>{profile?.full_name || user?.email}</span>
            <Settings className="w-3.5 h-3.5 text-gray-400" />
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center space-x-2 text-danger hover:bg-danger-50 px-4 py-2 rounded-lg transition-colors text-sm font-semibold"
          >
            <LogOut className="w-4 h-4" />
            <span>{t('auth.logout')}</span>
          </button>
        </div>
      </nav>

      {/* Profile Settings Modal */}
      <ProfileSettings 
        isOpen={showProfileSettings} 
        onClose={() => setShowProfileSettings(false)} 
      />

      <div className="flex">
        {/* Sidebar - Class List */}
        <aside className="w-64 bg-paper border-r border-gray-200 min-h-[calc(100vh-65px)] p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-gray-700">{t('instructor.classes')}</h2>
            <button
              onClick={() => setShowCreateClass(true)}
              className="p-1.5 hover:bg-primary-50 rounded-lg transition-colors"
              title={t('instructor.createClass')}
            >
              <Plus className="w-5 h-5 text-primary" />
            </button>
          </div>

          <div className="space-y-2">
            {classes.map((cls) => (
              <button
                key={cls.id}
                onClick={() => setSelectedClass(cls)}
                className={`w-full text-left p-3 rounded-xl transition-all ${
                  selectedClass?.id === cls.id
                    ? 'bg-primary-50 border-2 border-primary'
                    : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
                }`}
              >
                <p className={`font-semibold text-sm ${
                  selectedClass?.id === cls.id ? 'text-primary' : 'text-gray-800'
                }`}>
                  {cls.name}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{cls.code}</p>
              </button>
            ))}

            {classes.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <BookOpen className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">{t('instructor.noClasses')}</p>
                <button
                  onClick={() => setShowCreateClass(true)}
                  className="text-primary text-sm mt-2 hover:underline"
                >
                  {t('instructor.createFirstClass')}
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6">
          {selectedClass ? (
            <>
              {/* Class Header */}
              <div className="mb-6">
                <h1 className="text-2xl font-bold text-text-main">{selectedClass.name}</h1>
                <p className="text-gray-500">{t('instructor.classCode')}: {selectedClass.code}</p>
              </div>

              {/* Stats Cards */}
              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="card flex items-center space-x-4">
                  <div className="p-3 bg-primary-100 rounded-xl">
                    <Users className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-text-main">{stats.totalStudents}</p>
                    <p className="text-sm text-gray-500">{t('stats.students')}</p>
                  </div>
                </div>
                
                <div className="card flex items-center space-x-4">
                  <div className="p-3 bg-success-100 rounded-xl">
                    <ClipboardList className="w-6 h-6 text-success" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-text-main">{stats.totalExams}</p>
                    <p className="text-sm text-gray-500">{t('stats.exams')}</p>
                  </div>
                </div>

                <div className="card flex items-center space-x-4">
                  <div className="p-3 bg-warning-100 rounded-xl">
                    <Activity className="w-6 h-6 text-warning" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-text-main">{stats.activeExams}</p>
                    <p className="text-sm text-gray-500">{t('stats.active')}</p>
                  </div>
                </div>

                <div className="card flex items-center space-x-4">
                  <div className="p-3 bg-danger-100 rounded-xl">
                    <AlertTriangle className="w-6 h-6 text-danger" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-text-main">{stats.flaggedSessions}</p>
                    <p className="text-sm text-gray-500">{t('stats.suspicious')}</p>
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex space-x-1 p-1 bg-gray-100 rounded-xl mb-6 w-fit">
                {[
                  { id: 'exams', label: t('tabs.exams'), icon: ClipboardList },
                  { id: 'students', label: t('tabs.students'), icon: Users },
                  { id: 'analytics', label: t('tabs.analytics'), icon: BarChart3 },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === tab.id
                        ? 'bg-white shadow text-primary'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <tab.icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              {activeTab === 'exams' && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-text-main">{t('tabs.exams')}</h2>
                    <button
                      onClick={() => setShowCreateExam(true)}
                      className="btn-primary"
                    >
                      <Plus className="w-5 h-5 mr-2" />
                      {t('exam.create')}
                    </button>
                  </div>

                  {exams.length > 0 ? (
                    <div className="space-y-3">
                      {exams.map((exam) => {
                        const status = getExamStatus(exam);
                        return (
                          <div key={exam.id} className="card hover:shadow-soft transition-shadow">
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <div className="flex items-center space-x-3">
                                  <h3 className="font-semibold text-text-main">{exam.title}</h3>
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                                    {status.label}
                                  </span>
                                </div>
                                <div className="flex items-center space-x-4 mt-2 text-sm text-gray-500">
                                  <span className="flex items-center space-x-1">
                                    <Clock className="w-4 h-4" />
                                    <span>{exam.duration_minutes} {t('exam.minutes')}</span>
                                  </span>
                                  <span className="flex items-center space-x-1">
                                    <Calendar className="w-4 h-4" />
                                    <span>{formatDate(exam.start_time)}</span>
                                  </span>
                                </div>
                              </div>
                              
                              <div className="flex items-center space-x-2">
                                {/* Edit button - always visible */}
                                <button 
                                  onClick={() => handleEditExam(exam)}
                                  className="btn-secondary text-sm"
                                  title={t('exam.edit')}
                                >
                                  <Edit2 className="w-4 h-4 mr-1" />
                                  {t('exam.edit')}
                                </button>
                                
                                {exam.status === 'draft' && (
                                  <button
                                    onClick={() => handlePublishExam(exam.id)}
                                    className="btn-success text-sm"
                                  >
                                    <CheckCircle className="w-4 h-4 mr-1" />
                                    {t('exam.publish')}
                                  </button>
                                )}
                                <button 
                                  onClick={() => {
                                    setSelectedExam(exam);
                                    setShowManageQuestions(true);
                                  }}
                                  className="btn-secondary text-sm"
                                  title={t('exam.manageQuestions')}
                                >
                                  <ClipboardList className="w-4 h-4 mr-1" />
                                  {t('exam.manageQuestions')}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-12 bg-gray-50 rounded-xl">
                      <ClipboardList className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                      <p className="text-gray-500 mb-4">{t('exam.noExams')}</p>
                      <button
                        onClick={() => setShowCreateExam(true)}
                        className="btn-primary"
                      >
                        <Plus className="w-5 h-5 mr-2" />
                        {t('exam.createFirst')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'students' && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-text-main">{t('tabs.students')}</h2>
                    <button
                      onClick={() => setShowAddStudent(true)}
                      className="btn-primary"
                    >
                      <Plus className="w-5 h-5 mr-2" />
                      {t('student.add')}
                    </button>
                  </div>

                  {/* Search */}
                  <div className="relative mb-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      placeholder={t('student.searchPlaceholder')}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="input pl-10"
                    />
                  </div>

                  {students.length > 0 ? (
                    <div className="card overflow-hidden p-0">
                      <table className="w-full">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">{t('table.number')}</th>
                            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">{t('table.name')}</th>
                            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">{t('table.email')}</th>
                            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">{t('table.studentId')}</th>
                            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">{t('student.enrolledAt')}</th>
                            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">{t('table.status')}</th>
                            <th className="text-right px-4 py-3 text-sm font-semibold text-gray-700">{t('table.actions')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {students
                            .filter(s => {
                              if (!searchQuery) return true;
                              const q = searchQuery.toLowerCase();
                              return (
                                s.student?.full_name?.toLowerCase().includes(q) ||
                                s.student?.email?.toLowerCase().includes(q) ||
                                s.student?.student_id?.toLowerCase().includes(q)
                              );
                            })
                            .map((enrollment, idx) => {
                              // Check if student joined within last 5 minutes for "NEW" indicator
                              const isNewlyJoined = enrollment.enrolled_at && 
                                (Date.now() - new Date(enrollment.enrolled_at).getTime()) < 5 * 60 * 1000;
                              
                              return (
                              <tr key={enrollment.id} className={`hover:bg-gray-50 transition-colors ${isNewlyJoined ? 'bg-success-50' : ''}`}>
                                <td className="px-4 py-3 text-sm text-gray-500">{idx + 1}</td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center space-x-3">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isNewlyJoined ? 'bg-success-100 ring-2 ring-success-300 ring-offset-1' : 'bg-primary-100'}`}>
                                      <User className={`w-4 h-4 ${isNewlyJoined ? 'text-success' : 'text-primary'}`} />
                                    </div>
                                    <div className="flex items-center space-x-2">
                                      <span className="font-medium text-text-main">
                                        {enrollment.student?.full_name || 'N/A'}
                                      </span>
                                      {isNewlyJoined && (
                                        <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase bg-success text-white rounded animate-pulse">
                                          NEW
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-600">
                                  {enrollment.student?.email}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-600">
                                  {enrollment.student?.student_id || '-'}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-500">
                                  {enrollment.enrolled_at ? new Date(enrollment.enrolled_at).toLocaleString('vi-VN', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  }) : '-'}
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`badge ${
                                    enrollment.status === 'active' 
                                      ? 'badge-success' 
                                      : 'bg-gray-100 text-gray-600'
                                  }`}>
                                    {enrollment.status === 'active' ? t('student.statusActive') : enrollment.status}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <button
                                    onClick={() => handleRemoveStudent(enrollment.id)}
                                    className="p-2 hover:bg-danger-50 rounded-lg transition-colors text-danger"
                                    title={t('student.remove')}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </td>
                              </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-12 bg-gray-50 rounded-xl">
                      <Users className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                      <p className="text-gray-500 mb-4">{t('student.noStudents')}</p>
                      <button
                        onClick={() => setShowAddStudent(true)}
                        className="btn-primary"
                      >
                        <Plus className="w-5 h-5 mr-2" />
                        {t('student.add')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'analytics' && (
                <StudentAnalyticsTab 
                  classId={selectedClass?.id} 
                  exams={exams}
                />
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-[60vh]">
              <div className="text-center">
                <BookOpen className="w-20 h-20 mx-auto mb-4 text-gray-300" />
                <h2 className="text-xl font-bold text-gray-700 mb-2">{t('instructor.welcome')}</h2>
                <p className="text-gray-500 mb-6">{t('instructor.welcomeDesc')}</p>
                <button
                  onClick={() => setShowCreateClass(true)}
                  className="btn-primary"
                >
                  <Plus className="w-5 h-5 mr-2" />
                  {t('instructor.createClass')}
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Modals */}
      <Modal
        isOpen={showCreateClass}
        onClose={() => setShowCreateClass(false)}
        title={t('instructor.createClassTitle')}
      >
        <CreateClassForm
          onClose={() => setShowCreateClass(false)}
          onSuccess={(newClass) => {
            setClasses(prev => [newClass, ...prev]);
            setSelectedClass(newClass);
          }}
        />
      </Modal>

      <Modal
        isOpen={showCreateExam}
        onClose={() => setShowCreateExam(false)}
        title={t('instructor.createExamTitle')}
      >
        <CreateExamForm
          classId={selectedClass?.id}
          onClose={() => setShowCreateExam(false)}
          onSuccess={(newExam) => {
            setExams(prev => [newExam, ...prev]);
          }}
        />
      </Modal>

      <Modal
        isOpen={showEditExam}
        onClose={() => {
          setShowEditExam(false);
          setExamToEdit(null);
        }}
        title={t('instructor.editExamTitle')}
      >
        {examToEdit && (
          <EditExamForm
            exam={examToEdit}
            onClose={() => {
              setShowEditExam(false);
              setExamToEdit(null);
            }}
            onSuccess={(updatedExam) => {
              setExams(prev => prev.map(e => e.id === updatedExam.id ? updatedExam : e));
            }}
          />
        )}
      </Modal>

      <Modal
        isOpen={showAddStudent}
        onClose={() => setShowAddStudent(false)}
        title={t('instructor.addStudentTitle')}
      >
        <AddStudentForm
          classId={selectedClass?.id}
          onClose={() => setShowAddStudent(false)}
          onSuccess={() => {
            // Reload students
            if (selectedClass) {
              supabase
                .from('enrollments')
                .select('*, student:profiles(*)')
                .eq('class_id', selectedClass.id)
                .then(({ data }) => setStudents(data || []));
            }
          }}
        />
      </Modal>

      <Modal
        isOpen={showManageQuestions}
        onClose={() => { setShowManageQuestions(false); setSelectedExam(null); }}
        title={t('exam.manageQuestions')}
      >
        {selectedExam && (
          <ManageQuestionsForm
            examId={selectedExam.id}
            examTitle={selectedExam.title}
            onClose={() => { setShowManageQuestions(false); setSelectedExam(null); }}
          />
        )}
      </Modal>
    </div>
  );
}