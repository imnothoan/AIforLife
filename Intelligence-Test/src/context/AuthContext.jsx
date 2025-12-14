import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch user profile from database
  const fetchProfile = useCallback(async (userId) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      
      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching profile:', error);
      }
      return data;
    } catch (err) {
      console.error('Profile fetch error:', err);
      return null;
    }
  }, []);

  useEffect(() => {
    // Check active session on mount
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      
      if (currentUser) {
        const userProfile = await fetchProfile(currentUser.id);
        setProfile(userProfile);
      }
      
      setLoading(false);
    });

    // Listen for changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      
      if (currentUser) {
        const userProfile = await fetchProfile(currentUser.id);
        setProfile(userProfile);
      } else {
        setProfile(null);
      }
      
      setLoading(false);
    });

    return () => subscription.unsubscribe();
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

  return (
    <AuthContext.Provider value={{ 
      user, 
      profile,
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
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  return useContext(AuthContext);
};
