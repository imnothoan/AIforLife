/**
 * MediaPipe Proctoring - Main Thread Face Analysis
 * 
 * This module runs MediaPipe Face Landmarker on the main thread because
 * MediaPipe doesn't work in ES module workers (importScripts limitation).
 * 
 * Features:
 * - Multi-person detection (2+ faces)
 * - Head pose estimation (yaw/pitch detection for looking away)
 * - Lip movement detection (speech detection)
 * - Eye gaze tracking
 * 
 * Optimized for minimal UI blocking with throttled processing.
 */

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { MEDIAPIPE_CONFIG } from './constants';

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  // Face detection
  MIN_DETECTION_CONFIDENCE: 0.5,
  MIN_TRACKING_CONFIDENCE: 0.5,
  MAX_FACES: 3, // Detect up to 3 faces for multi-person

  // Head pose thresholds (normalized)
  YAW_THRESHOLD: 0.20,      // Looking left/right significantly
  PITCH_THRESHOLD: 0.30,    // Looking up/down - increased to reduce false positives
  SEVERE_YAW_THRESHOLD: 0.4, // ~90 degree turn

  // Eye gaze threshold
  EYE_GAZE_THRESHOLD: 0.15,

  // Lip movement for speech detection
  LIP_MOVEMENT_THRESHOLD: 0.02,
  LIP_HISTORY_FRAMES: 10,
  SPEAKING_FRAME_THRESHOLD: 5,

  // Processing throttle (ms) - keep UI responsive
  PROCESS_INTERVAL_MS: 250, // 4 FPS for face analysis
  ALERT_COOLDOWN_MS: 10000, // 10 seconds between same alert type
};

// ============================================
// STATE
// ============================================
let faceLandmarker = null;
let isInitialized = false;
let isInitializing = false;
let initPromise = null;

// Alert cooldowns
let lastMultiPersonAlert = 0;
let lastLookAwayAlert = 0;
let lastSpeakingAlert = 0;

// Lip movement tracking
const lipMovementHistory = [];
let speakingFrameCount = 0;

// Head pose tracking for consecutive frames
let lookAwayFrameCount = 0;
const CONSECUTIVE_FRAMES_THRESHOLD = 3;

// Processing state
let lastProcessTime = 0;

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize MediaPipe Face Landmarker on main thread
 * Uses singleton pattern to avoid multiple loads
 */
export async function initMediaPipeProctoring() {
  if (isInitialized && faceLandmarker) {
    return true;
  }

  if (isInitializing && initPromise) {
    return initPromise;
  }

  isInitializing = true;

  initPromise = (async () => {
    try {
      console.log('[MediaPipe Proctoring] Initializing on main thread...');

      // Load vision tasks
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_CONFIG.WASM_PATH);

      // Create Face Landmarker
      faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MEDIAPIPE_CONFIG.MODEL_PATH,
          delegate: "GPU" // Try GPU first
        },
        runningMode: "IMAGE",
        numFaces: CONFIG.MAX_FACES,
        minFaceDetectionConfidence: CONFIG.MIN_DETECTION_CONFIDENCE,
        minTrackingConfidence: CONFIG.MIN_TRACKING_CONFIDENCE,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: true
      });

      isInitialized = true;
      console.log('[MediaPipe Proctoring] ✅ Initialized successfully with GPU');
      return true;
    } catch (gpuError) {
      console.warn('[MediaPipe Proctoring] GPU init failed, trying CPU:', gpuError.message);

      try {
        const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_CONFIG.WASM_PATH);

        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MEDIAPIPE_CONFIG.MODEL_PATH,
            delegate: "CPU"
          },
          runningMode: "IMAGE",
          numFaces: CONFIG.MAX_FACES,
          minFaceDetectionConfidence: CONFIG.MIN_DETECTION_CONFIDENCE,
          minTrackingConfidence: CONFIG.MIN_TRACKING_CONFIDENCE,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: true
        });

        isInitialized = true;
        console.log('[MediaPipe Proctoring] ✅ Initialized successfully with CPU');
        return true;
      } catch (cpuError) {
        console.error('[MediaPipe Proctoring] ❌ Failed to initialize:', cpuError);
        isInitialized = false;
        return false;
      }
    } finally {
      isInitializing = false;
    }
  })();

  return initPromise;
}

/**
 * Check if MediaPipe Proctoring is ready
 */
export function isMediaPipeReady() {
  return isInitialized && faceLandmarker !== null;
}

// ============================================
// FACE ANALYSIS FUNCTIONS
// ============================================

/**
 * Estimate head pose from face landmarks
 */
