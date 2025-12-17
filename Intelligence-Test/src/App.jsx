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
// Uses useNavigate + useEffect to prevent infinite redirect loops
function HomeRoute() {
  const { user, profile, profileLoading, isInstructor, loading } = useAuth();
  const navigate = useNavigate();
  const hasNavigatedRef = useRef(false);
  const lastAuthStateRef = useRef(null);
  
  // Check role from multiple sources (profile, user metadata)
  const userRole = profile?.role || user?.user_metadata?.role || 'student';
  const shouldRedirectToInstructor = isInstructor() || 
    userRole === 'instructor' || 
    userRole === 'admin';
  
  // Create a stable auth state key to detect actual changes
  const authStateKey = `${user?.id || 'none'}-${userRole}-${loading}-${profileLoading}`;
  
  // Handle navigation in useEffect to prevent multiple Navigate component renders
  useEffect(() => {
    // Prevent re-navigation if auth state hasn't actually changed
    if (lastAuthStateRef.current === authStateKey && hasNavigatedRef.current) {
      return;
    }
    
    // Don't navigate while loading
    if (loading) {
      return;
    }
    
    // Redirect to login if not authenticated
    if (!user) {
      // Only navigate if we haven't already navigated to prevent loops
      if (!hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        lastAuthStateRef.current = authStateKey;
        navigate('/login', { replace: true });
      }
      return;
    }
    
    // Wait for profile to be loaded before checking role
    if (profileLoading && !profile) {
      return;
    }
    
    // Only redirect instructors - students stay on this route to show Dashboard
    if (shouldRedirectToInstructor) {
      if (!hasNavigatedRef.current || lastAuthStateRef.current !== authStateKey) {
        hasNavigatedRef.current = true;
        lastAuthStateRef.current = authStateKey;
        
        // Debug logging for auth issues (only in development mode)
        if (import.meta.env.DEV) {
          console.log('[HomeRoute] Navigating instructor to /instructor:', {
            userId: user?.id,
            profileRole: profile?.role,
            metadataRole: user?.user_metadata?.role,
            userRole
          });
        }
        
        navigate('/instructor', { replace: true });
      }
      return;
    }
    
    // For students, update refs but don't navigate (will render Dashboard)
    lastAuthStateRef.current = authStateKey;
    hasNavigatedRef.current = false; // Reset so students can see Dashboard
    
  }, [user, profile, profileLoading, loading, navigate, shouldRedirectToInstructor, authStateKey, userRole]);
  
  // Show loading while auth is being checked
  if (loading) {
    return <LoadingFallback />;
  }
  
  // Not authenticated - will redirect via useEffect
  if (!user) {
    return <LoadingFallback />;
  }
  
  // Wait for profile to be loaded before checking role
  if (profileLoading && !profile) {
    return <LoadingFallback />;
  }
  
  // Instructors will be redirected via useEffect - show loading during transition
  if (shouldRedirectToInstructor) {
    return <LoadingFallback />;
  }
  
  // Debug logging for student dashboard render
  if (import.meta.env.DEV) {
    console.log('[HomeRoute] Rendering Dashboard for student:', {
      userId: user?.id,
      profileRole: profile?.role,
      userRole
    });
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
