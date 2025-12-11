import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Login from './pages/Login';
import Exam from './pages/Exam';
import Dashboard from './pages/Dashboard';
import './index.css';
import axios from 'axios';

// 429 Error Handler
axios.interceptors.response.use(
  response => response,
  error => {
    if (error.response && error.response.status === 429) {
      toast.error("Hệ thống đang bận. Vui lòng thử lại sau vài giây."); // System busy
    }
    return Promise.reject(error);
  }
);

const PrivateRoute = ({ children }) => {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" />;
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
            <Route path="/exam/:id" element={<PrivateRoute><Exam /></PrivateRoute>} />
          </Routes>
          <ToastContainer position="top-right" />
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