function estimateHeadPose(faceLandmarks) {
  if (!faceLandmarks || faceLandmarks.length < 468) {
    return { yaw: 0, pitch: 0, isLookingAway: false, direction: null };
  }

  // Use key facial landmarks for pose estimation
  const noseTip = faceLandmarks[1];      // Nose tip
  const leftEye = faceLandmarks[33];     // Left eye outer corner
  const rightEye = faceLandmarks[263];   // Right eye outer corner
  const chin = faceLandmarks[152];       // Chin

  // Calculate eye center
  const eyeCenterX = (leftEye.x + rightEye.x) / 2;
  const eyeWidth = Math.abs(rightEye.x - leftEye.x);

  // Yaw estimation (left/right rotation)
  // If nose is significantly offset from eye center
  const yaw = (noseTip.x - eyeCenterX) / eyeWidth;

  // Pitch estimation (up/down)
  const faceHeight = Math.abs(chin.y - eyeCenterX);
  const noseToEyeRatio = (noseTip.y - ((leftEye.y + rightEye.y) / 2)) / faceHeight;
  const pitch = noseToEyeRatio - 0.3; // Normalize around neutral

  let direction = null;
  let isLookingAway = false;

  // Check for severe head turn (like 90 degrees)
  if (Math.abs(yaw) > CONFIG.SEVERE_YAW_THRESHOLD) {
    isLookingAway = true;
    direction = yaw > 0 ? 'right_severe' : 'left_severe';
  } else if (Math.abs(yaw) > CONFIG.YAW_THRESHOLD) {
    isLookingAway = true;
    direction = yaw > 0 ? 'right' : 'left';
  } else if (Math.abs(pitch) > CONFIG.PITCH_THRESHOLD) {
    isLookingAway = true;
    direction = pitch > 0 ? 'down' : 'up';
  }

  return { yaw, pitch, isLookingAway, direction };
}

/**
 * Analyze eye gaze from iris landmarks
 */
function analyzeEyeGaze(faceLandmarks) {
  if (!faceLandmarks || faceLandmarks.length < 478) {
    return { isLookingAway: false, direction: null };
  }

  // Get iris centers (landmarks 468 and 473)
  const leftIrisCenter = faceLandmarks[468];
  const rightIrisCenter = faceLandmarks[473];

  // Get eye corners
  const leftEyeInner = faceLandmarks[133];
  const leftEyeOuter = faceLandmarks[33];
  const rightEyeInner = faceLandmarks[362];
  const rightEyeOuter = faceLandmarks[263];

  // Calculate eye width
  const leftEyeWidth = Math.abs(leftEyeOuter.x - leftEyeInner.x);
  const rightEyeWidth = Math.abs(rightEyeOuter.x - rightEyeInner.x);

  // Calculate iris position relative to eye center
  const leftEyeCenter = (leftEyeInner.x + leftEyeOuter.x) / 2;
  const rightEyeCenter = (rightEyeInner.x + rightEyeOuter.x) / 2;

  const leftGazeOffset = (leftIrisCenter.x - leftEyeCenter) / leftEyeWidth;
  const rightGazeOffset = (rightIrisCenter.x - rightEyeCenter) / rightEyeWidth;
  const avgGazeOffset = (leftGazeOffset + rightGazeOffset) / 2;

  let direction = null;
  let isLookingAway = false;

  if (avgGazeOffset > CONFIG.EYE_GAZE_THRESHOLD) {
    direction = 'right';
    isLookingAway = true;
  } else if (avgGazeOffset < -CONFIG.EYE_GAZE_THRESHOLD) {
    direction = 'left';
    isLookingAway = true;
  }

  return { isLookingAway, direction, gazeOffset: avgGazeOffset };
}

/**
 * Detect lip movement (speech detection)
 */
function analyzeLipMovement(faceLandmarks) {
  if (!faceLandmarks || faceLandmarks.length < 400) {
    return { isSpeaking: false, lipDistance: 0 };
  }

  // Upper lip center (point 13) and lower lip center (point 14)
  const upperLip = faceLandmarks[13];
  const lowerLip = faceLandmarks[14];

  // Calculate vertical distance between lips
  const lipDistance = Math.abs(upperLip.y - lowerLip.y);

  // Track lip movement over time
  lipMovementHistory.push(lipDistance);
  if (lipMovementHistory.length > CONFIG.LIP_HISTORY_FRAMES) {
    lipMovementHistory.shift();
  }

  // Calculate movement variance
  if (lipMovementHistory.length >= 3) {
    const avgDistance = lipMovementHistory.reduce((a, b) => a + b, 0) / lipMovementHistory.length;
    const variance = lipMovementHistory.reduce((acc, val) => acc + Math.pow(val - avgDistance, 2), 0) / lipMovementHistory.length;

    // High variance indicates speaking
    if (variance > CONFIG.LIP_MOVEMENT_THRESHOLD) {
      speakingFrameCount++;
    } else {
      speakingFrameCount = Math.max(0, speakingFrameCount - 1);
    }
  }

  const isSpeaking = speakingFrameCount >= CONFIG.SPEAKING_FRAME_THRESHOLD;

  return { isSpeaking, lipDistance, speakingFrameCount };
}

