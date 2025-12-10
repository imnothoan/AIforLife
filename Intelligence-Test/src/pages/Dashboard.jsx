import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-gray-800">Trang chủ</h1>
        <button onClick={handleLogout} className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded">
          Đăng xuất
        </button>
      </div>
      <div className="bg-white p-6 rounded-lg shadow-md">
        <p className="mb-4">Xin chào, {user?.email}</p>
        <button onClick={() => navigate('/exam/1')} className="bg-blue-600 hover:bg-blue-800 text-white font-bold py-2 px-4 rounded">
          Bắt đầu bài thi mẫu
        </button>
      </div>
    </div>
  );
}
