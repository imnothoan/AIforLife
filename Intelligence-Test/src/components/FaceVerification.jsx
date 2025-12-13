import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, RefreshCw, CheckCircle, XCircle, Loader2, AlertTriangle, User } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// ============================================
// FACE VERIFICATION COMPONENT
// Uses MediaPipe Face Landmarker for face detection and embedding extraction
// Implements "Face Verification at Critical Points" strategy
// ============================================

const FACE_CONFIG = {
  MIN_DETECTION_CONFIDENCE: 0.7,
  MIN_FACE_SIZE: 0.15, // Minimum face size as percentage of frame
  MAX_FACE_SIZE: 0.85, // Maximum face size as percentage of frame
  SIMILARITY_THRESHOLD: 0.6, // Cosine similarity threshold for match
  VERIFICATION_TIMEOUT: 30, // Seconds
};

// Simple face embedding using landmark positions (normalized)
// This is a lightweight approach that works well for identity verification
function extractFaceEmbedding(landmarks) {
  if (!landmarks || landmarks.length < 468) return null;
  
  // Use key facial landmarks to create a compact embedding
  // These points capture unique facial geometry
  const keyPoints = [
    // Face contour
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
    // Eyebrows
    70, 63, 105, 66, 107, 336, 296, 334, 293, 300,
    // Eyes
    33, 160, 158, 133, 153, 144, 362, 385, 387, 263, 373, 380,
    // Nose
    1, 2, 98, 327, 168, 197, 195, 5,
    // Mouth
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291,
    // Chin
    152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234,
  ];
  
  const embedding = [];
  
  // Extract normalized coordinates and distances
  for (const idx of keyPoints) {
    if (landmarks[idx]) {
      embedding.push(landmarks[idx].x);
      embedding.push(landmarks[idx].y);
      embedding.push(landmarks[idx].z || 0);
    }
  }
  
  // Add inter-landmark distances for more robust matching
  const noseTip = landmarks[1];
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];
  const leftMouth = landmarks[61];
  const rightMouth = landmarks[291];
  const chin = landmarks[152];
  
  if (noseTip && leftEye && rightEye && leftMouth && rightMouth && chin) {
    // Eye distance
    embedding.push(Math.sqrt(
      Math.pow(rightEye.x - leftEye.x, 2) + 
      Math.pow(rightEye.y - leftEye.y, 2)
    ));
    // Nose to chin
    embedding.push(Math.sqrt(
      Math.pow(chin.x - noseTip.x, 2) + 
      Math.pow(chin.y - noseTip.y, 2)
    ));
    // Mouth width
    embedding.push(Math.sqrt(
      Math.pow(rightMouth.x - leftMouth.x, 2) + 
      Math.pow(rightMouth.y - leftMouth.y, 2)
    ));
    // Eye to mouth ratio
    const eyeCenter = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };
    const mouthCenter = { x: (leftMouth.x + rightMouth.x) / 2, y: (leftMouth.y + rightMouth.y) / 2 };
    embedding.push(Math.sqrt(
      Math.pow(mouthCenter.x - eyeCenter.x, 2) + 
      Math.pow(mouthCenter.y - eyeCenter.y, 2)
    ));
  }
  
  return embedding;
}

