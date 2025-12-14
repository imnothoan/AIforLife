import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import ErrorBoundary from './components/ErrorBoundary';
import Login from './pages/Login';
import Exam from './pages/Exam';
import Dashboard from './pages/Dashboard';
import InstructorDashboard from './pages/InstructorDashboard';
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

function PrivateRoute({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" />;
}

function InstructorRoute({ children }) {
  const { user, isInstructor } = useAuth();
  if (!user) return <Navigate to="/login" />;
  if (!isInstructor()) return <Navigate to="/" />;
  return children;
}

function App() {
  return (
    <ErrorBoundary>
      <LanguageProvider>
        <AuthProvider>
          <BrowserRouter>
            <div className="min-h-screen bg-background text-text-main font-sans">
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
                <Route path="/instructor" element={<InstructorRoute><InstructorDashboard /></InstructorRoute>} />
                <Route path="/exam/:id" element={<PrivateRoute><Exam /></PrivateRoute>} />
              </Routes>
              <ToastContainer 
                position="top-right" 
                autoClose={4000}
                hideProgressBar={false}
                newestOnTop
                closeOnClick
                rtl={false}
                pauseOnFocusLoss
                draggable
                pauseOnHover
                theme="light"
              />
            </div>
          </BrowserRouter>
        </AuthProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}

export default App;
