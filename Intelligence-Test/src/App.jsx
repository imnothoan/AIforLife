import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';
import axios from 'axios';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { t } from './lib/i18n';
import { PROFILE_LOADING_TIMEOUT_MS } from './lib/constants';

// Lazy load pages for better performance and smaller initial bundle
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const InstructorDashboard = lazy(() => import('./pages/InstructorDashboard'));
const Exam = lazy(() => import('./pages/Exam'));

// Loading fallback component
const LoadingFallback = () => (
  <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-100 flex items-center justify-center">
    <div className="text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 mb-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
      <p className="text-gray-600 text-sm">Loading...</p>
    </div>
  </div>
);

// 429 Error Handler
axios.interceptors.response.use(
  response => response,
  error => {
    if (error.response && error.response.status === 429) {
      toast.error(t('error.systemBusy'));
    }
    return Promise.reject(error);
  }
);

function PrivateRoute({ children }) {
  const { user, profile, profileLoading, loading } = useAuth();
  
  // Show loading while auth is being checked
  if (loading) {
    return <LoadingFallback />;
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  // Wait for profile to be loaded (profileLoading is true while fetching)
  if (profileLoading && !profile) {
    return <LoadingFallback />;
  }
  
  return children;
}

function InstructorRoute({ children }) {
  const { user, profile, profileLoading, isInstructor, loading } = useAuth();
  
  // Show loading while auth is being checked
  if (loading) {
    return <LoadingFallback />;
  }
  
  if (!user) return <Navigate to="/login" replace />;
  
  // Wait for profile to be loaded before checking role
  if (profileLoading && !profile) {
    return <LoadingFallback />;
  }
  
  // Now check if instructor (profile should be loaded by now)
  if (!isInstructor()) return <Navigate to="/" replace />;
  return children;
}

// Smart Home route - redirects based on user role
// SIMPLIFIED: Direct navigation without complex useEffect dependencies
function HomeRoute() {
  const { user, profile, profileLoading, loading } = useAuth();
  const navigate = useNavigate();
  const navigationStateRef = useRef({ navigated: false, userId: null });
  const profileTimeoutRef = useRef(null);
  const [forceRender, setForceRender] = useState(false);
  
  // Get role early and consistently - check both profile and user metadata
  const userRole = profile?.role || user?.user_metadata?.role || 'student';
  const isInstructorOrAdmin = userRole === 'instructor' || userRole === 'admin';
  
  // Add a timeout for profile loading to prevent infinite wait
  useEffect(() => {
    if (profileLoading && !forceRender) {
      profileTimeoutRef.current = setTimeout(() => {
        console.warn('Profile loading timeout in HomeRoute - using metadata role');
        setForceRender(true);
      }, PROFILE_LOADING_TIMEOUT_MS);
    }
    
    return () => {
      if (profileTimeoutRef.current) {
        clearTimeout(profileTimeoutRef.current);
      }
    };
  }, [profileLoading, forceRender]);
  
  // Single useEffect with minimal dependencies to prevent loops
  useEffect(() => {
    // Reset if user changed
    if (user?.id !== navigationStateRef.current.userId) {
      navigationStateRef.current = { navigated: false, userId: user?.id || null };
    }
    
    // Skip if already navigated or still loading
    if (navigationStateRef.current.navigated || loading) {
      return;
    }
    
    // Redirect to login if not authenticated
    if (!user) {
      navigationStateRef.current.navigated = true;
      navigate('/login', { replace: true });
      return;
    }
    
    // Wait for profile to load before making navigation decisions
    // But respect the forceRender timeout
    if (profileLoading && !forceRender) {
      return;
    }
    
    // Navigate instructors/admins
    if (isInstructorOrAdmin) {
      navigationStateRef.current.navigated = true;
      navigate('/instructor', { replace: true });
    } else {
      // Mark as navigated for students (they stay here)
      navigationStateRef.current.navigated = true;
    }
  }, [user, loading, profileLoading, isInstructorOrAdmin, navigate, forceRender]);
  
  // Render decisions - kept simple
  if (loading) {
    return <LoadingFallback />;
  }
  
  if (!user) {
    return <LoadingFallback />;
  }
  
  // Allow render if forceRender is true (timeout occurred)
  if (profileLoading && !forceRender) {
    return <LoadingFallback />;
  }
  
  if (isInstructorOrAdmin) {
    return <LoadingFallback />;
  }
  
  return <Dashboard />;
}

function App() {
  return (
    <ErrorBoundary>
      <LanguageProvider>
        <AuthProvider>
          <BrowserRouter>
            <Suspense fallback={<LoadingFallback />}>
              <div className="min-h-screen bg-background text-text-main font-sans">
                <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route path="/" element={<HomeRoute />} />
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
            </Suspense>
          </BrowserRouter>
        </AuthProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}

export default App;
