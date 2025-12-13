import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import {
  FileText, User, LogOut, Plus, Users, BookOpen, Clock,
  BarChart3, AlertTriangle, CheckCircle, Eye, Edit2, Trash2,
  Calendar, Search, Filter, Download, Settings, ChevronRight,
  GraduationCap, ClipboardList, Shield, Activity, X, Save, Loader2
} from 'lucide-react';

// ============================================
// UTILITY FUNCTIONS
// ============================================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return EMAIL_REGEX.test(email);
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
    
    // Validate
    if (!formData.title.trim()) {
      toast.error('Vui lòng nhập tên bài thi');
      return;
    }
    if (!formData.start_time || !formData.end_time) {
      toast.error('Vui lòng chọn thời gian bắt đầu và kết thúc');
      return;
    }
    if (new Date(formData.end_time) <= new Date(formData.start_time)) {
      toast.error('Thời gian kết thúc phải sau thời gian bắt đầu');
      return;
    }

    setLoading(true);
    
    const createExam = async (attempt = 0) => {
      const MAX_RETRIES = 3;
      const TIMEOUT_MS = 15000;
      try {
        // Use Promise.race for timeout since Supabase doesn't support AbortController
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('REQUEST_TIMEOUT')), TIMEOUT_MS)
        );

        const supabasePromise = supabase
          .from('exams')
          .insert({
            ...formData,
            class_id: classId,
            created_by: user.id,
            status: 'draft'
          })
          .select()
          .single();

        const { data, error } = await Promise.race([supabasePromise, timeoutPromise]);

        if (error) throw error;

        toast.success('Tạo bài thi thành công!');
        onSuccess?.(data);
        onClose();
      } catch (error) {
        console.error('Create exam error:', error);
        
        if (error.message === 'REQUEST_TIMEOUT') {
          if (attempt < MAX_RETRIES) {
            toast.info(`Đang thử lại... (${attempt + 1}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            return createExam(attempt + 1);
          }
          toast.error('Kết nối chậm. Vui lòng kiểm tra mạng và thử lại.');
        } else if (error.code === '42501' || error.message?.includes('permission')) {
          toast.error('Bạn không có quyền tạo bài thi. Vui lòng kiểm tra lại.');
        } else if (error.message?.includes('network') || error.message?.includes('fetch')) {
          toast.error('Lỗi kết nối mạng. Vui lòng kiểm tra và thử lại.');
        } else {
          toast.error('Không thể tạo bài thi. Vui lòng thử lại sau.');
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
          <span>Thông tin cơ bản</span>
        </h3>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Tên bài thi <span className="text-danger">*</span>
          </label>
          <input
            type="text"
            name="title"
            value={formData.title}
            onChange={handleChange}
            placeholder="VD: Kiểm tra giữa kỳ AI"
            className="input"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Mô tả
          </label>
          <textarea
            name="description"
            value={formData.description}
            onChange={handleChange}
            placeholder="Mô tả về nội dung bài thi..."
            rows={3}
            className="input resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Thời lượng (phút)
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
              Điểm đạt (%)
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
          <span>Thời gian thi</span>
        </h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bắt đầu <span className="text-danger">*</span>
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
              Kết thúc <span className="text-danger">*</span>
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
          <span>Cài đặt chống gian lận</span>
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
            <span className="text-sm text-gray-700">Yêu cầu Camera</span>
          </label>

          <label className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              name="require_fullscreen"
              checked={formData.require_fullscreen}
              onChange={handleChange}
              className="w-5 h-5 text-primary rounded"
            />
            <span className="text-sm text-gray-700">Yêu cầu Fullscreen</span>
          </label>

          <label className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              name="is_shuffled"
              checked={formData.is_shuffled}
              onChange={handleChange}
              className="w-5 h-5 text-primary rounded"
            />
            <span className="text-sm text-gray-700">Xáo trộn câu hỏi</span>
          </label>

          <label className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              name="show_result_immediately"
              checked={formData.show_result_immediately}
              onChange={handleChange}
              className="w-5 h-5 text-primary rounded"
            />
            <span className="text-sm text-gray-700">Hiển thị kết quả ngay</span>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Số lần rời tab tối đa
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
              Số lần thoát fullscreen tối đa
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
          Hủy
        </button>
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? (
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          ) : (
            <Save className="w-5 h-5 mr-2" />
          )}
          Tạo bài thi
        </button>
      </div>
    </form>
  );
}

// ============================================
// ADD STUDENT FORM
// ============================================

function AddStudentForm({ classId, onClose, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [bulkEmails, setBulkEmails] = useState('');
  const [mode, setMode] = useState('single'); // 'single' | 'bulk'

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const emails = mode === 'single' 
      ? [email.trim()]
      : bulkEmails.split('\n').map(e => e.trim()).filter(e => e);

    if (emails.length === 0) {
      toast.error('Vui lòng nhập email sinh viên');
      return;
    }

    // Validate email format using utility function
    const invalidEmails = emails.filter(e => !isValidEmail(e));
    if (invalidEmails.length > 0) {
      toast.error(`Email không hợp lệ: ${invalidEmails.slice(0, 3).join(', ')}${invalidEmails.length > 3 ? '...' : ''}`);
      return;
    }

    setLoading(true);
    let successCount = 0;
    let errorCount = 0;
    const errorMessages = [];

    for (const studentEmail of emails) {
      try {
        // Find user by email with timeout
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id')
          .eq('email', studentEmail)
          .single();

        if (profileError || !profile) {
          errorMessages.push(`${studentEmail}: Chưa đăng ký tài khoản`);
          errorCount++;
          continue;
        }

        // Add enrollment
        const { error: enrollError } = await supabase
          .from('enrollments')
          .insert({
            class_id: classId,
            student_id: profile.id,
            status: 'active'
          });

        if (enrollError) {
          if (enrollError.code === '23505') {
            errorMessages.push(`${studentEmail}: Đã có trong lớp`);
          } else {
            errorMessages.push(`${studentEmail}: Lỗi thêm`);
          }
          errorCount++;
        } else {
          successCount++;
        }
      } catch (err) {
        console.error('Add student error:', err);
        errorMessages.push(`${studentEmail}: Lỗi kết nối`);
        errorCount++;
      }
    }

    setLoading(false);

    if (successCount > 0) {
      toast.success(`Đã thêm ${successCount} sinh viên vào lớp!`);
      onSuccess?.();
    }
    
    if (errorCount > 0) {
      // Show first 3 error messages
      const displayErrors = errorMessages.slice(0, 3).join('\n');
      const moreErrors = errorMessages.length > 3 ? `\n... và ${errorMessages.length - 3} lỗi khác` : '';
      toast.warning(`Một số sinh viên không thể thêm:\n${displayErrors}${moreErrors}`, { autoClose: 8000 });
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
          Thêm 1 sinh viên
        </button>
        <button
          type="button"
          onClick={() => setMode('bulk')}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
            mode === 'bulk' ? 'bg-white shadow text-primary' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Thêm nhiều
        </button>
      </div>

      {mode === 'single' ? (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Email sinh viên
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="student@example.com"
            className="input"
          />
          <p className="text-xs text-gray-500 mt-1">
            Sinh viên cần đăng ký tài khoản trước khi được thêm vào lớp
          </p>
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Danh sách email (mỗi email một dòng)
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
          Hủy
        </button>
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? (
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          ) : (
            <Plus className="w-5 h-5 mr-2" />
          )}
          Thêm sinh viên
        </button>
      </div>
    </form>
  );
}

// ============================================
// CREATE CLASS FORM
// ============================================

function CreateClassForm({ onClose, onSuccess }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const MAX_RETRIES = 3;
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    description: '',
    semester: '',
    academic_year: new Date().getFullYear().toString(),
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.name.trim() || !formData.code.trim()) {
      toast.error('Vui lòng nhập tên và mã lớp');
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

        const supabasePromise = supabase
          .from('classes')
          .insert({
            ...formData,
            instructor_id: user.id,
            is_active: true
          })
          .select()
          .single();

        const { data, error } = await Promise.race([supabasePromise, timeoutPromise]);

        if (error) throw error;

        toast.success('Tạo lớp học thành công!');
        onSuccess?.(data);
        onClose();
      } catch (error) {
        console.error('Create class error:', error);
        
        // Handle specific error cases with user-friendly messages
        if (error.message === 'REQUEST_TIMEOUT') {
          if (attempt < MAX_RETRIES) {
            setRetryCount(attempt + 1);
            toast.info(`Đang thử lại... (${attempt + 1}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
            return createClass(attempt + 1);
          }
          toast.error('Kết nối chậm. Vui lòng kiểm tra mạng và thử lại.');
        } else if (error.code === '23505') {
          toast.error('Mã lớp này đã tồn tại. Vui lòng chọn mã khác.');
        } else if (error.code === '42501' || error.message?.includes('permission')) {
          toast.error('Bạn không có quyền tạo lớp học. Vui lòng liên hệ quản trị viên.');
        } else if (error.message?.includes('network') || error.message?.includes('fetch')) {
          toast.error('Lỗi kết nối mạng. Vui lòng kiểm tra và thử lại.');
        } else {
          toast.error('Không thể tạo lớp học. Vui lòng thử lại sau.');
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
          Tên lớp học <span className="text-danger">*</span>
        </label>
        <input
          type="text"
          name="name"
          value={formData.name}
          onChange={handleChange}
          placeholder="VD: Trí tuệ nhân tạo K66"
          className="input"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Mã lớp <span className="text-danger">*</span>
        </label>
        <input
          type="text"
          name="code"
          value={formData.code}
          onChange={handleChange}
          placeholder="VD: INT3401-20231"
          className="input"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Mô tả
        </label>
        <textarea
          name="description"
          value={formData.description}
          onChange={handleChange}
          placeholder="Mô tả về lớp học..."
          rows={2}
          className="input resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Học kỳ
          </label>
          <select
            name="semester"
            value={formData.semester}
            onChange={handleChange}
            className="input"
          >
            <option value="">Chọn học kỳ</option>
            <option value="1">Học kỳ 1</option>
            <option value="2">Học kỳ 2</option>
            <option value="3">Học kỳ hè</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Năm học
          </label>
          <input
            type="text"
            name="academic_year"
            value={formData.academic_year}
            onChange={handleChange}
            placeholder="2024"
            className="input"
          />
        </div>
      </div>

      <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-200">
        <button type="button" onClick={onClose} className="btn-secondary">
          Hủy
        </button>
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? (
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          ) : (
            <Save className="w-5 h-5 mr-2" />
          )}
          Tạo lớp học
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
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'exams' | 'students'
  const [showCreateExam, setShowCreateExam] = useState(false);
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [showCreateClass, setShowCreateClass] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

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

        // Load enrollments with student profiles
        const { data: enrollmentsData } = await supabase
          .from('enrollments')
          .select(`
            *,
            student:profiles(*)
          `)
          .eq('class_id', selectedClass.id);
        setStudents(enrollmentsData || []);

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
  }, [selectedClass]);

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
      toast.success('Đã công bố bài thi!');
    } catch (err) {
      toast.error('Có lỗi xảy ra');
    }
  };

  const handleRemoveStudent = async (enrollmentId) => {
    if (!window.confirm('Bạn có chắc muốn xóa sinh viên này khỏi lớp?')) return;

    try {
      const { error } = await supabase
        .from('enrollments')
        .delete()
        .eq('id', enrollmentId);

      if (error) throw error;

      setStudents(prev => prev.filter(s => s.id !== enrollmentId));
      toast.success('Đã xóa sinh viên khỏi lớp');
    } catch (err) {
      toast.error('Có lỗi xảy ra');
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

    if (exam.status === 'draft') return { label: 'Nháp', color: 'bg-gray-100 text-gray-700' };
    if (now < start) return { label: 'Sắp diễn ra', color: 'bg-primary-100 text-primary-700' };
    if (now > end) return { label: 'Đã kết thúc', color: 'bg-gray-100 text-gray-600' };
    return { label: 'Đang diễn ra', color: 'bg-success-100 text-success-700' };
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
            <span className="text-xs text-gray-500 ml-2">Instructor</span>
          </div>
        </div>
        
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 text-sm font-medium text-gray-600 bg-gray-100 px-3 py-1.5 rounded-full">
            <GraduationCap className="w-4 h-4" />
            <span>{profile?.full_name || user?.email}</span>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center space-x-2 text-danger hover:bg-danger-50 px-4 py-2 rounded-lg transition-colors text-sm font-semibold"
          >
            <LogOut className="w-4 h-4" />
            <span>Đăng xuất</span>
          </button>
        </div>
      </nav>

      <div className="flex">
        {/* Sidebar - Class List */}
        <aside className="w-64 bg-paper border-r border-gray-200 min-h-[calc(100vh-65px)] p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-gray-700">Lớp học</h2>
            <button
              onClick={() => setShowCreateClass(true)}
              className="p-1.5 hover:bg-primary-50 rounded-lg transition-colors"
              title="Tạo lớp mới"
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
                <p className="text-sm">Chưa có lớp học nào</p>
                <button
                  onClick={() => setShowCreateClass(true)}
                  className="text-primary text-sm mt-2 hover:underline"
                >
                  Tạo lớp học đầu tiên
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
                <p className="text-gray-500">Mã lớp: {selectedClass.code}</p>
              </div>

              {/* Stats Cards */}
              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="card flex items-center space-x-4">
                  <div className="p-3 bg-primary-100 rounded-xl">
                    <Users className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-text-main">{stats.totalStudents}</p>
                    <p className="text-sm text-gray-500">Sinh viên</p>
                  </div>
                </div>
                
                <div className="card flex items-center space-x-4">
                  <div className="p-3 bg-success-100 rounded-xl">
                    <ClipboardList className="w-6 h-6 text-success" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-text-main">{stats.totalExams}</p>
                    <p className="text-sm text-gray-500">Bài thi</p>
                  </div>
                </div>

                <div className="card flex items-center space-x-4">
                  <div className="p-3 bg-warning-100 rounded-xl">
                    <Activity className="w-6 h-6 text-warning" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-text-main">{stats.activeExams}</p>
                    <p className="text-sm text-gray-500">Đang diễn ra</p>
                  </div>
                </div>

                <div className="card flex items-center space-x-4">
                  <div className="p-3 bg-danger-100 rounded-xl">
                    <AlertTriangle className="w-6 h-6 text-danger" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-text-main">{stats.flaggedSessions}</p>
                    <p className="text-sm text-gray-500">Nghi vấn</p>
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex space-x-1 p-1 bg-gray-100 rounded-xl mb-6 w-fit">
                {[
                  { id: 'exams', label: 'Bài thi', icon: ClipboardList },
                  { id: 'students', label: 'Sinh viên', icon: Users },
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
                    <h2 className="text-lg font-bold text-text-main">Danh sách bài thi</h2>
                    <button
                      onClick={() => setShowCreateExam(true)}
                      className="btn-primary"
                    >
                      <Plus className="w-5 h-5 mr-2" />
                      Tạo bài thi mới
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
                                    <span>{exam.duration_minutes} phút</span>
                                  </span>
                                  <span className="flex items-center space-x-1">
                                    <Calendar className="w-4 h-4" />
                                    <span>{formatDate(exam.start_time)}</span>
                                  </span>
                                </div>
                              </div>
                              
                              <div className="flex items-center space-x-2">
                                {exam.status === 'draft' && (
                                  <button
                                    onClick={() => handlePublishExam(exam.id)}
                                    className="btn-success text-sm"
                                  >
                                    <CheckCircle className="w-4 h-4 mr-1" />
                                    Công bố
                                  </button>
                                )}
                                <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                                  <Eye className="w-5 h-5 text-gray-500" />
                                </button>
                                <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                                  <Edit2 className="w-5 h-5 text-gray-500" />
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
                      <p className="text-gray-500 mb-4">Chưa có bài thi nào</p>
                      <button
                        onClick={() => setShowCreateExam(true)}
                        className="btn-primary"
                      >
                        <Plus className="w-5 h-5 mr-2" />
                        Tạo bài thi đầu tiên
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'students' && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-text-main">Danh sách sinh viên</h2>
                    <button
                      onClick={() => setShowAddStudent(true)}
                      className="btn-primary"
                    >
                      <Plus className="w-5 h-5 mr-2" />
                      Thêm sinh viên
                    </button>
                  </div>

                  {/* Search */}
                  <div className="relative mb-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Tìm kiếm theo tên hoặc email..."
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
                            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">#</th>
                            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Họ tên</th>
                            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Email</th>
                            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">MSSV</th>
                            <th className="text-left px-4 py-3 text-sm font-semibold text-gray-700">Trạng thái</th>
                            <th className="text-right px-4 py-3 text-sm font-semibold text-gray-700">Thao tác</th>
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
                            .map((enrollment, idx) => (
                              <tr key={enrollment.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 text-sm text-gray-500">{idx + 1}</td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center space-x-3">
                                    <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                                      <User className="w-4 h-4 text-primary" />
                                    </div>
                                    <span className="font-medium text-text-main">
                                      {enrollment.student?.full_name || 'N/A'}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-600">
                                  {enrollment.student?.email}
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-600">
                                  {enrollment.student?.student_id || '-'}
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`badge ${
                                    enrollment.status === 'active' 
                                      ? 'badge-success' 
                                      : 'bg-gray-100 text-gray-600'
                                  }`}>
                                    {enrollment.status === 'active' ? 'Đang học' : enrollment.status}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <button
                                    onClick={() => handleRemoveStudent(enrollment.id)}
                                    className="p-2 hover:bg-danger-50 rounded-lg transition-colors text-danger"
                                    title="Xóa khỏi lớp"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-12 bg-gray-50 rounded-xl">
                      <Users className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                      <p className="text-gray-500 mb-4">Chưa có sinh viên nào trong lớp</p>
                      <button
                        onClick={() => setShowAddStudent(true)}
                        className="btn-primary"
                      >
                        <Plus className="w-5 h-5 mr-2" />
                        Thêm sinh viên
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-[60vh]">
              <div className="text-center">
                <BookOpen className="w-20 h-20 mx-auto mb-4 text-gray-300" />
                <h2 className="text-xl font-bold text-gray-700 mb-2">Chào mừng bạn đến với SmartExamPro</h2>
                <p className="text-gray-500 mb-6">Hãy tạo lớp học đầu tiên để bắt đầu</p>
                <button
                  onClick={() => setShowCreateClass(true)}
                  className="btn-primary"
                >
                  <Plus className="w-5 h-5 mr-2" />
                  Tạo lớp học
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
        title="Tạo lớp học mới"
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
        title="Tạo bài thi mới"
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
        isOpen={showAddStudent}
        onClose={() => setShowAddStudent(false)}
        title="Thêm sinh viên vào lớp"
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
    </div>
  );
}