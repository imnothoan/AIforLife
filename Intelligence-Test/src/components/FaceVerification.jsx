import { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Camera, RefreshCw, CheckCircle, XCircle, Loader2, AlertTriangle, User } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import * as faceapi from 'face-api.js';

// ============================================
// FACE VERIFICATION COMPONENT
// Uses face-api.js with FaceNet (128D embeddings) for accurate face recognition
// This replaces MediaPipe landmarks which are NOT designed for identity verification
// ============================================

const FACE_CONFIG = {
  // Face detection thresholds
  MIN_DETECTION_CONFIDENCE: 0.5,
  MIN_FACE_SIZE: 0.08,
  MAX_FACE_SIZE: 0.90,
  // Face recognition - Euclidean distance threshold
  // FaceNet uses Euclidean distance. Lower = stricter matching.
  // Typical values: 0.4 (very strict) - 0.6 (lenient)
  // We use 0.55 as balanced threshold to handle minor expression changes (smile, slight tilt)
  EUCLIDEAN_THRESHOLD: 0.55,
  VERIFICATION_TIMEOUT: 30, // Seconds for random verification
  // Model URL (using vladmandic's face-api fork with better models)
  MODEL_URL: 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model',
  // Performance optimization: use TinyFaceDetector for faster initial detection
  USE_TINY_DETECTOR: true,
  // Reduce detection interval to save CPU (higher = less CPU, slower feedback)
  DETECTION_INTERVAL_MS: 400, // 2.5 FPS for guidance, increased from 300ms for less lag
  // Use lower input size for TinyFaceDetector to reduce lag
  TINY_INPUT_SIZE: 224, // Reduced from 320 for faster detection
  // Multi-capture settings for more reliable enrollment
  MULTI_CAPTURE: {
    ENABLED: true,
    FRAME_COUNT: 3,       // Capture 3 frames
    FRAME_DELAY_MS: 300,  // 300ms between frames
  },
};

// Model loading state (singleton to avoid reloading)
let modelsLoaded = false;
let modelLoadingPromise = null;

/**
 * Load face-api.js models (TinyFaceDetector + FaceNet for 128D embeddings)
 * Uses singleton pattern to prevent multiple loads
 * Optimized for performance: TinyFaceDetector is much lighter than SSD MobileNet
 */
async function loadModels() {
  if (modelsLoaded) return true;
  
  if (modelLoadingPromise) {
    return modelLoadingPromise;
  }
  
  modelLoadingPromise = (async () => {
    try {
      console.log('[FaceVerification] Loading face-api.js models from:', FACE_CONFIG.MODEL_URL);
      
      // Load required models:
      // - tinyFaceDetector: Very fast face detection (recommended for real-time)
      // - ssdMobilenetv1: Backup for more accurate detection when capturing
      // - faceLandmark68Net: 68-point face landmarks (needed for descriptor extraction)
      // - faceRecognitionNet: FaceNet 128D embeddings for recognition
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(FACE_CONFIG.MODEL_URL),
        faceapi.nets.ssdMobilenetv1.loadFromUri(FACE_CONFIG.MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(FACE_CONFIG.MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(FACE_CONFIG.MODEL_URL),
      ]);
      
      modelsLoaded = true;
      console.log('[FaceVerification] ✅ face-api.js models loaded successfully');
      return true;
    } catch (error) {
      console.error('[FaceVerification] ❌ Error loading models:', error);
      modelLoadingPromise = null;
      throw error;
    }
  })();
  
  return modelLoadingPromise;
}

/**
 * Calculate Euclidean distance between two face descriptors
 * FaceNet uses Euclidean distance for face matching
 * @param {Float32Array|number[]} a - First descriptor (128D)
 * @param {Float32Array|number[]} b - Second descriptor (128D)
 * @returns {number} Euclidean distance (lower = more similar)
 */
