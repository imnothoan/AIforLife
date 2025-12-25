/**
 * Face Verification Utilities
 * 
 * Provides silent face verification from video stream without interrupting the user.
 * Uses face-api.js with FaceNet (128D embeddings) for accurate face recognition.
 * 
 * Optimized for SmartExamPro - "Nền tảng khảo thí thông minh"
 * - TinyFaceDetector for real-time detection (faster)
 * - SSD MobileNet for capture (more accurate)
 * - Multi-frame verification for reliability (3 frames with majority voting)
 * - Singleton pattern to prevent multiple model loads
 */

import * as faceapi from 'face-api.js';

// Configuration - Optimized for performance and accuracy
const CONFIG = {
  // Model URL (using vladmandic's face-api fork with better models)
  MODEL_URL: 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model',
  // Face detection confidence
  MIN_DETECTION_CONFIDENCE: 0.5,
  // Face recognition - Euclidean distance threshold
  // FaceNet uses Euclidean distance. Lower = stricter matching.
  // 0.5 is balanced - handles minor expression changes (smile, slight head tilt)
  // Increase to 0.55 for more lenient matching (recommended for real-world use)
  EUCLIDEAN_THRESHOLD: 0.55,
  // Timeout for model loading (ms)
  MODEL_LOAD_TIMEOUT: 30000,
  // Use TinyFaceDetector for faster detection in silent verification
  USE_TINY_DETECTOR: true,
  TINY_INPUT_SIZE: 320, // Smaller = faster but less accurate
  // Multi-frame verification settings
  MULTI_FRAME: {
    FRAME_COUNT: 3,           // Number of frames to capture
    FRAME_DELAY_MS: 200,      // Delay between frames (ms)
    MIN_MATCH_COUNT: 2,       // Minimum matches required (majority voting)
    AGGREGATE_METHOD: 'median', // 'median' or 'mean' for distance aggregation
  },
  // Head pose tolerance (radians) - allow small head movements
  HEAD_POSE_TOLERANCE: {
    YAW: 0.4,    // Left/right rotation (about 23 degrees)
    PITCH: 0.35, // Up/down rotation (about 20 degrees)
    ROLL: 0.3,   // Tilt rotation (about 17 degrees)
  },
};

// Model loading state (singleton)
let modelsLoaded = false;
let modelLoadingPromise = null;

/**
 * Load face-api.js models (singleton pattern)
 * Loads TinyFaceDetector for fast detection + SSD for accurate capture
 * @returns {Promise<boolean>} True if models loaded successfully
 */
export async function loadFaceModels() {
  if (modelsLoaded) return true;
  
  if (modelLoadingPromise) {
    return modelLoadingPromise;
  }
  
  modelLoadingPromise = (async () => {
    try {
      console.log('[FaceUtils] Loading face-api.js models (optimized)...');
      
      // Load all required models in parallel for faster startup
      await Promise.all([
        // TinyFaceDetector - fast detection for real-time
        faceapi.nets.tinyFaceDetector.loadFromUri(CONFIG.MODEL_URL),
        // SSD MobileNet - accurate detection for capture
        faceapi.nets.ssdMobilenetv1.loadFromUri(CONFIG.MODEL_URL),
        // Face landmarks - required for descriptor extraction
        faceapi.nets.faceLandmark68Net.loadFromUri(CONFIG.MODEL_URL),
        // Face recognition - FaceNet 128D embeddings
        faceapi.nets.faceRecognitionNet.loadFromUri(CONFIG.MODEL_URL),
      ]);
      
      modelsLoaded = true;
      console.log('[FaceUtils] ✅ All models loaded successfully');
      return true;
    } catch (error) {
      console.error('[FaceUtils] ❌ Failed to load models:', error);
      modelLoadingPromise = null;
      return false;
    }
  })();
  
  return modelLoadingPromise;
}

/**
 * Check if models are loaded
 * @returns {boolean}
 */
export function areModelsLoaded() {
  return modelsLoaded;
}

/**
 * Calculate Euclidean distance between two face descriptors
 * @param {Float32Array|number[]} a - First descriptor (128D)
 * @param {Float32Array|number[]} b - Second descriptor (128D)
 * @returns {number} Euclidean distance (lower = more similar)
 */
