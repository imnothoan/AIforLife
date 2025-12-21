/**
 * Face Verification Utilities
 * 
 * Provides silent face verification from video stream without interrupting the user.
 * Uses face-api.js with FaceNet (128D embeddings) for accurate face recognition.
 */

import * as faceapi from 'face-api.js';

// Configuration
const CONFIG = {
  // Model URL (using vladmandic's face-api fork with better models)
  MODEL_URL: 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model',
  // Face detection confidence
  MIN_DETECTION_CONFIDENCE: 0.5,
  // Face recognition - Euclidean distance threshold
  // FaceNet uses Euclidean distance. Lower = stricter matching.
  EUCLIDEAN_THRESHOLD: 0.5,
  // Timeout for model loading (ms)
  MODEL_LOAD_TIMEOUT: 30000,
};

// Model loading state (singleton)
let modelsLoaded = false;
let modelLoadingPromise = null;

/**
 * Load face-api.js models (singleton pattern)
 * @returns {Promise<boolean>} True if models loaded successfully
 */
export async function loadFaceModels() {
  if (modelsLoaded) return true;
  
  if (modelLoadingPromise) {
    return modelLoadingPromise;
  }
  
  modelLoadingPromise = (async () => {
    try {
      console.log('[FaceUtils] Loading face-api.js models...');
      
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(CONFIG.MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(CONFIG.MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(CONFIG.MODEL_URL),
      ]);
      
      modelsLoaded = true;
      console.log('[FaceUtils] ✅ Models loaded successfully');
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
    // Detect all faces first (to check for multi-person)
    const allFaces = await faceapi.detectAllFaces(
      videoElement,
      new faceapi.SsdMobilenetv1Options({ minConfidence: CONFIG.MIN_DETECTION_CONFIDENCE })
    );
    
    if (allFaces.length === 0) {
      return { success: false, error: 'NO_FACE', faceCount: 0 };
    }
    
    if (allFaces.length > 1) {
      return { success: false, error: 'MULTI_PERSON', faceCount: allFaces.length };
    }
    
    // Extract descriptor from the single face
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
 * This function captures a frame from the video, extracts the face descriptor,
 * and compares it with the stored embedding - all without user interaction.
 * 
 * @param {HTMLVideoElement} videoElement - The video element to capture from
 * @param {number[]} storedEmbedding - The stored face embedding to compare against
 * @returns {Promise<{
 *   success: boolean,
 *   isMatch?: boolean,
 *   distance?: number,
 *   similarity?: number,
 *   error?: string,
 *   faceCount?: number
 * }>}
 */
export async function silentVerifyFace(videoElement, storedEmbedding) {
  if (!storedEmbedding || !Array.isArray(storedEmbedding) || storedEmbedding.length !== 128) {
    return { success: false, error: 'Invalid stored embedding' };
  }
  
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
    console.log('[FaceUtils] Silent verification result:', {
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
