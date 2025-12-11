import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LogOut, FileText, User, PlayCircle, Clock } from 'lucide-react';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
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

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
      {/* Navbar */}
      <nav className="bg-white shadow-sm border-b border-gray-200 px-8 py-4 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center space-x-2">
            <div className="bg-blue-600 p-2 rounded-lg">
                <FileText className="text-white w-6 h-6" />
            </div>
            <span className="text-xl font-bold text-gray-800 tracking-tight">SmartExam<span className="text-blue-600">Pro</span></span>
        </div>
        <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-2 text-sm font-medium text-gray-600 bg-gray-100 px-3 py-1.5 rounded-full">
                <User className="w-4 h-4" />
                <span>{user?.email}</span>
            </div>
            <button
                onClick={handleLogout}
                className="flex items-center space-x-2 text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg transition-colors text-sm font-semibold"
            >
                <LogOut className="w-4 h-4" />
                <span>Đăng xuất</span>
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
            <h1 className="text-3xl font-bold text-gray-900">Xin chào, thí sinh! 👋</h1>
            <p className="text-gray-500 mt-2">Chọn bài thi bên dưới để bắt đầu. Hãy đảm bảo đường truyền mạng ổn định.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Exam Card 1 */}
            <motion.div variants={itemVariants} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-all group">
                <div className="flex justify-between items-start mb-4">
                    <div className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">Đang diễn ra</div>
                    <Clock className="w-5 h-5 text-gray-400" />
                </div>
                <h3 className="text-xl font-bold text-gray-800 mb-2 group-hover:text-blue-600 transition-colors">Trí tuệ nhân tạo (AI)</h3>
                <p className="text-gray-500 text-sm mb-6">Mã môn: INT3401 • Thời gian: 45 phút</p>
                <button
                    onClick={() => navigate('/exam/1')}
                    className="w-full flex items-center justify-center space-x-2 bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 active:scale-95 transition-all shadow-blue-200 shadow-lg"
                >
                    <PlayCircle className="w-5 h-5" />
                    <span>Vào phòng thi</span>
                </button>
            </motion.div>

            {/* Exam Card 2 (Disabled) */}
            <motion.div variants={itemVariants} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 opacity-60 cursor-not-allowed relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-gray-200 text-gray-600 px-3 py-1 rounded-bl-xl text-xs font-bold">Chưa mở</div>
                <div className="flex justify-between items-start mb-4">
                    <div className="bg-gray-100 text-gray-500 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">Sắp tới</div>
                    <Clock className="w-5 h-5 text-gray-400" />
                </div>
                <h3 className="text-xl font-bold text-gray-800 mb-2">Cấu trúc dữ liệu & GT</h3>
                <p className="text-gray-500 text-sm mb-6">Mã môn: INT2204 • Thời gian: 60 phút</p>
                <button disabled className="w-full bg-gray-200 text-gray-500 py-3 rounded-xl font-semibold cursor-not-allowed">
                    Chưa đến giờ
                </button>
            </motion.div>
             {/* Exam Card 3 (Completed) */}
             <motion.div variants={itemVariants} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <div className="flex justify-between items-start mb-4">
                    <div className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">Đã hoàn thành</div>
                    <FileText className="w-5 h-5 text-green-500" />
                </div>
                <h3 className="text-xl font-bold text-gray-800 mb-2">Lập trình mạng</h3>
                <p className="text-gray-500 text-sm mb-6">Điểm số: <span className="font-bold text-gray-900">9.5/10</span></p>
                <button className="w-full bg-white border border-gray-200 text-gray-700 py-3 rounded-xl font-semibold hover:bg-gray-50 transition-colors">
                    Xem lại bài
                </button>
            </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