function euclideanDistance(a, b) {
  if (!a || !b) return Infinity;
  
  const arrA = Array.isArray(a) ? a : (a instanceof Float32Array ? Array.from(a) : null);
  const arrB = Array.isArray(b) ? b : (b instanceof Float32Array ? Array.from(b) : null);
  
  if (!arrA || !arrB || arrA.length !== arrB.length) return Infinity;
  
  let sum = 0;
  for (let i = 0; i < arrA.length; i++) {
    const diff = arrA[i] - arrB[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Convert Float32Array to regular array for comparison
 */
function toArray(descriptor) {
  if (!descriptor) return null;
  if (Array.isArray(descriptor)) return descriptor;
  if (descriptor instanceof Float32Array) return Array.from(descriptor);
  return null;
}

/**
 * Extract face descriptor from a video element (silent - no user interaction)
 * Uses TinyFaceDetector for fast multi-face check, SSD for accurate extraction
 * 
 * @param {HTMLVideoElement} videoElement - The video element to capture from
 * @returns {Promise<{success: boolean, descriptor?: number[], error?: string, faceCount?: number}>}
 */
export async function extractDescriptorFromVideo(videoElement) {
  if (!videoElement) {
    return { success: false, error: 'No video element provided' };
  }
  
  // Ensure models are loaded
  if (!modelsLoaded) {
    const loaded = await loadFaceModels();
    if (!loaded) {
      return { success: false, error: 'Failed to load face models' };
    }
  }
  
  // Check video is ready
  if (videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || 
      !videoElement.videoWidth || videoElement.videoWidth === 0) {
    return { success: false, error: 'Video not ready' };
  }
  
  try {
    // Use TinyFaceDetector for fast multi-face check first
    const detectorOptions = CONFIG.USE_TINY_DETECTOR
      ? new faceapi.TinyFaceDetectorOptions({ 
          inputSize: CONFIG.TINY_INPUT_SIZE, 
          scoreThreshold: CONFIG.MIN_DETECTION_CONFIDENCE 
        })
      : new faceapi.SsdMobilenetv1Options({ minConfidence: CONFIG.MIN_DETECTION_CONFIDENCE });
    
    const allFaces = await faceapi.detectAllFaces(videoElement, detectorOptions);
    
    if (allFaces.length === 0) {
      return { success: false, error: 'NO_FACE', faceCount: 0 };
    }
    
    if (allFaces.length > 1) {
      return { success: false, error: 'MULTI_PERSON', faceCount: allFaces.length };
    }
    
    // For descriptor extraction, use SSD MobileNet for better accuracy
    const detection = await faceapi
      .detectSingleFace(videoElement, new faceapi.SsdMobilenetv1Options({ minConfidence: CONFIG.MIN_DETECTION_CONFIDENCE }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    
    if (!detection || !detection.descriptor) {
      return { success: false, error: 'Failed to extract face descriptor', faceCount: 1 };
    }
    
    return {
      success: true,
      descriptor: toArray(detection.descriptor),
      faceCount: 1
    };
  } catch (error) {
    console.error('[FaceUtils] Extraction error:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Verify face from video against stored embedding (silent verification)
 * 
 * This function captures MULTIPLE frames from the video, extracts the face descriptor,
 * and compares each with the stored embedding using majority voting for reliability.
 * This prevents false negatives from motion blur, lighting changes, or momentary expressions.
 * 
 * @param {HTMLVideoElement} videoElement - The video element to capture from
 * @param {number[]} storedEmbedding - The stored face embedding to compare against
 * @param {boolean} singleFrame - If true, use single frame (faster but less reliable)
 * @returns {Promise<{
 *   success: boolean,
 *   isMatch?: boolean,
 *   distance?: number,
 *   similarity?: number,
 *   error?: string,
 *   faceCount?: number,
 *   frameResults?: Array<{distance: number, isMatch: boolean}>
 * }>}
 */
export async function silentVerifyFace(videoElement, storedEmbedding, singleFrame = false) {
  if (!storedEmbedding || !Array.isArray(storedEmbedding) || storedEmbedding.length !== 128) {
    return { success: false, error: 'Invalid stored embedding' };
  }
  
  // For single frame mode (backward compatibility or when speed is critical)
  if (singleFrame) {
    return silentVerifyFaceSingleFrame(videoElement, storedEmbedding);
  }
  
  // Multi-frame verification for better reliability
  const { FRAME_COUNT, FRAME_DELAY_MS, MIN_MATCH_COUNT, AGGREGATE_METHOD } = CONFIG.MULTI_FRAME;
  const frameResults = [];
  let lastError = null;
  let faceCount = 0;
  
  for (let i = 0; i < FRAME_COUNT; i++) {
    // Extract descriptor from current video frame
    const extraction = await extractDescriptorFromVideo(videoElement);
    
    if (!extraction.success) {
      lastError = extraction.error;
      faceCount = extraction.faceCount || 0;
      // Continue to next frame even if this one fails
      if (i < FRAME_COUNT - 1) {
        await new Promise(resolve => setTimeout(resolve, FRAME_DELAY_MS));
        continue;
      }
    } else {
      // Calculate Euclidean distance
      const distance = euclideanDistance(extraction.descriptor, storedEmbedding);
      const isMatch = distance <= CONFIG.EUCLIDEAN_THRESHOLD;
      frameResults.push({ distance, isMatch });
      faceCount = extraction.faceCount || 1;
    }
    
    // Wait before next frame (except for last frame)
    if (i < FRAME_COUNT - 1) {
      await new Promise(resolve => setTimeout(resolve, FRAME_DELAY_MS));
    }
  }
  
  // If no frames were successfully processed
  if (frameResults.length === 0) {
    return {
      success: false,
      error: lastError || 'All frames failed',
      faceCount
    };
  }
  
  // Majority voting - count matches
  const matchCount = frameResults.filter(r => r.isMatch).length;
  const isMatch = matchCount >= MIN_MATCH_COUNT;
  
  // Calculate aggregated distance (median or mean)
  const distances = frameResults.map(r => r.distance).sort((a, b) => a - b);
  let aggregatedDistance;
  if (AGGREGATE_METHOD === 'median') {
    const mid = Math.floor(distances.length / 2);
    aggregatedDistance = distances.length % 2 === 0 
      ? (distances[mid - 1] + distances[mid]) / 2 
      : distances[mid];
  } else {
    aggregatedDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
  }
  
  // Convert distance to similarity score (0-1) for logging
  const similarity = Math.exp(-aggregatedDistance);
  
  // Only log detailed results in development - biometric data is sensitive
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    console.log('[FaceUtils] Multi-frame verification result:', {
      framesProcessed: frameResults.length,
      matchCount,
      minRequired: MIN_MATCH_COUNT,
      aggregatedDistance: aggregatedDistance.toFixed(4),
      threshold: CONFIG.EUCLIDEAN_THRESHOLD,
      isMatch,
      frameDistances: frameResults.map(r => r.distance.toFixed(4))
    });
  }
  
  return {
    success: true,
    isMatch,
    distance: aggregatedDistance,
    similarity,
    faceCount,
    matchCount,
    frameResults
  };
}

/**
 * Single-frame verification (faster but less reliable)
 * Used when speed is critical or for backward compatibility
 */
async function silentVerifyFaceSingleFrame(videoElement, storedEmbedding) {
  // Extract descriptor from current video frame
  const extraction = await extractDescriptorFromVideo(videoElement);
  
  if (!extraction.success) {
    return {
      success: false,
      error: extraction.error,
      faceCount: extraction.faceCount
    };
  }
  
  // Calculate Euclidean distance
  const distance = euclideanDistance(extraction.descriptor, storedEmbedding);
  const isMatch = distance <= CONFIG.EUCLIDEAN_THRESHOLD;
  
  // Convert distance to similarity score (0-1) for logging
  const similarity = Math.exp(-distance);
  
  // Only log detailed results in development - biometric data is sensitive
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    console.log('[FaceUtils] Single-frame verification result:', {
      distance: distance.toFixed(4),
      threshold: CONFIG.EUCLIDEAN_THRESHOLD,
      isMatch
    });
  }
  
  return {
    success: true,
    isMatch,
    distance,
    similarity,
    faceCount: 1
  };
}

/**
 * Capture a screenshot from video for evidence
 * @param {HTMLVideoElement} videoElement 
 * @param {number} quality - JPEG quality (0-1)
 * @returns {Promise<{dataUrl: string, blob: Blob} | null>}
 */
export async function captureVideoFrame(videoElement, quality = 0.85) {
  if (!videoElement || videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return null;
  }
  
  try {
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth || 640;
    canvas.height = videoElement.videoHeight || 480;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    
    const blob = await new Promise(resolve => {
      canvas.toBlob(resolve, 'image/jpeg', quality);
    });
    
    return { dataUrl, blob };
  } catch (error) {
    console.error('[FaceUtils] Frame capture error:', error);
    return null;
  }
}

// Export config for reference
export { CONFIG as FACE_VERIFICATION_CONFIG };