// Calculate cosine similarity between two embeddings
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (normA * normB);
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
  const faceLandmarkerRef = useRef(null);
  
  const [status, setStatus] = useState('initializing'); // 'initializing' | 'ready' | 'captured' | 'verifying' | 'success' | 'failed'
  const [capturedImage, setCapturedImage] = useState(null);
  const [capturedEmbedding, setCapturedEmbedding] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [countdown, setCountdown] = useState(mode === 'random' ? FACE_CONFIG.VERIFICATION_TIMEOUT : null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [faceQuality, setFaceQuality] = useState(null); // 'good' | 'too_small' | 'too_large' | 'off_center'

  // Initialize MediaPipe Face Landmarker
  useEffect(() => {
    let isMounted = true;
    
    const initFaceLandmarker = async () => {
      try {
        // Using pinned version for stability
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm"
        );
        
        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU"
          },
          runningMode: "IMAGE",
          numFaces: 2, // Detect up to 2 to check for multiple people
          minFaceDetectionConfidence: FACE_CONFIG.MIN_DETECTION_CONFIDENCE,
          minTrackingConfidence: 0.5,
        });
        
        if (isMounted) {
          faceLandmarkerRef.current = landmarker;
          await startCamera();
        }
      } catch (error) {
        console.error('Face landmarker initialization error:', error);
        if (isMounted) {
          setStatus('failed');
          setErrorMessage(t('error.general'));
        }
      }
    };
    
    initFaceLandmarker();
    
    return () => {
      isMounted = false;
      if (faceLandmarkerRef.current) {
        faceLandmarkerRef.current.close();
      }
    };
  }, []);

  // Start camera
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' }
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadeddata = () => {
          setStatus('ready');
          startFaceDetectionLoop();
        };
      }
    } catch (error) {
      console.error('Camera access error:', error);
      setStatus('failed');
      setErrorMessage(t('anticheat.cameraAccess'));
    }
  };

  // Real-time face detection for guidance
  const startFaceDetectionLoop = useCallback(() => {
    const detectFace = async () => {
      if (!videoRef.current || !faceLandmarkerRef.current || status !== 'ready') return;
      
      try {
        const result = faceLandmarkerRef.current.detect(videoRef.current);
        
        if (result.faceLandmarks.length === 0) {
          setFaceDetected(false);
          setFaceQuality(null);
        } else if (result.faceLandmarks.length > 1) {
          setFaceDetected(true);
          setFaceQuality('multiple');
        } else {
          setFaceDetected(true);
          
          // Check face quality
          const landmarks = result.faceLandmarks[0];
          const faceWidth = Math.abs(landmarks[234].x - landmarks[454].x);
          const faceHeight = Math.abs(landmarks[10].y - landmarks[152].y);
          const faceCenterX = (landmarks[234].x + landmarks[454].x) / 2;
          const faceCenterY = (landmarks[10].y + landmarks[152].y) / 2;
          
          if (faceWidth < FACE_CONFIG.MIN_FACE_SIZE || faceHeight < FACE_CONFIG.MIN_FACE_SIZE) {
            setFaceQuality('too_small');
          } else if (faceWidth > FACE_CONFIG.MAX_FACE_SIZE || faceHeight > FACE_CONFIG.MAX_FACE_SIZE) {
            setFaceQuality('too_large');
          } else if (Math.abs(faceCenterX - 0.5) > 0.2 || Math.abs(faceCenterY - 0.5) > 0.2) {
            setFaceQuality('off_center');
          } else {
            setFaceQuality('good');
          }
        }
      } catch (error) {
        console.warn('Face detection loop error:', error);
      }
      
      // Continue detection loop
      if (status === 'ready') {
        requestAnimationFrame(detectFace);
      }
    };
    
    detectFace();
  }, [status]);

  // Countdown timer for random verification
  useEffect(() => {
    if (mode !== 'random' || countdown === null) return;
    
    if (countdown <= 0) {
      // Time's up - verification failed
      setStatus('failed');
      setErrorMessage(t('face.failed'));
      onFailure?.('timeout');
      return;
    }
    
    const timer = setTimeout(() => {
      setCountdown(prev => prev - 1);
    }, 1000);
    
    return () => clearTimeout(timer);
  }, [countdown, mode, onFailure, t]);

  // Capture photo
  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current || !faceLandmarkerRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    
    // Detect face in captured image
    try {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const imageBitmap = await createImageBitmap(imageData);
      const result = faceLandmarkerRef.current.detect(imageBitmap);
      imageBitmap.close();
      
      if (result.faceLandmarks.length === 0) {
        setErrorMessage(t('face.noFaceDetected'));
        return;
      }
      
      if (result.faceLandmarks.length > 1) {
        setErrorMessage(t('face.multipleFaces'));
        return;
      }
      
      // Extract face embedding
      const embedding = extractFaceEmbedding(result.faceLandmarks[0]);
      
      if (!embedding) {
        setErrorMessage(t('face.poorQuality'));
        return;
      }
      
      // Store captured data
      setCapturedImage(canvas.toDataURL('image/jpeg', 0.8));
      setCapturedEmbedding(embedding);
      setStatus('captured');
      setErrorMessage('');
      
    } catch (error) {
      console.error('Capture error:', error);
      setErrorMessage(t('error.general'));
    }
  };

  // Retake photo
  const handleRetake = () => {
    setCapturedImage(null);
    setCapturedEmbedding(null);
    setStatus('ready');
    setErrorMessage('');
    startFaceDetectionLoop();
  };

  // Verify or enroll
  const handleVerify = async () => {
    if (!capturedEmbedding) return;
    
    setStatus('verifying');
    
    // Simulate processing delay for UX
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    if (mode === 'enroll') {
      // Enrollment mode - save embedding and complete
      setStatus('success');
      onEnrollComplete?.(capturedEmbedding, capturedImage);
      return;
    }
    
    // Verification mode - compare with stored embedding
    if (!storedEmbedding) {
      // No stored embedding - treat as first-time enrollment
      setStatus('success');
      onEnrollComplete?.(capturedEmbedding, capturedImage);
      return;
    }
    
    const similarity = cosineSimilarity(capturedEmbedding, storedEmbedding);
    // Removed console.log for production security - similarity score is sensitive biometric data
    
    if (similarity >= FACE_CONFIG.SIMILARITY_THRESHOLD) {
      setStatus('success');
      onSuccess?.(similarity);
    } else {
      setStatus('failed');
      setErrorMessage(t('face.mismatch'));
      onFailure?.('mismatch', similarity);
    }
  };

  // Get face quality message
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

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`bg-paper rounded-2xl shadow-soft p-6 max-w-md w-full ${className}`}
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
          // Show captured image
          <img 
            src={capturedImage} 
            alt="Captured" 
            className="w-full h-full object-cover"
          />
        ) : (
          // Show live video
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        )}
        
        {/* Face detection overlay */}
        {status === 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className={`w-48 h-64 border-4 rounded-3xl ${
              faceQuality === 'good' ? 'border-success' : 
              faceDetected ? 'border-warning' : 'border-gray-400'
            } transition-colors`} />
          </div>
        )}
        
        {/* Status overlays */}
        {status === 'initializing' && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="text-center text-white">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
              <p className="text-sm">{t('common.loading')}</p>
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
      <div className="flex space-x-3">
        {status === 'ready' && (
          <button
            onClick={handleCapture}
            disabled={faceQuality !== 'good'}
            className="flex-1 btn-primary py-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Camera className="w-5 h-5 mr-2" />
            {t('face.capture')}
          </button>
        )}
        
        {status === 'captured' && (
          <>
            <button
              onClick={handleRetake}
              className="flex-1 btn-secondary py-3"
            >
              <RefreshCw className="w-5 h-5 mr-2" />
              {t('face.retake')}
            </button>
            <button
              onClick={handleVerify}
              className="flex-1 btn-primary py-3"
            >
              <CheckCircle className="w-5 h-5 mr-2" />
              {mode === 'enroll' ? t('common.save') : t('face.verify')}
            </button>
          </>
        )}
        
        {status === 'failed' && (
          <button
            onClick={handleRetake}
            className="flex-1 btn-primary py-3"
          >
            <RefreshCw className="w-5 h-5 mr-2" />
            {t('face.retake')}
          </button>
        )}
      </div>
    </motion.div>
  );
}

// Export helper functions for use in other components
export { extractFaceEmbedding, cosineSimilarity, FACE_CONFIG };
