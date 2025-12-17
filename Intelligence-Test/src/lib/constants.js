// ================================================================
// SHARED CONSTANTS
// Centralized configuration values used across the application
// ================================================================

// Navigation constants - used to prevent infinite redirect loops
export const MAX_NAVIGATION_ATTEMPTS = 10;
export const NAVIGATION_THROTTLE_MS = 500;

// MediaPipe Face Landmarker configuration
// Pinned versions for stability across components
export const MEDIAPIPE_CONFIG = {
  WASM_PATH: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm",
  MODEL_PATH: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
};