// ============================================
// MAIN PROCESSING FUNCTION
// ============================================

/**
 * Process a video frame and detect proctoring violations
 * @param {HTMLVideoElement} videoElement - The video element to analyze
 * @returns {Object} Detection results with alerts
 */
export async function analyzeFrame(videoElement) {
  // Throttle processing to maintain UI responsiveness
  const now = Date.now();
  if (now - lastProcessTime < CONFIG.PROCESS_INTERVAL_MS) {
    return null; // Skip this frame
  }
  lastProcessTime = now;

  if (!isInitialized || !faceLandmarker || !videoElement) {
    return null;
  }

  // Check video is ready
  if (videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    !videoElement.videoWidth || videoElement.videoWidth === 0) {
    return null;
  }

  try {
    // Detect faces
    const result = faceLandmarker.detect(videoElement);

    if (!result || !result.faceLandmarks || result.faceLandmarks.length === 0) {
      // No face detected
      return {
        faceCount: 0,
        alerts: [{
          type: 'NO_FACE',
          message: 'Không phát hiện khuôn mặt trong khung hình',
          severity: 'warning'
        }]
      };
    }

    const alerts = [];
    const faceCount = result.faceLandmarks.length;

    // 1. Multi-person detection
    if (faceCount > 1 && now - lastMultiPersonAlert > CONFIG.ALERT_COOLDOWN_MS) {
      alerts.push({
        type: 'MULTI_PERSON',
        message: `Phát hiện ${faceCount} người trong khung hình!`,
        severity: 'critical',
        code: 'multiPerson'
      });
      lastMultiPersonAlert = now;
    }

    // Analyze primary face (first detected)
    const primaryFace = result.faceLandmarks[0];

    // 2. Head pose analysis
    const headPose = estimateHeadPose(primaryFace);
    if (headPose.isLookingAway) {
      lookAwayFrameCount++;

      if (lookAwayFrameCount >= CONSECUTIVE_FRAMES_THRESHOLD &&
        now - lastLookAwayAlert > CONFIG.ALERT_COOLDOWN_MS) {
        const severity = headPose.direction?.includes('severe') ? 'critical' : 'warning';
        const message = headPose.direction?.includes('severe')
          ? 'Bạn đang quay đầu ra xa màn hình!'
          : `Bạn đang nhìn ${headPose.direction === 'left' ? 'sang trái' : headPose.direction === 'right' ? 'sang phải' : headPose.direction === 'up' ? 'lên trên' : 'xuống dưới'}`;

        alerts.push({
          type: 'LOOKING_AWAY',
          message,
          severity,
          code: 'gazeAway',
          direction: headPose.direction
        });
        lastLookAwayAlert = now;
        lookAwayFrameCount = 0;
      }
    } else {
      lookAwayFrameCount = Math.max(0, lookAwayFrameCount - 1);
    }

    // 3. Eye gaze analysis
    const eyeGaze = analyzeEyeGaze(primaryFace);

    // 4. Lip movement / Speech detection
    const lipMovement = analyzeLipMovement(primaryFace);
    if (lipMovement.isSpeaking && now - lastSpeakingAlert > CONFIG.ALERT_COOLDOWN_MS) {
      alerts.push({
        type: 'SPEAKING',
        message: 'Hệ thống phát hiện bạn đang nói chuyện',
        severity: 'warning',
        code: 'speakingDetected'
      });
      lastSpeakingAlert = now;
    }

    return {
      faceCount,
      headPose,
      eyeGaze,
      lipMovement,
      alerts
    };
  } catch (error) {
    console.error('[MediaPipe Proctoring] Analysis error:', error);
    return null;
  }
}

/**
 * Reset alert cooldowns (useful when starting a new exam)
 */
export function resetAlertCooldowns() {
  lastMultiPersonAlert = 0;
  lastLookAwayAlert = 0;
  lastSpeakingAlert = 0;
  lookAwayFrameCount = 0;
  speakingFrameCount = 0;
  lipMovementHistory.length = 0;
}

/**
 * Cleanup resources
 */
export function cleanup() {
  if (faceLandmarker) {
    faceLandmarker.close();
    faceLandmarker = null;
  }
  isInitialized = false;
  resetAlertCooldowns();
}