function euclideanDistance(a, b) {
  if (!a || !b) return Infinity;
  
  // Convert to arrays if needed
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
 * Convert Float32Array to regular array for JSON storage in database
 */
function descriptorToArray(descriptor) {
  if (!descriptor) return null;
  if (Array.isArray(descriptor)) return descriptor;
  if (descriptor instanceof Float32Array) return Array.from(descriptor);
  return null;
}

// Legacy export for backward compatibility (convert distance to similarity-like score)
function cosineSimilarity(a, b) {
  const dist = euclideanDistance(a, b);
  // Convert distance to similarity (1 = identical, 0 = very different)
  // Using exponential decay: e^(-dist) gives smooth 0-1 range
  return Math.exp(-dist);
}

// Legacy exports for backward compatibility
function extractFaceEmbedding() {
  console.warn('[FaceVerification] extractFaceEmbedding is deprecated');
  return null;
}

function detectBlink() {
  return false;
}

function checkHeadMovement() {
  return 0;
}

export default function FaceVerification({
  mode = 'verify', // 'enroll' | 'verify' | 'random'
  storedEmbedding = null,
  onSuccess,
  onFailure,
  onEnrollComplete,
  className = ''
}) {
  const { t } = useLanguage();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const statusRef = useRef('initializing');
  const detectionIntervalRef = useRef(null);

  const [status, setStatus] = useState('initializing');
  const [capturedImage, setCapturedImage] = useState(null);
  const [capturedDescriptor, setCapturedDescriptor] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [countdown, setCountdown] = useState(mode === 'random' ? FACE_CONFIG.VERIFICATION_TIMEOUT : null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [faceQuality, setFaceQuality] = useState(null);
  const [modelLoadProgress, setModelLoadProgress] = useState('');

  // Helper to update both status state and ref
  const updateStatus = useCallback((newStatus) => {
    statusRef.current = newStatus;
    setStatus(newStatus);
  }, []);

  // ============================================
  // CAMERA CLEANUP FUNCTION
  // ============================================
  const stopCamera = useCallback(() => {
    console.log('[FaceVerification] Stopping camera...');
    
    // Clear detection interval
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }
    
    // Stop all tracks
    if (cameraStreamRef.current) {
      const tracks = cameraStreamRef.current.getTracks();
      tracks.forEach(track => {
        track.stop();
        console.log(`[FaceVerification] Stopped track: ${track.kind} (${track.label})`);
      });
      cameraStreamRef.current = null;
    }
    
    // Clear video source
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    console.log('[FaceVerification] ✅ Camera stopped successfully');
  }, []);

  // ============================================
  // INITIALIZE MODELS AND CAMERA
  // ============================================
  useEffect(() => {
    let isMounted = true;
    let globalTimeoutId = null;

    const initialize = async () => {
      try {
        setModelLoadProgress(t('face.loadingModels') || 'Đang tải mô hình nhận dạng...');
        
        // Load face-api.js models with timeout
        const modelLoadPromise = loadModels();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Model loading timeout')), 45000)
        );
        
        await Promise.race([modelLoadPromise, timeoutPromise]);
        
        if (!isMounted) return;
        
        setModelLoadProgress(t('face.startingCamera') || 'Đang khởi động camera...');
        
        // Start camera
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' }
        });
        
        if (!isMounted) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        
        cameraStreamRef.current = stream;
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadeddata = () => {
            if (isMounted) {
              console.log('[FaceVerification] ✅ Video loaded, starting detection');
              updateStatus('ready');
              startFaceDetectionLoop();
            }
          };
        }
        
      } catch (error) {
        console.error('[FaceVerification] Initialization error:', error);
        if (isMounted) {
          updateStatus('failed');
          if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            setErrorMessage(t('anticheat.cameraAccess'));
          } else if (error.message?.includes('timeout')) {
            setErrorMessage(t('error.timeout'));
          } else {
            setErrorMessage(t('error.general'));
          }
        }
      }
    };

    // Global timeout to prevent infinite loading
    globalTimeoutId = setTimeout(() => {
      if (isMounted && statusRef.current === 'initializing') {
        console.warn('[FaceVerification] Global initialization timeout');
        updateStatus('failed');
        setErrorMessage(t('error.timeout'));
      }
    }, 60000);

    initialize();

    return () => {
      isMounted = false;
      if (globalTimeoutId) clearTimeout(globalTimeoutId);
      stopCamera();
    };
  }, [stopCamera, t, updateStatus]);

  // ============================================
  // FACE DETECTION LOOP (Real-time guidance)
  // Uses TinyFaceDetector for better performance
  // ============================================
  const startFaceDetectionLoop = useCallback(() => {
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
    }

    let frameCount = 0;
    
    const detectFace = async () => {
      if (!videoRef.current || statusRef.current !== 'ready' || !modelsLoaded) {
        return;
      }

      try {
        const video = videoRef.current;
        
        // Skip if video not ready
        if (video.readyState < 2 || video.videoWidth === 0) {
          return;
        }
        
        // Use TinyFaceDetector for faster real-time guidance (much lighter than SSD)
        // Use smaller input size to reduce processing time
        const detectorOptions = FACE_CONFIG.USE_TINY_DETECTOR
          ? new faceapi.TinyFaceDetectorOptions({ 
              inputSize: FACE_CONFIG.TINY_INPUT_SIZE, 
              scoreThreshold: FACE_CONFIG.MIN_DETECTION_CONFIDENCE 
            })
          : new faceapi.SsdMobilenetv1Options({ minConfidence: FACE_CONFIG.MIN_DETECTION_CONFIDENCE });
        
        const detections = await faceapi.detectAllFaces(video, detectorOptions);
        
        frameCount++;
        
        // Log periodically (reduced frequency)
        if (frameCount % 50 === 1) {
          console.log('[FaceVerification] Detection:', detections.length, 'faces');
        }
        
        if (detections.length === 0) {
          setFaceDetected(false);
          setFaceQuality(null);
        } else if (detections.length > 1) {
          setFaceDetected(true);
          setFaceQuality('multiple');
        } else {
          setFaceDetected(true);
          
          // Check face quality based on bounding box
          const box = detections[0].box;
          const faceWidthRatio = box.width / video.videoWidth;
          const faceHeightRatio = box.height / video.videoHeight;
          const faceCenterX = (box.x + box.width / 2) / video.videoWidth;
          const faceCenterY = (box.y + box.height / 2) / video.videoHeight;
          
          if (faceWidthRatio < FACE_CONFIG.MIN_FACE_SIZE) {
            setFaceQuality('too_small');
          } else if (faceWidthRatio > FACE_CONFIG.MAX_FACE_SIZE) {
            setFaceQuality('too_large');
          } else if (Math.abs(faceCenterX - 0.5) > 0.25 || Math.abs(faceCenterY - 0.5) > 0.25) {
            setFaceQuality('off_center');
          } else {
            setFaceQuality('good');
          }
        }
      } catch (error) {
        console.warn('[FaceVerification] Detection error:', error);
      }
    };

    // Run detection at optimized interval for smooth but lightweight feedback
    detectionIntervalRef.current = setInterval(detectFace, FACE_CONFIG.DETECTION_INTERVAL_MS);
    detectFace(); // Run immediately
    
    console.log('[FaceVerification] Face detection loop started with TinyFaceDetector');
  }, []);

  // ============================================
  // COUNTDOWN TIMER (Random verification)
  // ============================================
  useEffect(() => {
    if (mode !== 'random' || countdown === null) return;

    if (countdown <= 0) {
      setStatus('failed');
      setErrorMessage(t('face.failed'));
      stopCamera();
      onFailure?.('timeout');
      return;
    }

    const timer = setTimeout(() => {
      setCountdown(prev => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown, mode, onFailure, t, stopCamera]);

  // ============================================
  // CAPTURE PHOTO AND EXTRACT DESCRIPTOR
  // Multi-frame capture for better reliability
  // ============================================
  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current || !modelsLoaded) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    try {
      // Multi-frame capture for more reliable enrollment
      const { ENABLED, FRAME_COUNT, FRAME_DELAY_MS } = FACE_CONFIG.MULTI_CAPTURE;
      const descriptors = [];
      let lastImage = null;
      
      const frameCount = ENABLED ? FRAME_COUNT : 1;
      
      for (let i = 0; i < frameCount; i++) {
        // Capture current frame
        ctx.drawImage(video, 0, 0);
        
        // Detect face with landmarks and extract 128D descriptor
        const detection = await faceapi
          .detectSingleFace(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: FACE_CONFIG.MIN_DETECTION_CONFIDENCE }))
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (!detection) {
          if (i === frameCount - 1 && descriptors.length === 0) {
            setErrorMessage(t('face.noFaceDetected'));
            return;
          }
          // Continue to next frame
          if (i < frameCount - 1) {
            await new Promise(resolve => setTimeout(resolve, FRAME_DELAY_MS));
          }
          continue;
        }

        // Check for multiple faces
        const allFaces = await faceapi.detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: FACE_CONFIG.MIN_DETECTION_CONFIDENCE }));
        if (allFaces.length > 1) {
          setErrorMessage(t('face.multipleFaces'));
          return;
        }

        // Get the 128D face descriptor
        const descriptor = descriptorToArray(detection.descriptor);
        
        if (descriptor && descriptor.length === 128) {
          descriptors.push(descriptor);
          lastImage = canvas.toDataURL('image/jpeg', 0.85);
        }
        
        // Wait before next capture (except for last frame)
        if (i < frameCount - 1) {
          await new Promise(resolve => setTimeout(resolve, FRAME_DELAY_MS));
        }
      }
      
      if (descriptors.length === 0) {
        setErrorMessage(t('face.poorQuality'));
        return;
      }
      
      // Average the descriptors for more stable embedding
      let finalDescriptor;
      if (descriptors.length === 1) {
        finalDescriptor = descriptors[0];
      } else {
        // Compute element-wise average of all descriptors
        finalDescriptor = new Array(128).fill(0);
        for (const desc of descriptors) {
          for (let j = 0; j < 128; j++) {
            finalDescriptor[j] += desc[j];
          }
        }
        for (let j = 0; j < 128; j++) {
          finalDescriptor[j] /= descriptors.length;
        }
      }

      console.log(`[FaceVerification] ✅ Face descriptor extracted from ${descriptors.length} frames (128D averaged)`);

      // Store captured data
      setCapturedImage(lastImage);
      setCapturedDescriptor(finalDescriptor);
      updateStatus('captured');
      setErrorMessage('');

    } catch (error) {
      console.error('[FaceVerification] Capture error:', error);
      setErrorMessage(t('error.general'));
    }
  };

  // ============================================
  // RETAKE PHOTO
  // ============================================
  const handleRetake = () => {
    setCapturedImage(null);
    setCapturedDescriptor(null);
    updateStatus('ready');
    setErrorMessage('');
    startFaceDetectionLoop();
  };

  // ============================================
  // VERIFY OR ENROLL
  // ============================================
  const handleVerify = async () => {
    if (!capturedDescriptor) return;

    updateStatus('verifying');

    // Small delay for UX
    await new Promise(resolve => setTimeout(resolve, 800));

    if (mode === 'enroll') {
      // Enrollment mode - save descriptor and complete
      updateStatus('success');
      stopCamera();
      onEnrollComplete?.(capturedDescriptor, capturedImage);
      return;
    }

    // Verification mode - compare with stored descriptor
    if (!storedEmbedding) {
      // No stored embedding - treat as first-time enrollment
      updateStatus('success');
      stopCamera();
      onEnrollComplete?.(capturedDescriptor, capturedImage);
      return;
    }

    // Calculate Euclidean distance between descriptors
    const distance = euclideanDistance(capturedDescriptor, storedEmbedding);
    const similarity = Math.exp(-distance); // Convert to 0-1 scale for display
    
    // Only log in development mode - don't expose biometric data in production
    if (import.meta.env.DEV) {
      console.log('[FaceVerification] Verification result:', {
        distance: distance.toFixed(4),
        threshold: FACE_CONFIG.EUCLIDEAN_THRESHOLD,
        match: distance <= FACE_CONFIG.EUCLIDEAN_THRESHOLD
      });
    }

    if (distance <= FACE_CONFIG.EUCLIDEAN_THRESHOLD) {
      updateStatus('success');
      stopCamera();
      onSuccess?.(similarity);
    } else {
      updateStatus('failed');
      setErrorMessage(t('face.mismatch'));
      onFailure?.('mismatch', similarity);
    }
  };

  // ============================================
  // FACE QUALITY MESSAGE
  // ============================================
  const getFaceQualityMessage = () => {
    if (!faceDetected) return t('face.noFaceDetected');
    switch (faceQuality) {
      case 'too_small': return t('face.moveCloser');
      case 'too_large': return t('face.moveFarther');
      case 'off_center': return t('face.centerFace');
      case 'multiple': return t('face.multipleFaces');
      case 'good': return '✓ ' + t('face.ready');
      default: return '';
    }
  };

  // ============================================
  // RENDER
  // ============================================
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`bg-paper rounded-2xl shadow-soft p-6 max-w-md w-full mx-auto max-h-[85vh] overflow-y-auto ${className}`}
    >
      {/* Header */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-primary-100 rounded-full mb-3">
          <User className="w-7 h-7 text-primary" />
        </div>
        <h2 className="text-xl font-bold text-text-main">
          {mode === 'enroll' ? t('face.enrollTitle') :
            mode === 'random' ? t('face.randomCheck') : t('face.title')}
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          {mode === 'enroll' ? t('face.enrollSubtitle') :
            mode === 'random' ? t('face.randomCheckDesc') : t('face.subtitle')}
        </p>
      </div>

      {/* Countdown for random verification */}
      {mode === 'random' && countdown !== null && status !== 'success' && (
        <div className={`text-center mb-4 p-2 rounded-lg ${countdown <= 10 ? 'bg-danger-100 text-danger' : 'bg-warning-100 text-warning-700'}`}>
          <span className="font-bold">{t('face.countdown', { seconds: countdown })}</span>
        </div>
      )}

      {/* Camera/Photo area */}
      <div className="relative bg-gray-900 rounded-xl overflow-hidden aspect-video mb-4">
        {status === 'captured' || status === 'verifying' || status === 'success' || status === 'failed' ? (
          <img src={capturedImage} alt="Captured" className="w-full h-full object-cover" />
        ) : (
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        )}

        {/* Face detection overlay */}
        {status === 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className={`w-48 h-64 border-4 rounded-3xl transition-colors ${
              faceQuality === 'good' ? 'border-success' :
              faceDetected ? 'border-warning' : 'border-gray-400'
            }`} />
          </div>
        )}

        {/* Status overlays */}
        {status === 'initializing' && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="text-center text-white">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
              <p className="text-sm">{modelLoadProgress || t('common.loading')}</p>
            </div>
          </div>
        )}

        {status === 'verifying' && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="text-center text-white">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
              <p className="text-sm">{t('face.verifying')}</p>
            </div>
          </div>
        )}

        {status === 'success' && (
          <div className="absolute inset-0 bg-success/20 flex items-center justify-center">
            <div className="bg-white rounded-full p-3">
              <CheckCircle className="w-12 h-12 text-success" />
            </div>
          </div>
        )}

        {status === 'failed' && (
          <div className="absolute inset-0 bg-danger/20 flex items-center justify-center">
            <div className="bg-white rounded-full p-3">
              <XCircle className="w-12 h-12 text-danger" />
            </div>
          </div>
        )}

        {/* Camera indicator */}
        {(status === 'ready' || status === 'captured') && (
          <div className="absolute bottom-2 left-2 flex items-center space-x-1 bg-black/50 text-white text-xs px-2 py-1 rounded">
            <Camera className="w-3 h-3" />
            <span>Camera</span>
          </div>
        )}
      </div>

      {/* Hidden canvas for image capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Face quality feedback */}
      {status === 'ready' && (
        <div className={`text-center text-sm mb-4 ${
          faceQuality === 'good' ? 'text-success' :
          faceDetected ? 'text-warning' : 'text-gray-500'
        }`}>
          {getFaceQualityMessage()}
        </div>
      )}

      {/* Error message */}
      {errorMessage && (
        <div className="flex items-center space-x-2 p-3 bg-danger-50 text-danger rounded-lg mb-4">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{errorMessage}</span>
        </div>
      )}

      {/* Success message */}
      {status === 'success' && (
        <div className="flex items-center space-x-2 p-3 bg-success-50 text-success rounded-lg mb-4">
          <CheckCircle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">
            {mode === 'enroll' ? t('face.enrollSuccess') : t('face.success')}
          </span>
        </div>
      )}

      {/* Instructions */}
      {status === 'ready' && (
        <div className="bg-gray-50 rounded-lg p-3 mb-4">
          <p className="text-sm font-medium text-gray-700 mb-2">{t('face.instructions')}</p>
          <ul className="text-xs text-gray-500 space-y-1">
            <li>• {t('face.instruction1')}</li>
            <li>• {t('face.instruction2')}</li>
            <li>• {t('face.instruction3')}</li>
            <li>• {t('face.instruction4')}</li>
          </ul>
        </div>
      )}

      {/* Action buttons */}
      <div className="pt-3 flex space-x-3">
        {status === 'ready' && (
          <button
            onClick={handleCapture}
            disabled={!faceDetected || faceQuality === 'multiple'}
            className="flex-1 btn-primary py-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Camera className="w-5 h-5 mr-2" />
            {t('face.capture')}
          </button>
        )}

        {status === 'captured' && (
          <>
            <button onClick={handleRetake} className="flex-1 btn-secondary py-3">
              <RefreshCw className="w-5 h-5 mr-2" />
              {t('face.retake')}
            </button>
            <button onClick={handleVerify} className="flex-1 btn-primary py-3">
              <CheckCircle className="w-5 h-5 mr-2" />
              {mode === 'enroll' ? t('common.save') : t('face.verify')}
            </button>
          </>
        )}

        {status === 'failed' && (
          <button onClick={handleRetake} className="flex-1 btn-primary py-3">
            <RefreshCw className="w-5 h-5 mr-2" />
            {t('face.retake')}
          </button>
        )}
      </div>
    </motion.div>
  );
}

// Export helper functions for backward compatibility
export { extractFaceEmbedding, cosineSimilarity, detectBlink, checkHeadMovement, FACE_CONFIG };
