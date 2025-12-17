// ================================================================
// SHARED CONSTANTS
// Centralized configuration values used across the application
// ================================================================

// Navigation constants - used to prevent infinite redirect loops
export const MAX_NAVIGATION_ATTEMPTS = 10;
export const NAVIGATION_THROTTLE_MS = 500;

// Auth timeout constants - reduced for better UX on slow networks
export const AUTH_LOADING_TIMEOUT_MS = 3000;
export const AUTH_SESSION_TIMEOUT_MS = 2500;
export const PROFILE_LOADING_TIMEOUT_MS = 2500;

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
