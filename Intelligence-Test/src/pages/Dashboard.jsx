import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import { LogOut, FileText, User, PlayCircle, Clock, CheckCircle, AlertCircle, Loader2, BookOpen, Users, GraduationCap, ChevronRight, Camera, Shield, Settings } from 'lucide-react';
import LanguageSwitcher from '../components/LanguageSwitcher';
import FaceVerification from '../components/FaceVerification';
import ProfileSettings from '../components/ProfileSettings';

export default function Dashboard() {
  const { user, profile, profileLoading, logout, refetchProfile } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [exams, setExams] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [profileTimeoutReached, setProfileTimeoutReached] = useState(false);
  const [showClasses, setShowClasses] = useState(true);
  const [showFaceRegistration, setShowFaceRegistration] = useState(false);
  const [faceRegistered, setFaceRegistered] = useState(false);
  const [showProfileSettings, setShowProfileSettings] = useState(false);

  // Check if face is already registered
  useEffect(() => {
    if (profile?.face_embedding || profile?.face_enrolled_at) {
      setFaceRegistered(true);
    }
  }, [profile]);

  // Profile loading timeout - prevent infinite waiting
  useEffect(() => {
    if (!profileLoading) {
      setProfileTimeoutReached(false);
      return;
    }
    
    const timeout = setTimeout(() => {
      console.warn('Dashboard: Profile loading timeout reached, proceeding with user metadata');
      setProfileTimeoutReached(true);
    }, 2000);
    
    return () => clearTimeout(timeout);
  }, [profileLoading]);

  // Load student's enrolled classes with realtime subscription
  useEffect(() => {
    if (!user) return;
    
    const loadClasses = async () => {
      try {
        if (import.meta.env.DEV) {
          console.log('[Dashboard] Loading enrolled classes for user:', user.id);
        }
        
        // Try RPC first for reliable data loading (bypasses RLS join issues)
        let enrollmentData = [];
        try {
          const { data: rpcResult, error: rpcError } = await supabase.rpc('get_my_enrollments');
          
          if (!rpcError && rpcResult?.success) {
            enrollmentData = rpcResult.enrollments || [];
            if (import.meta.env.DEV) {
              console.log('[Dashboard] Loaded enrollments via RPC:', enrollmentData.length, enrollmentData);
            }
          } else {
            throw new Error(rpcError?.message || rpcResult?.error || 'Failed to load enrollments via RPC function');
          }
        } catch (rpcErr) {
          console.warn('[Dashboard] RPC get_my_enrollments failed, trying direct query:', rpcErr.message);
          // Fallback to direct query
          const { data: directData, error: enrollError } = await supabase
            .from('enrollments')
            .select(`
              id,
              status,
              enrolled_at,
              class:classes(
                id,
                name,
                code,
                description,
                semester,
                academic_year,
                instructor:profiles!classes_instructor_id_fkey(full_name, email)
              )
            `)
            .eq('student_id', user.id)
            .order('enrolled_at', { ascending: false });

          if (enrollError) {
            console.error('[Dashboard] Error loading enrollments:', enrollError);
            throw enrollError;
          }
          
          enrollmentData = directData || [];
          if (import.meta.env.DEV) {
            console.log('[Dashboard] Loaded enrollments via direct query:', enrollmentData.length, enrollmentData);
          }
        }
        
        setClasses(enrollmentData);
      } catch (err) {
        console.error('Load classes error:', err);
      }
    };

    loadClasses();

    // Subscribe to realtime changes for this student's enrollments
    const subscription = supabase
      .channel(`enrollments-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'enrollments',
          filter: `student_id=eq.${user.id}`
        },
        (payload) => {
          console.log('Enrollment change:', payload);
          // Reload classes when enrollment changes
          loadClasses();
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [user]);

  // Load available exams for student
  useEffect(() => {
    const loadExams = async () => {
      // If no user, nothing to load
      if (!user) {
        setLoading(false);
        return;
      }
      
      // Wait for profile to load OR timeout to be reached
      if (profileLoading && !profile && !profileTimeoutReached) {
        return;
      }
      
      // Check role from profile or user metadata (fallback)
      const userRole = profile?.role || user?.user_metadata?.role || 'student';
      const isInstructorUser = userRole === 'instructor' || userRole === 'admin';
      
      // Dashboard is only for students - instructors should be redirected
      if (isInstructorUser) {
        setLoading(false);
        return;
      }

      try {
        // Get enrolled classes
        const { data: enrollments, error: enrollError } = await supabase
          .from('enrollments')
          .select('class_id')
          .eq('student_id', user.id)
          .eq('status', 'active');

        if (enrollError) throw enrollError;

        if (!enrollments || enrollments.length === 0) {
          setExams([]);
          setLoading(false);
          return;
        }

        const classIds = enrollments.map(e => e.class_id);

        // Get published exams from enrolled classes
        const { data: examsData, error: examsError } = await supabase
          .from('exams')
          .select(`
            *,
            class:classes(name, code)
          `)
          .in('class_id', classIds)
          .eq('status', 'published')
          .order('start_time', { ascending: true });

        if (examsError) throw examsError;

        // Get student's exam sessions to check completion
        const { data: sessions } = await supabase
          .from('exam_sessions')
          .select('exam_id, status, percentage')
          .eq('student_id', user.id);

        const sessionsMap = new Map(
          (sessions || []).map(s => [s.exam_id, s])
        );

        // Enrich exams with session data
        const enrichedExams = (examsData || []).map(exam => ({
          ...exam,
          session: sessionsMap.get(exam.id) || null
        }));

        setExams(enrichedExams);
      } catch (err) {
        console.error('Load exams error:', err);
        // User-friendly error messages
        const errorMsg = err.message?.toLowerCase() || '';
        if (errorMsg.includes('network') || errorMsg.includes('fetch')) {
          toast.error(t('error.network'));
        } else if (errorMsg.includes('permission') || errorMsg.includes('unauthorized')) {
          toast.error(t('error.sessionExpired'));
        } else {
          toast.error(t('error.loadExams'));
        }
      } finally {
        setLoading(false);
      }
    };

    loadExams();
  }, [user, profile, profileLoading, profileTimeoutReached, t]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const getExamStatus = (exam) => {
    const now = new Date();
    const start = new Date(exam.start_time);
    const end = new Date(exam.end_time);

    if (exam.session?.status === 'submitted' || exam.session?.status === 'auto_submitted') {
      return {
        type: 'completed',
        label: t('exam.status.completed'),
        color: 'bg-success-100 text-success-700',
        icon: CheckCircle,
        canTake: false
      };
    }

    if (now < start) {
      return {
        type: 'upcoming',
        label: t('exam.status.upcoming'),
        color: 'bg-gray-100 text-gray-600',
        icon: Clock,
        canTake: false
      };
    }

    if (now > end) {
      return {
        type: 'ended',
        label: t('exam.status.ended'),
        color: 'bg-gray-100 text-gray-500',
        icon: AlertCircle,
        canTake: false
      };
    }

    return {
      type: 'active',
      label: t('exam.status.active'),
      color: 'bg-primary-100 text-primary-700',
      icon: PlayCircle,
      canTake: true
    };
  };

  const formatDateTime = (dateStr) => {
    return new Date(dateStr).toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1 }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background font-sans text-text-main">
      {/* Navbar */}
      <nav className="bg-paper shadow-sm border-b border-gray-200 px-8 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center space-x-2">
          <div className="bg-primary p-2 rounded-lg">
            <FileText className="text-white w-6 h-6" />
          </div>
          <span className="text-xl font-bold text-text-main tracking-tight">
            SmartExam<span className="text-primary">Pro</span>
          </span>
        </div>
        <div className="flex items-center space-x-4">
          <LanguageSwitcher compact />
          <button
            onClick={() => setShowProfileSettings(true)}
            className="flex items-center space-x-2 text-sm font-medium text-gray-600 bg-gray-100 px-3 py-1.5 rounded-full hover:bg-gray-200 transition-colors cursor-pointer"
            title={t('profile.settings') || 'Cài đặt tài khoản'}
          >
            <User className="w-4 h-4" />
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

      {/* Content */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="max-w-6xl mx-auto px-8 py-10"
      >
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-text-main">
            {t('dashboard.hello')}, {profile?.full_name?.split(' ').pop() || t('auth.student')}! 👋
          </h1>
          <p className="text-gray-500 mt-2">
            {t('dashboard.selectExam')}
          </p>
        </div>

        {/* Face Registration Section */}
        <motion.div 
          variants={itemVariants}
          className="mb-8"
        >
          <div className="bg-paper rounded-xl border border-gray-100 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className={`p-3 rounded-full ${faceRegistered ? 'bg-success-100' : 'bg-warning-100'}`}>
                  {faceRegistered ? (
                    <Shield className="w-6 h-6 text-success-600" />
                  ) : (
                    <Camera className="w-6 h-6 text-warning-600" />
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-text-main">
                    {t('profile.faceVerification') || 'Xác minh khuôn mặt'}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {faceRegistered 
                      ? (t('profile.faceRegistered') || 'Khuôn mặt đã được đăng ký')
                      : (t('profile.faceNotRegistered') || 'Chưa đăng ký khuôn mặt - cần đăng ký để làm bài thi')}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowFaceRegistration(true)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  faceRegistered 
                    ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' 
                    : 'bg-primary text-white hover:bg-primary-600'
                }`}
              >
                {faceRegistered 
                  ? (t('profile.updateFace') || 'Cập nhật ảnh')
                  : (t('profile.registerFace') || 'Đăng ký ngay')}
              </button>
            </div>
            
            {!faceRegistered && (
              <div className="bg-warning-50 rounded-lg p-3 text-sm text-warning-700 flex items-start space-x-2">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <p>
                  {t('profile.faceRequiredWarning') || 'Bạn cần đăng ký khuôn mặt trước khi tham gia bài thi để hệ thống có thể xác minh danh tính.'}
                </p>
              </div>
            )}
          </div>
        </motion.div>

        {/* Face Registration Modal */}
        <AnimatePresence>
          {showFaceRegistration && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
              onClick={() => setShowFaceRegistration(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-paper rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-6 border-b border-gray-200">
                  <h2 className="text-xl font-bold text-text-main">
                    {t('profile.faceRegistrationTitle') || 'Đăng ký khuôn mặt'}
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {t('profile.faceRegistrationDesc') || 'Chụp ảnh khuôn mặt để sử dụng cho xác minh danh tính khi thi'}
                  </p>
                </div>
                <div className="p-6">
                  <FaceVerification
                    mode="enroll"
                    onEnrollComplete={async (embedding, imageUrl) => {
                      // Save face embedding to database
                      try {
                        const { error } = await supabase.rpc('update_face_embedding', {
                          p_embedding: embedding,
                          p_image_url: imageUrl
                        });
                        
                        if (error) {
                          console.error('Error saving face embedding:', error);
                          toast.error(t('error.general') || 'Có lỗi xảy ra khi lưu');
                          return;
                        }
                        
                        setFaceRegistered(true);
                        setShowFaceRegistration(false);
                        
                        // Refresh profile to sync face verification status
                        await refetchProfile();
                        
                        toast.success(t('profile.faceRegisteredSuccess') || 'Đăng ký khuôn mặt thành công!');
                      } catch (err) {
                        console.error('Face registration error:', err);
                        toast.error(t('error.general') || 'Có lỗi xảy ra');
                      }
                    }}
                    onFailure={() => {
                      toast.error(t('face.failed') || 'Đăng ký thất bại. Vui lòng thử lại.');
                    }}
                  />
                  <button
                    onClick={() => setShowFaceRegistration(false)}
                    className="mt-4 w-full py-2 text-gray-600 hover:text-gray-800 text-sm font-medium"
                  >
                    {t('common.cancel') || 'Hủy'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* My Classes Section */}
        {classes.length > 0 && (
          <motion.div 
            variants={itemVariants}
            className="mb-10"
          >
            <div 
              onClick={() => setShowClasses(!showClasses)}
              className="flex items-center justify-between cursor-pointer mb-4 group"
            >
              <div className="flex items-center space-x-2">
                <GraduationCap className="w-6 h-6 text-primary" />
                <h2 className="text-xl font-bold text-text-main">{t('dashboard.myClasses') || 'Lớp học của tôi'}</h2>
                <span className="bg-primary-100 text-primary-700 text-xs font-bold px-2 py-0.5 rounded-full">
                  {classes.length}
                </span>
              </div>
              <ChevronRight className={`w-5 h-5 text-gray-400 transition-transform ${showClasses ? 'rotate-90' : ''}`} />
            </div>
            
            <AnimatePresence>
              {showClasses && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {classes.map((enrollment) => (
                      <motion.div
                        key={enrollment.id}
                        variants={itemVariants}
                        className="bg-paper rounded-xl border border-gray-100 p-4 hover:shadow-soft transition-all"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center space-x-2">
                            <BookOpen className="w-5 h-5 text-primary" />
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                              enrollment.status === 'active' 
                                ? 'bg-success-100 text-success-700' 
                                : enrollment.status === 'completed'
                                ? 'bg-primary-100 text-primary-700'
                                : 'bg-gray-100 text-gray-600'
                            }`}>
                              {enrollment.status === 'active' 
                                ? (t('student.statusActive') || 'Đang học')
                                : enrollment.status === 'completed'
                                ? (t('class.status.completed') || 'Hoàn thành')
                                : (t('class.status.dropped') || 'Đã rời')}
                            </span>
                          </div>
                        </div>
                        
                        <h3 className="font-bold text-text-main mb-1 line-clamp-2">
                          {enrollment.class?.name || 'N/A'}
                        </h3>
                        
                        <div className="text-xs text-gray-500 space-y-1">
                          <p className="flex items-center space-x-1">
                            <span className="font-medium">{t('class.code') || 'Mã lớp'}:</span>
                            <span>{enrollment.class?.code || 'N/A'}</span>
                          </p>
                          {enrollment.class?.instructor && (
                            <p className="flex items-center space-x-1">
                              <Users className="w-3 h-3" />
                              <span>{enrollment.class.instructor.full_name || enrollment.class.instructor.email}</span>
                            </p>
                          )}
                          {enrollment.class?.semester && (
                            <p>
                              {enrollment.class.semester} - {enrollment.class.academic_year || ''}
                            </p>
                          )}
                        </div>
                        
                        <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400">
                          {t('student.enrolledAt') || 'Tham gia'}: {new Date(enrollment.enrolled_at).toLocaleDateString('vi-VN')}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {exams.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {exams.map((exam) => {
              const status = getExamStatus(exam);
              const StatusIcon = status.icon;

              return (
                <motion.div
                  key={exam.id}
                  variants={itemVariants}
                  className={`card hover:shadow-soft transition-all group ${
                    !status.canTake ? 'opacity-75' : ''
                  }`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${status.color}`}>
                      {status.label}
                    </div>
                    <StatusIcon className={`w-5 h-5 ${
                      status.type === 'active' ? 'text-primary' :
                      status.type === 'completed' ? 'text-success' : 'text-gray-400'
                    }`} />
                  </div>

                  <h3 className={`text-xl font-bold mb-2 ${
                    status.canTake ? 'text-text-main group-hover:text-primary' : 'text-gray-700'
                  } transition-colors`}>
                    {exam.title}
                  </h3>

                  <div className="space-y-1 text-sm text-gray-500 mb-4">
                    <p>{t('exam.course')}: {exam.class?.name || 'N/A'}</p>
                    <p>{t('exam.code')}: {exam.class?.code || 'N/A'}</p>
                    <p className="flex items-center space-x-1">
                      <Clock className="w-4 h-4" />
                      <span>{t('exam.duration')}: {exam.duration_minutes} {t('exam.minutes')}</span>
                    </p>
                  </div>

                  {status.type === 'completed' && exam.session?.percentage !== null && (
                    <div className="mb-4 p-3 bg-success-50 rounded-lg">
                      <p className="text-sm text-gray-600">
                        {t('exam.score')}: <span className="font-bold text-success-700">
                          {exam.session.percentage.toFixed(1)}%
                        </span>
                      </p>
                    </div>
                  )}

                  {status.type === 'upcoming' && (
                    <div className="mb-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-500">
                      <p>{t('exam.startTime')}: {formatDateTime(exam.start_time)}</p>
                    </div>
                  )}

                  {status.canTake ? (
                    <button
                      onClick={() => navigate(`/exam/${exam.id}`)}
                      className="w-full flex items-center justify-center space-x-2 btn-primary py-3"
                    >
                      <PlayCircle className="w-5 h-5" />
                      <span>{t('dashboard.enterExam')}</span>
                    </button>
                  ) : status.type === 'completed' && exam.allow_review ? (
                    <button className="w-full btn-secondary py-3">
                      {t('dashboard.reviewExam')}
                    </button>
                  ) : (
                    <button disabled className="w-full bg-gray-200 text-gray-500 py-3 rounded-xl font-semibold cursor-not-allowed">
                      {status.type === 'upcoming' ? t('dashboard.notStarted') : 
                       status.type === 'ended' ? t('dashboard.expired') : t('dashboard.notAvailable')}
                    </button>
                  )}
                </motion.div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-16 bg-paper rounded-2xl border border-gray-100">
            <FileText className="w-20 h-20 mx-auto mb-4 text-gray-300" />
            <h2 className="text-xl font-bold text-gray-700 mb-2">{t('dashboard.noExams')}</h2>
            <p className="text-gray-500">
              {t('dashboard.noExamsDesc')}
            </p>
          </div>
        )}

        {/* Demo exams for testing */}
        {exams.length === 0 && (
          <div className="mt-8">
            <p className="text-sm text-gray-500 mb-4">{t('dashboard.demoExam')}</p>
            <motion.div 
              variants={itemVariants}
              className="card hover:shadow-soft transition-all group max-w-md"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="bg-primary-100 text-primary-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                  Demo
                </div>
                <PlayCircle className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-xl font-bold text-text-main mb-2 group-hover:text-primary transition-colors">
                Trí tuệ nhân tạo (AI)
              </h3>
              <p className="text-gray-500 text-sm mb-6">{t('exam.code')}: INT3401 • {t('exam.duration')}: 45 {t('exam.minutes')}</p>
              <button
                onClick={() => navigate('/exam/demo')}
                className="w-full flex items-center justify-center space-x-2 btn-primary py-3"
              >
                <PlayCircle className="w-5 h-5" />
                <span>{t('dashboard.enterExam')}</span>
              </button>
            </motion.div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
