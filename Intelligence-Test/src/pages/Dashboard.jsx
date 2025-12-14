import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { motion } from 'framer-motion';
import { toast } from 'react-toastify';
import { LogOut, FileText, User, PlayCircle, Clock, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import LanguageSwitcher from '../components/LanguageSwitcher';

export default function Dashboard() {
  const { user, profile, logout, isInstructor } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);

  // If instructor, redirect to instructor dashboard
  useEffect(() => {
    // Wait for profile to be loaded before checking role
    if (profile && profile.role) {
      if (profile.role === 'instructor' || profile.role === 'admin') {
        navigate('/instructor');
      }
    }
  }, [profile, navigate]);

  // Load available exams for student
  useEffect(() => {
    const loadExams = async () => {
      if (!user || isInstructor()) return;

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
          toast.error('Lỗi kết nối mạng. Vui lòng kiểm tra internet.');
        } else if (errorMsg.includes('permission') || errorMsg.includes('unauthorized')) {
          toast.error('Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.');
        } else {
          toast.error('Không thể tải danh sách bài thi. Vui lòng thử lại.');
        }
      } finally {
        setLoading(false);
      }
    };

    loadExams();
  }, [user, isInstructor]);

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
        <div className="flex items-center space-x-6">
          <LanguageSwitcher compact />
          <div className="flex items-center space-x-2 text-sm font-medium text-gray-600 bg-gray-100 px-3 py-1.5 rounded-full">
            <User className="w-4 h-4" />
            <span>{profile?.full_name || user?.email}</span>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center space-x-2 text-danger hover:bg-danger-50 px-4 py-2 rounded-lg transition-colors text-sm font-semibold"
          >
            <LogOut className="w-4 h-4" />
            <span>{t('auth.logout')}</span>
          </button>
        </div>
      </nav>

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
