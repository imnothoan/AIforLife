import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Check if Supabase is properly configured
export const isSupabaseConfigured = () => {
  return !!(
    supabaseUrl && 
    supabaseAnonKey && 
    supabaseUrl !== 'https://your-project.supabase.co' &&
    supabaseAnonKey !== 'your-anon-key-here' &&
    supabaseUrl.includes('supabase.co')
  );
};

// Create Supabase client only if configured, otherwise create a mock client
let supabaseClient;

if (isSupabaseConfigured()) {
  supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
} else {
  // Create a mock client that won't crash but will indicate configuration error
  console.error('Supabase is not configured. Please check your .env file.');
  console.error('VITE_SUPABASE_URL:', supabaseUrl ? 'Set' : 'Missing');
  console.error('VITE_SUPABASE_ANON_KEY:', supabaseAnonKey ? 'Set' : 'Missing');
  
  // Mock client that returns empty results instead of crashing
  supabaseClient = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
      signUp: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
          order: async () => ({ data: [], error: null }),
        }),
        in: () => ({
          eq: () => ({
            order: async () => ({ data: [], error: null }),
          }),
        }),
        order: async () => ({ data: [], error: null }),
      }),
      insert: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
      update: () => ({
        eq: () => ({
          select: () => ({
            single: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
          }),
        }),
      }),
      upsert: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
      delete: () => ({
        eq: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
      }),
    }),
  };
}

export const supabase = supabaseClient;
