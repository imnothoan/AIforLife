import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';
import axios from 'axios';
import { Suspense, lazy, useEffect, useRef, useMemo } from 'react';
import { t } from './lib/i18n';
import { MAX_NAVIGATION_ATTEMPTS, NAVIGATION_THROTTLE_MS } from './lib/constants';

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
// Uses useNavigate + useEffect with stable refs to prevent infinite redirect loops
function HomeRoute() {
  const { user, profile, profileLoading, loading } = useAuth();
  const navigate = useNavigate();
  const navigationStateRef = useRef({
    hasNavigated: false,
    lastNavigationTarget: null,
    lastUserRoleKey: null,
    navigationCount: 0,
    lastNavigationTime: 0
  });
  
  // Get the computed role directly from profile or user metadata
  // Using useMemo to ensure stable value
  const computedRole = useMemo(() => {
    return profile?.role || user?.user_metadata?.role || 'student';
  }, [profile?.role, user?.user_metadata?.role]);
  
  // Determine if user should be redirected to instructor page
  // Based on computed role only, not on unstable function references
  const isInstructorOrAdmin = useMemo(() => {
    return computedRole === 'instructor' || computedRole === 'admin';
  }, [computedRole]);
  
  // Handle navigation in useEffect with throttling to prevent loops
  useEffect(() => {
    const state = navigationStateRef.current;
    const now = Date.now();
    
    // Don't navigate while loading
    if (loading) {
      return;
    }
    
    // Redirect to login if not authenticated
    if (!user) {
      // Throttle navigation - max once per NAVIGATION_THROTTLE_MS to same target
      if (state.lastNavigationTarget === '/login' && (now - state.lastNavigationTime) < NAVIGATION_THROTTLE_MS) {
        return;
      }
      
      // Limit total navigations to prevent loops
      if (state.navigationCount >= MAX_NAVIGATION_ATTEMPTS) {
        console.warn('[HomeRoute] Too many navigation attempts, stopping');
        return;
      }
      
      state.navigationCount++;
      state.lastNavigationTarget = '/login';
      state.lastNavigationTime = now;
      
      if (import.meta.env.DEV) {
        console.log('[HomeRoute] Redirecting to login - user not authenticated');
      }
      
      navigate('/login', { replace: true });
      return;
    }
    
    // Wait for profile to be loaded before checking role
    if (profileLoading && !profile) {
      return;
    }
    
    // Check if we already navigated for this user/role combination
    const userRoleKey = `${user.id}:${computedRole}`;
    if (state.hasNavigated && state.lastUserRoleKey === userRoleKey) {
      return;
    }
    
    // Only redirect instructors/admins
    if (isInstructorOrAdmin) {
      // Throttle navigation
      if (state.lastNavigationTarget === '/instructor' && (now - state.lastNavigationTime) < NAVIGATION_THROTTLE_MS) {
        return;
      }
      
      // Limit total navigations
      if (state.navigationCount >= MAX_NAVIGATION_ATTEMPTS) {
        console.warn('[HomeRoute] Too many navigation attempts, stopping');
        return;
      }
      
      state.hasNavigated = true;
      state.lastUserRoleKey = userRoleKey;
      state.navigationCount++;
      state.lastNavigationTarget = '/instructor';
      state.lastNavigationTime = now;
      
      if (import.meta.env.DEV) {
        console.log('[HomeRoute] Navigating instructor to /instructor:', {
          userId: user?.id,
          profileRole: profile?.role,
          metadataRole: user?.user_metadata?.role,
          computedRole
        });
      }
      
      navigate('/instructor', { replace: true });
      return;
    }
    
    // For students, mark as navigated to prevent further navigation attempts
    state.hasNavigated = true;
    state.lastUserRoleKey = userRoleKey;
    
  }, [user, profile, profileLoading, loading, navigate, isInstructorOrAdmin, computedRole]);
  
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
  if (isInstructorOrAdmin) {
    return <LoadingFallback />;
  }
  
  // Debug logging for student dashboard render
  if (import.meta.env.DEV) {
    console.log('[HomeRoute] Rendering Dashboard for student:', {
      userId: user?.id,
      profileRole: profile?.role,
      computedRole
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
