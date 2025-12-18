// ================================================================
// SHARED CONSTANTS
// Centralized configuration values used across the application
// ================================================================

// Navigation constants - used to prevent infinite redirect loops
export const MAX_NAVIGATION_ATTEMPTS = 10;
export const NAVIGATION_THROTTLE_MS = 500;

// Auth timeout constants - reduced for better UX on slow networks
// These timeouts prevent infinite loading states
export const AUTH_LOADING_TIMEOUT_MS = 2000;  // Reduced from 3000 for faster fallback
export const AUTH_SESSION_TIMEOUT_MS = 2000;  // Reduced from 2500 for faster fallback
export const PROFILE_LOADING_TIMEOUT_MS = 2000; // Reduced from 2500 for faster fallback

// Profile fetch retry settings
export const PROFILE_FETCH_TIMEOUT_MS = 2000; // Timeout per fetch attempt
export const PROFILE_MAX_RETRIES = 1; // Reduced from 2 for faster fallback

// Academic year configuration (for Vietnamese education system)
export const ACADEMIC_YEAR_PAST_YEARS = 5;
export const ACADEMIC_YEAR_FUTURE_YEARS = 2;

// AI Worker configuration
export const AI_DELEGATE_OPTIONS = ['GPU', 'CPU'];

// MediaPipe Face Landmarker configuration
// Pinned versions for stability across components
export const MEDIAPIPE_CONFIG = {
  WASM_PATH: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm",
  MODEL_PATH: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
};
