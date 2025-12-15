import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

const AuthContext = createContext();

// Loading component to show while auth is loading
const LoadingScreen = () => (
  <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-100 flex items-center justify-center">
    <div className="text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 mb-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
      <p className="text-gray-600 text-sm">Đang tải...</p>
    </div>
  </div>
);

// Error component to show when Supabase is not configured
const ConfigurationError = () => (
  <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-orange-50 flex items-center justify-center p-4">
    <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-8 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-6">
        <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Lỗi cấu hình</h1>
      <p className="text-gray-600 mb-4">
        Ứng dụng chưa được cấu hình đúng. Vui lòng kiểm tra file <code className="bg-gray-100 px-2 py-1 rounded">.env</code>
      </p>
      <div className="text-left bg-gray-50 rounded-lg p-4 text-sm font-mono text-gray-700">
        <p className="mb-1">VITE_SUPABASE_URL=https://your-project.supabase.co</p>
        <p>VITE_SUPABASE_ANON_KEY=your-anon-key</p>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="mt-6 inline-flex items-center px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors"
      >
        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Tải lại trang
      </button>
    </div>
  </div>
);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  // Fetch user profile from database with retry logic
  const fetchProfile = useCallback(async (userId, retryCount = 0) => {
    const MAX_RETRIES = 3;
    const BASE_RETRY_DELAY = 500; // ms
    
    // Calculate exponential backoff delay
    const getBackoffDelay = (attempt) => BASE_RETRY_DELAY * Math.pow(2, attempt);
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      
      if (error) {
        // PGRST116 means no rows returned - profile may not exist yet
        if (error.code === 'PGRST116') {
          // Profile doesn't exist yet, try to create it from user metadata
          const { data: { user: authUser } } = await supabase.auth.getUser();
          if (authUser) {
            const metadata = authUser.user_metadata || {};
            const role = metadata.role || 'student';
            const fullName = metadata.full_name || authUser.email?.split('@')[0] || 'User';
            
            // Try to create profile
            const { data: newProfile, error: createError } = await supabase
              .from('profiles')
              .upsert({
                id: userId,
                email: authUser.email,
                full_name: fullName,
                role: role,
                student_id: metadata.student_id || null
              }, { onConflict: 'id' })
              .select()
              .single();
            
            if (createError) {
              console.error('Error creating profile:', createError);
              // If creation failed and we haven't retried too many times, wait and retry with exponential backoff
              if (retryCount < MAX_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, getBackoffDelay(retryCount)));
                return fetchProfile(userId, retryCount + 1);
              }
              // Return a fallback profile based on user metadata
              return {
                id: userId,
                email: authUser.email,
                full_name: fullName,
                role: role,
                student_id: metadata.student_id || null
              };
            }
            return newProfile;
          }
        } else {
          console.error('Error fetching profile:', error);
          // Retry on other errors with exponential backoff
          if (retryCount < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, getBackoffDelay(retryCount)));
            return fetchProfile(userId, retryCount + 1);
          }
        }
        return null;
      }
      return data;
    } catch (err) {
      console.error('Profile fetch error:', err);
      if (retryCount < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, getBackoffDelay(retryCount)));
        return fetchProfile(userId, retryCount + 1);
      }
      return null;
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    
    // Add timeout to prevent infinite loading
    const loadingTimeout = setTimeout(() => {
      if (isMounted && loading) {
        console.warn('Auth loading timeout - forcing completion');
        setLoading(false);
        setProfileLoading(false);
      }
    }, 8000); // 8 second timeout (reduced for better UX)

    // Check active session on mount with timeout
    const initAuth = async () => {
      try {
        // Add timeout to getSession call
        const sessionPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Session check timeout')), 5000)
        );
        
        let session = null;
        try {
          const result = await Promise.race([sessionPromise, timeoutPromise]);
          session = result?.data?.session ?? null;
        } catch (timeoutError) {
          console.warn('Session check timed out, continuing without session');
        }
        
        const currentUser = session?.user ?? null;
        
        if (isMounted) {
          setUser(currentUser);
        }
        
        if (currentUser && isMounted) {
          setProfileLoading(true);
          try {
            const userProfile = await fetchProfile(currentUser.id);
            if (isMounted) {
              setProfile(userProfile);
            }
          } catch (profileError) {
            console.error('Error fetching profile:', profileError);
            // Create fallback profile from user metadata
            if (isMounted && currentUser.user_metadata) {
              setProfile({
                id: currentUser.id,
                email: currentUser.email,
                full_name: currentUser.user_metadata.full_name || currentUser.email?.split('@')[0] || 'User',
                role: currentUser.user_metadata.role || 'student',
                student_id: currentUser.user_metadata.student_id || null
              });
            }
          } finally {
            if (isMounted) {
              setProfileLoading(false);
            }
          }
        }
        
        if (isMounted) {
          setLoading(false);
        }
      } catch (error) {
        console.error('Error getting session:', error);
        if (isMounted) {
          setLoading(false);
          setProfileLoading(false);
        }
      }
    };
    
    initAuth();

    // Listen for changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const currentUser = session?.user ?? null;
      
      if (isMounted) {
        setUser(currentUser);
      }
      
      if (currentUser && isMounted) {
        setProfileLoading(true);
        try {
          const userProfile = await fetchProfile(currentUser.id);
          if (isMounted) {
            setProfile(userProfile);
          }
        } catch (profileError) {
          console.error('Error fetching profile on auth change:', profileError);
          // Create fallback profile from user metadata
          if (isMounted && currentUser.user_metadata) {
            setProfile({
              id: currentUser.id,
              email: currentUser.email,
              full_name: currentUser.user_metadata.full_name || currentUser.email?.split('@')[0] || 'User',
              role: currentUser.user_metadata.role || 'student',
              student_id: currentUser.user_metadata.student_id || null
            });
          }
        } finally {
          if (isMounted) {
            setProfileLoading(false);
          }
        }
      } else if (isMounted) {
        setProfile(null);
        setProfileLoading(false);
      }
      
      if (isMounted) {
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      clearTimeout(loadingTimeout);
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const login = async (email, password) => {
    return supabase.auth.signInWithPassword({ email, password });
  };

  const register = async (email, password, fullName, role = 'student', studentId = null) => {
    // Use backend API for registration (auto-confirms email)
    const apiUrl = import.meta.env.VITE_API_URL;
    
    // Only use backend API if configured (production)
    if (apiUrl) {
      try {
        const response = await fetch(`${apiUrl}/api/auth/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email,
            password,
            fullName,
            role,
            studentId
          })
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || 'Đăng ký thất bại');
        }

        return { data: result, error: null };
      } catch (error) {
        // Fallback to direct Supabase signup if backend is unavailable
        console.warn('Backend registration unavailable, using Supabase directly');
      }
    }
    
    // Fallback: Direct Supabase signup (requires email confirmation)
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role: role,
          student_id: studentId
        }
      }
    });

    if (signUpError) throw signUpError;

    // If profile auto-creation didn't work, manually create it
    if (data.user) {
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: data.user.id,
          email: email,
          full_name: fullName,
          role: role,
          student_id: studentId
        }, { onConflict: 'id' });

      if (profileError) {
        console.error('Profile creation error:', profileError);
      }
    }

    return { data, error: signUpError };
  };

  const logout = async () => {
    setProfile(null);
    return supabase.auth.signOut();
  };

  const updateProfile = async (updates) => {
    if (!user) return { error: { message: 'Not authenticated' } };

    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
      .select()
      .single();

    if (!error && data) {
      setProfile(data);
    }

    return { data, error };
  };

  // Check if user has a specific role
  const hasRole = (requiredRole) => {
    if (!profile) return false;
    if (requiredRole === 'admin') return profile.role === 'admin';
    if (requiredRole === 'instructor') return profile.role === 'instructor' || profile.role === 'admin';
    return true; // student or any authenticated user
  };

  const isInstructor = () => hasRole('instructor');
  const isAdmin = () => hasRole('admin');
  const isStudent = () => profile?.role === 'student';

  // Check if Supabase is configured
  if (!isSupabaseConfigured()) {
    return <ConfigurationError />;
  }

  // Show loading screen while auth is loading
  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <AuthContext.Provider value={{ 
      user, 
      profile,
      profileLoading,
      login, 
      register,
      logout, 
      loading,
      updateProfile,
      hasRole,
      isInstructor,
      isAdmin,
      isStudent
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  return useContext(AuthContext);
};
