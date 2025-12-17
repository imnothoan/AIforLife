import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';
import axios from 'axios';
import { Suspense, lazy, useEffect, useRef } from 'react';
import { t } from './lib/i18n';

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
// Uses stable navigation guard to prevent infinite redirect loops
function HomeRoute() {
  const { user, profile, profileLoading, loading } = useAuth();
  const navigate = useNavigate();
  const hasNavigatedRef = useRef(false);
  const lastUserIdRef = useRef(null);
  
  // Reset navigation flag when user changes (logout/login)
  // This useEffect runs synchronously with the same dependencies as navigation effect
  useEffect(() => {
    const currentUserId = user?.id;
    
    // Reset flag if user logged out or different user logged in
    if (currentUserId !== lastUserIdRef.current) {
      hasNavigatedRef.current = false;
      lastUserIdRef.current = currentUserId;
    }
  }, [user?.id]);
  
  useEffect(() => {
    // Skip if already navigated for this mount
    if (hasNavigatedRef.current) {
      return;
    }
    
    // Don't navigate while auth is loading
    if (loading) {
      return;
    }
    
    // Redirect to login if not authenticated
    if (!user) {
      if (import.meta.env.DEV) {
        console.log('[HomeRoute] Redirecting to login - user not authenticated');
      }
      hasNavigatedRef.current = true;
      navigate('/login', { replace: true });
      return;
    }
    
    // Wait for profile to be loaded before making navigation decisions
    // This is CRITICAL - we must have profile data before redirecting
    if (profileLoading) {
      if (import.meta.env.DEV) {
        console.log('[HomeRoute] Waiting for profile to load...');
      }
      return;
    }
    
    // Profile should be loaded by now
    // Get role from profile first, fall back to user metadata
    const userRole = profile?.role || user?.user_metadata?.role || 'student';
    
    // Only redirect instructors/admins to instructor dashboard
    if (userRole === 'instructor' || userRole === 'admin') {
      if (import.meta.env.DEV) {
        console.log('[HomeRoute] Navigating instructor/admin to /instructor:', {
          userId: user.id,
          role: userRole,
          profileRole: profile?.role
        });
      }
      hasNavigatedRef.current = true;
      navigate('/instructor', { replace: true });
      return;
    }
    
    // For students, mark as ready (no navigation needed, will render Dashboard)
    if (import.meta.env.DEV) {
      console.log('[HomeRoute] User is student, rendering Dashboard:', {
        userId: user.id,
        role: userRole
      });
    }
    hasNavigatedRef.current = true;
    
  }, [user, profile, profileLoading, loading, navigate]);
  
  // Show loading while auth is being checked
  if (loading) {
    return <LoadingFallback />;
  }
  
  // Not authenticated - will redirect via useEffect
  if (!user) {
    return <LoadingFallback />;
  }
  
  // Wait for profile to be loaded before checking role
  if (profileLoading) {
    return <LoadingFallback />;
  }
  
  // Get role for rendering decision
  const userRole = profile?.role || user?.user_metadata?.role || 'student';
  
  // Instructors will be redirected via useEffect - show loading during transition
  if (userRole === 'instructor' || userRole === 'admin') {
    return <LoadingFallback />;
  }
  
  // Students see the Dashboard
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
