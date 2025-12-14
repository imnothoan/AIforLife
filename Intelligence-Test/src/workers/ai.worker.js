// AI Worker - Implements Advanced Cascade Strategy (MediaPipe Face Mesh → YOLO)
// This worker runs in a separate thread to avoid blocking the main UI
// 
// Features:
// - Face detection and head pose estimation
// - Eye gaze tracking (iris position analysis)
// - Lip movement detection (speech detection)
// - Multi-person detection (second person alert)
// - Object detection (phone, headphones, materials)
// - Blink rate analysis (fatigue/stress detection)

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import * as ort from 'onnxruntime-web';

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  // Face detection thresholds
  FACE: {
    MIN_DETECTION_CONFIDENCE: 0.5,
    MIN_TRACKING_CONFIDENCE: 0.5,
    // Head pose thresholds (in normalized range)
    YAW_THRESHOLD: 0.25,      // Looking left/right
    PITCH_THRESHOLD: 0.20,    // Looking up/down
    CONSECUTIVE_FRAMES: 5,    // Number of suspicious frames before triggering
    // MediaPipe Face Landmarker returns 478 landmarks (468 face mesh + 10 iris)
    // We require at least 468 for full face mesh detection
    MIN_LANDMARKS_FOR_POSE: 468,
    // Eye tracking landmarks (iris)
    LEFT_IRIS: [468, 469, 470, 471, 472], // Left iris landmarks
    RIGHT_IRIS: [473, 474, 475, 476, 477], // Right iris landmarks
    LEFT_EYE: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
    RIGHT_EYE: [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398],
    // Lip landmarks for speech detection
    UPPER_LIP: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291],
    LOWER_LIP: [146, 91, 181, 84, 17, 314, 405, 321, 375, 291],
    // Thresholds
    EYE_GAZE_THRESHOLD: 0.15,     // How far iris can deviate from center
    LIP_MOVEMENT_THRESHOLD: 0.02, // Threshold for detecting speech
    BLINK_THRESHOLD: 0.2,         // Eye aspect ratio for blink detection
  },
  // YOLO settings - Custom trained model for anti-cheat detection
  YOLO: {
    MODEL_PATH: '/models/anticheat_yolo11s.onnx',
    INPUT_SIZE: 640, // Model was trained with 640x640 input
    // Confidence threshold for detection
    // 0.25 provides good balance between detection sensitivity and false positives
    CONFIDENCE_THRESHOLD: 0.25,
    IOU_THRESHOLD: 0.45,
    CLASSES: ['person', 'phone', 'material', 'headphones'], // Must match training classes
    ALERT_CLASSES: ['phone', 'material', 'headphones'], // Classes that trigger alerts
    MASK_COEFFICIENTS: 32, // Number of mask coefficients for segmentation models
    // Multi-person detection
    MULTI_PERSON_ALERT: true, // Alert if more than 1 person detected
  },
  // Cascade timing
  CASCADE: {
    YOLO_ACTIVATION_SECONDS: 3, // Activate YOLO for N seconds after suspicious activity
  },
  // Advanced detection settings
  ADVANCED: {
    LIP_MOVEMENT_FRAMES: 10,    // Number of frames to track lip movement
    LIP_ALERT_THRESHOLD: 5,    // Alert after this many frames of speaking
    BLINK_RATE_WINDOW: 30000,  // 30 seconds window for blink rate
    ABNORMAL_BLINK_RATE_LOW: 5,  // Too few blinks (staring at notes?)
    ABNORMAL_BLINK_RATE_HIGH: 40, // Too many blinks (stress?)
  }
};

// ============================================
// STATE
// ============================================
let faceLandmarker = null;
let yoloSession = null;
let suspiciousFrameCount = 0;
let lastAlertTime = 0;
let lastYoloRunTime = 0;
let isInitialized = false;

// YOLO throttle interval (run every 500ms)
const YOLO_THROTTLE_MS = 500;

// Track max scores per class for debugging (persistent across inference runs)
let maxScorePerClassPersistent = null;

// Advanced detection state
let lipMovementHistory = [];
let lastLipDistance = 0;
let speakingFrameCount = 0;
let blinkHistory = [];
let lastBlinkTime = 0;
let lastEyeAspectRatio = 0;
let multiPersonAlertTime = 0;
let lastEyeGazeAlert = 0;

// ============================================
// INITIALIZATION
// ============================================
async function initializeAI() {
  self.postMessage({ type: 'STATUS', payload: 'Đang tải model AI...' });

  try {
    // Load MediaPipe Face Landmarker
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );
    
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
        delegate: "GPU"
      },
      runningMode: "IMAGE",
      numFaces: 1,
      minFaceDetectionConfidence: CONFIG.FACE.MIN_DETECTION_CONFIDENCE,
      minTrackingConfidence: CONFIG.FACE.MIN_TRACKING_CONFIDENCE,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true // For head pose
    });
    
    console.log('MediaPipe Face Landmarker loaded successfully');
    self.postMessage({ type: 'STATUS', payload: 'Đang tải YOLO...' });

    // Load YOLO ONNX model
    try {
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
      
      // Fetch the model file first to check if it exists
      console.log('Attempting to load YOLO model from:', CONFIG.YOLO.MODEL_PATH);
      
      // Try to load the model
      yoloSession = await ort.InferenceSession.create(CONFIG.YOLO.MODEL_PATH, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      });
      
      // Log input/output details for debugging
      console.log('✅ YOLO model loaded successfully!');
      console.log('Input names:', yoloSession.inputNames);
      console.log('Output names:', yoloSession.outputNames);
      
      // Log input/output shapes if available
      if (yoloSession.inputNames && yoloSession.inputNames.length > 0) {
        console.log('Model is ready for inference with custom trained classes:', CONFIG.YOLO.CLASSES);
        console.log('Confidence threshold:', CONFIG.YOLO.CONFIDENCE_THRESHOLD);
      }
      
      self.postMessage({ type: 'STATUS', payload: '✅ AI giám sát đầy đủ (Face + YOLO)' });
    } catch (yoloError) {
      console.warn('⚠️ YOLO model not available at', CONFIG.YOLO.MODEL_PATH);
      console.warn('Error details:', yoloError.message);
      console.warn('Stack:', yoloError.stack);
      // Still allow face detection to work
      self.postMessage({ type: 'STATUS', payload: '⚠️ Giám sát khuôn mặt hoạt động (YOLO chưa sẵn sàng)' });
    }

    isInitialized = true;
  } catch (error) {
    console.error('AI initialization error:', error);
    self.postMessage({ type: 'STATUS', payload: 'Lỗi khởi tạo AI - Sử dụng chế độ cơ bản' });
    
    // Fallback: basic detection mode
    isInitialized = true;
  }
}

// ============================================
// HEAD POSE ESTIMATION
// ============================================
function extractHeadPose(faceLandmarks, transformMatrix) {
  if (!faceLandmarks || faceLandmarks.length < CONFIG.FACE.MIN_LANDMARKS_FOR_POSE) {
    return { yaw: 0, pitch: 0, roll: 0, isValid: false };
  }

  // Use transformation matrix if available
  if (transformMatrix) {
    // Extract rotation from transformation matrix
    // The matrix is in column-major order
    const m = transformMatrix.data;
    const yaw = Math.atan2(m[8], m[10]); // Around Y-axis
    const pitch = Math.asin(-m[9]); // Around X-axis
    const roll = Math.atan2(m[1], m[5]); // Around Z-axis
    
    return { yaw, pitch, roll, isValid: true };
  }

  // Fallback: Estimate from landmarks
  // Key landmarks for head pose:
  // - Nose tip: 1
  // - Left eye outer: 33
  // - Right eye outer: 263
  // - Left ear: 127
  // - Right ear: 356
  // - Chin: 152
  // - Forehead: 10
  
  const noseTip = faceLandmarks[1];
  const leftEye = faceLandmarks[33];
  const rightEye = faceLandmarks[263];
  const chin = faceLandmarks[152];
  const forehead = faceLandmarks[10];

  // Estimate yaw (left/right rotation)
  const eyeCenter = {
    x: (leftEye.x + rightEye.x) / 2,
    y: (leftEye.y + rightEye.y) / 2
  };
  const yaw = (noseTip.x - eyeCenter.x) * 2; // Simplified estimation

  // Estimate pitch (up/down rotation)
  const faceHeight = Math.abs(chin.y - forehead.y);
  const noseToForehead = noseTip.y - forehead.y;
  const pitch = (noseToForehead / faceHeight - 0.5) * 2;

  return { yaw, pitch, roll: 0, isValid: true };
}

// ============================================
// EYE GAZE TRACKING
// ============================================
function analyzeEyeGaze(faceLandmarks) {
  if (!faceLandmarks || faceLandmarks.length < 478) {
    return { isLookingAway: false, direction: null };
  }

  // Get iris centers
  const leftIrisCenter = faceLandmarks[468]; // Left iris center
  const rightIrisCenter = faceLandmarks[473]; // Right iris center
  
  // Get eye corners for reference
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
  
  if (avgGazeOffset > CONFIG.FACE.EYE_GAZE_THRESHOLD) {
    direction = 'right';
    isLookingAway = true;
  } else if (avgGazeOffset < -CONFIG.FACE.EYE_GAZE_THRESHOLD) {
    direction = 'left';
    isLookingAway = true;
  }
  
  return { isLookingAway, direction, gazeOffset: avgGazeOffset };
}

// ============================================
// LIP MOVEMENT DETECTION (SPEECH DETECTION)
// ============================================
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
  if (lipMovementHistory.length > CONFIG.ADVANCED.LIP_MOVEMENT_FRAMES) {
    lipMovementHistory.shift();
  }
  
  // Calculate movement variance
  if (lipMovementHistory.length >= 3) {
    const avgDistance = lipMovementHistory.reduce((a, b) => a + b, 0) / lipMovementHistory.length;
    const variance = lipMovementHistory.reduce((acc, val) => acc + Math.pow(val - avgDistance, 2), 0) / lipMovementHistory.length;
    
    // High variance indicates speaking
    if (variance > CONFIG.FACE.LIP_MOVEMENT_THRESHOLD) {
      speakingFrameCount++;
    } else {
      speakingFrameCount = Math.max(0, speakingFrameCount - 1);
    }
  }
  
  const isSpeaking = speakingFrameCount >= CONFIG.ADVANCED.LIP_ALERT_THRESHOLD;
  
  return { isSpeaking, lipDistance, speakingFrameCount };
}

// ============================================
// BLINK DETECTION
// ============================================
function analyzeBlinking(faceLandmarks) {
  if (!faceLandmarks || faceLandmarks.length < 400) {
    return { isBlink: false, eyeAspectRatio: 0 };
  }

  // Eye Aspect Ratio (EAR) calculation
  // Using 6 points around each eye
  
  // Left eye points
  const leftP1 = faceLandmarks[33];  // outer corner
  const leftP2 = faceLandmarks[160]; // top outer
  const leftP3 = faceLandmarks[158]; // top inner
  const leftP4 = faceLandmarks[133]; // inner corner
  const leftP5 = faceLandmarks[153]; // bottom inner
  const leftP6 = faceLandmarks[144]; // bottom outer
  
  // Right eye points
  const rightP1 = faceLandmarks[362]; // outer corner
  const rightP2 = faceLandmarks[385]; // top outer
  const rightP3 = faceLandmarks[387]; // top inner
  const rightP4 = faceLandmarks[263]; // inner corner
  const rightP5 = faceLandmarks[373]; // bottom inner
  const rightP6 = faceLandmarks[380]; // bottom outer
  
  // Calculate EAR for each eye
  const leftEAR = calculateEAR(leftP1, leftP2, leftP3, leftP4, leftP5, leftP6);
  const rightEAR = calculateEAR(rightP1, rightP2, rightP3, rightP4, rightP5, rightP6);
  
  const avgEAR = (leftEAR + rightEAR) / 2;
  const isBlink = avgEAR < CONFIG.FACE.BLINK_THRESHOLD && lastEyeAspectRatio >= CONFIG.FACE.BLINK_THRESHOLD;
  
  // Track blink history
  const now = Date.now();
  if (isBlink) {
    blinkHistory.push(now);
    // Remove old blinks
    blinkHistory = blinkHistory.filter(t => now - t < CONFIG.ADVANCED.BLINK_RATE_WINDOW);
  }
  
  lastEyeAspectRatio = avgEAR;
  
  // Calculate blink rate (blinks per minute)
  const blinkRate = (blinkHistory.length / CONFIG.ADVANCED.BLINK_RATE_WINDOW) * 60000;
  
  return { 
    isBlink, 
    eyeAspectRatio: avgEAR, 
    blinkRate,
    isAbnormalBlinkRate: blinkRate < CONFIG.ADVANCED.ABNORMAL_BLINK_RATE_LOW || blinkRate > CONFIG.ADVANCED.ABNORMAL_BLINK_RATE_HIGH
  };
}

function calculateEAR(p1, p2, p3, p4, p5, p6) {
  // Eye Aspect Ratio = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
  const verticalDist1 = Math.sqrt(Math.pow(p2.x - p6.x, 2) + Math.pow(p2.y - p6.y, 2));
  const verticalDist2 = Math.sqrt(Math.pow(p3.x - p5.x, 2) + Math.pow(p3.y - p5.y, 2));
  const horizontalDist = Math.sqrt(Math.pow(p1.x - p4.x, 2) + Math.pow(p1.y - p4.y, 2));
  
  if (horizontalDist === 0) return 0;
  return (verticalDist1 + verticalDist2) / (2 * horizontalDist);
}

// ============================================
// FRAME PROCESSING
// ============================================
async function processFrame(imageData) {
  if (!isInitialized) {
    // Fallback random detection for demo
    if (Math.random() < 0.02) {
      self.postMessage({ type: 'ALERT', payload: 'Vui lòng nhìn thẳng vào màn hình.' });
    }
    return;
  }

  const now = Date.now();
  let isSuspicious = false;
  let suspicionReason = '';

  // ============================================
  // STAGE 1: FACE MESH DETECTION WITH ADVANCED ANALYTICS
  // ============================================
  if (faceLandmarker) {
    try {
      // Create ImageBitmap from ImageData
      const imageBitmap = await createImageBitmap(imageData);
      
      const result = faceLandmarker.detect(imageBitmap);
      imageBitmap.close();

      if (result.faceLandmarks.length === 0) {
        suspiciousFrameCount++;
        if (suspiciousFrameCount >= CONFIG.FACE.CONSECUTIVE_FRAMES) {
          isSuspicious = true;
          suspicionReason = 'Không phát hiện khuôn mặt';
        }
      } else {
        const landmarks = result.faceLandmarks[0];
        const transformMatrix = result.facialTransformationMatrixes?.[0];
        const pose = extractHeadPose(landmarks, transformMatrix);

        if (pose.isValid) {
          // Check for looking away (head pose)
          if (Math.abs(pose.yaw) > CONFIG.FACE.YAW_THRESHOLD) {
            suspiciousFrameCount++;
            if (suspiciousFrameCount >= CONFIG.FACE.CONSECUTIVE_FRAMES) {
              isSuspicious = true;
              suspicionReason = pose.yaw > 0 ? 'Nhìn sang phải' : 'Nhìn sang trái';
            }
          } else if (Math.abs(pose.pitch) > CONFIG.FACE.PITCH_THRESHOLD) {
            suspiciousFrameCount++;
            if (suspiciousFrameCount >= CONFIG.FACE.CONSECUTIVE_FRAMES) {
              isSuspicious = true;
              suspicionReason = pose.pitch > 0 ? 'Cúi đầu xuống' : 'Ngẩng đầu lên';
            }
          } else {
            // Reset counter if looking at screen
            suspiciousFrameCount = Math.max(0, suspiciousFrameCount - 1);
          }
        }
        
        // ============================================
        // ADVANCED DETECTION: Eye Gaze Tracking
        // ============================================
        const eyeGaze = analyzeEyeGaze(landmarks);
        if (eyeGaze.isLookingAway && now - lastEyeGazeAlert > 8000) {
          self.postMessage({ 
            type: 'GAZE_AWAY', 
            payload: `Mắt nhìn ${eyeGaze.direction === 'left' ? 'sang trái' : 'sang phải'}` 
          });
          lastEyeGazeAlert = now;
        }
        
        // ============================================
        // ADVANCED DETECTION: Lip Movement (Speaking)
        // ============================================
        const lipAnalysis = analyzeLipMovement(landmarks);
        if (lipAnalysis.isSpeaking && now - lastAlertTime > 10000) {
          self.postMessage({ 
            type: 'ALERT', 
            payload: '⚠️ Phát hiện đang nói chuyện!' 
          });
          lastAlertTime = now;
        }
        
        // ============================================
        // ADVANCED DETECTION: Blink Analysis
        // ============================================
        const blinkAnalysis = analyzeBlinking(landmarks);
        // Only report abnormal blink rate periodically (every 30 seconds)
        if (blinkAnalysis.isAbnormalBlinkRate && blinkHistory.length > 10) {
          // Log for instructor review but don't alert student
          console.log('Abnormal blink rate detected:', blinkAnalysis.blinkRate, 'bpm');
        }
      }
    } catch (error) {
      console.warn('Face detection error:', error);
    }
  }

  // ============================================
  // STAGE 2: YOLO DETECTION
  // ============================================
  // Run YOLO detection continuously but throttled (every YOLO_THROTTLE_MS)
  // This ensures objects like phones/headphones are always detected
  if (yoloSession && (now - lastYoloRunTime >= YOLO_THROTTLE_MS)) {
    lastYoloRunTime = now;
    
    try {
      const detections = await runYoloInference(imageData);
      
      // Log all detections for debugging (only non-person detections)
      if (detections.length > 0) {
        const alertableDetections = detections.filter(d => CONFIG.YOLO.ALERT_CLASSES.includes(d.class));
        if (alertableDetections.length > 0) {
          console.log('🚨 YOLO Alert Detections:', alertableDetections.map(d => `${d.class} (${(d.confidence * 100).toFixed(1)}%)`));
        }
      }
      
      // ============================================
      // MULTI-PERSON DETECTION
      // ============================================
      if (CONFIG.YOLO.MULTI_PERSON_ALERT) {
        const personDetections = detections.filter(d => d.class === 'person' && d.confidence > 0.3);
        if (personDetections.length > 1 && now - multiPersonAlertTime > 10000) {
          self.postMessage({ 
            type: 'ALERT', 
            payload: `⚠️ Phát hiện ${personDetections.length} người trong khung hình!`
          });
          multiPersonAlertTime = now;
          console.log('🚨 Multi-person detected:', personDetections.length, 'people');
        }
      }
      
      for (const detection of detections) {
        if (CONFIG.YOLO.ALERT_CLASSES.includes(detection.class)) {
          // Throttle alerts (max once per 5 seconds per class)
          if (now - lastAlertTime > 5000) {
            const alertMessages = {
              'phone': 'Phát hiện điện thoại!',
              'material': 'Phát hiện tài liệu!',
              'headphones': 'Phát hiện tai nghe!'
            };
            self.postMessage({ 
              type: 'ALERT', 
              payload: alertMessages[detection.class] || `Phát hiện ${detection.class}!`
            });
            lastAlertTime = now;
            
            // Also update status to show detection
            const statusMsg = alertMessages[detection.class] || `Phát hiện ${detection.class}!`;
            self.postMessage({ 
              type: 'STATUS', 
              payload: `⚠️ ${statusMsg} (${(detection.confidence * 100).toFixed(0)}%)` 
            });
          }
          break;
        }
      }
    } catch (error) {
      console.warn('YOLO inference error:', error);
    }
  }

  // Send gaze away event (not blocking alert)
  if (isSuspicious && suspiciousFrameCount === CONFIG.FACE.CONSECUTIVE_FRAMES) {
    self.postMessage({ type: 'GAZE_AWAY', payload: suspicionReason });
    
    // Only send alert for prolonged suspicious activity
    if (suspiciousFrameCount >= CONFIG.FACE.CONSECUTIVE_FRAMES * 2 && now - lastAlertTime > 5000) {
      self.postMessage({ type: 'ALERT', payload: suspicionReason });
      lastAlertTime = now;
    }
  }

  // Update status periodically
  if (Math.random() < 0.01) {
    self.postMessage({ type: 'STATUS', payload: 'Đang giám sát...' });
  }
}

// ============================================
// YOLO INFERENCE
// ============================================
async function runYoloInference(imageData) {
  if (!yoloSession) return [];

  try {
    const { width, height, data } = imageData;
    const inputSize = CONFIG.YOLO.INPUT_SIZE;

    // Preprocess image data
    // Resize and normalize to [0, 1] in RGB format
    const input = new Float32Array(3 * inputSize * inputSize);
    const scaleX = width / inputSize;
    const scaleY = height / inputSize;

    for (let y = 0; y < inputSize; y++) {
      for (let x = 0; x < inputSize; x++) {
        const srcX = Math.min(Math.floor(x * scaleX), width - 1);
        const srcY = Math.min(Math.floor(y * scaleY), height - 1);
        const srcIdx = (srcY * width + srcX) * 4;
        
        const r = data[srcIdx] / 255.0;
        const g = data[srcIdx + 1] / 255.0;
        const b = data[srcIdx + 2] / 255.0;

        // CHW format (Channel, Height, Width)
        input[0 * inputSize * inputSize + y * inputSize + x] = r;
        input[1 * inputSize * inputSize + y * inputSize + x] = g;
        input[2 * inputSize * inputSize + y * inputSize + x] = b;
      }
    }

    // Create tensor with dynamic input name
    const tensor = new ort.Tensor('float32', input, [1, 3, inputSize, inputSize]);
    const inputName = yoloSession.inputNames[0] || 'images';
    const feeds = { [inputName]: tensor };
    
    const results = await yoloSession.run(feeds);

    // Get first output
    const outputName = yoloSession.outputNames[0] || 'output0';
    const outputTensor = results[outputName];
    
    if (!outputTensor) {
      console.warn('No output tensor found');
      return [];
    }

    const detections = parseYoloOutput(outputTensor.data, outputTensor.dims, width, height);
    return detections;
  } catch (error) {
    console.error('YOLO inference error:', error);
    return [];
  }
}

function parseYoloOutput(output, dims, originalWidth, originalHeight) {
  const detections = [];
  const numClasses = CONFIG.YOLO.CLASSES.length;
  const inputSize = CONFIG.YOLO.INPUT_SIZE;
  const maskCoefficients = CONFIG.YOLO.MASK_COEFFICIENTS;
  
  // Log output dimensions for debugging (only first time)
  if (!self.loggedDims) {
    console.log('YOLO Output dimensions:', dims);
    console.log('Expected classes:', numClasses);
    console.log('Model classes:', CONFIG.YOLO.CLASSES);
    self.loggedDims = true;
  }
  
  // Initialize persistent max score tracking if not done
  if (!maxScorePerClassPersistent) {
    maxScorePerClassPersistent = new Array(numClasses).fill(0);
  }
  
  // Handle different output formats
  // YOLO11 can output in different formats depending on export options
  
  if (dims.length === 3) {
    // Format: [1, channels, numBoxes] or [1, numBoxes, channels]
    const dim1 = dims[1];
    const dim2 = dims[2];
    
    const expectedDetect = 4 + numClasses;
    const expectedSeg = 4 + numClasses + maskCoefficients;
    
    // Log format determination (only first time)
    if (!self.loggedFormat) {
      console.log('Expected detect channels:', expectedDetect, '| Expected seg channels:', expectedSeg);
      console.log('Actual dims: [1,', dim1, ',', dim2, ']');
      self.loggedFormat = true;
    }
    
    // Determine format based on dimensions
    let isTransposed = false;
    let channels, numBoxes;
    
    if (dim1 === expectedDetect || dim1 === expectedSeg) {
      // Format: [1, channels, numBoxes] - transposed format
      isTransposed = true;
      channels = dim1;
      numBoxes = dim2;
    } else if (dim2 === expectedDetect || dim2 === expectedSeg) {
      // Format: [1, numBoxes, channels] - standard format
      isTransposed = false;
      channels = dim2;
      numBoxes = dim1;
    } else {
      // Try to infer from size ratio
      if (dim1 < dim2 && dim1 < 100) {
        isTransposed = true;
        channels = dim1;
        numBoxes = dim2;
      } else if (dim2 < dim1 && dim2 < 100) {
        isTransposed = false;
        channels = dim2;
        numBoxes = dim1;
      } else {
        console.warn(`Cannot determine YOLO format. Dims: [1, ${dim1}, ${dim2}], Expected channels: ${expectedDetect}`);
        return [];
      }
    }
    
    for (let i = 0; i < numBoxes; i++) {
      let cx, cy, w, h;
      let classScores = [];
      
      if (isTransposed) {
        // Transposed format: data is arranged [cx0, cx1, ..., cxN, cy0, cy1, ..., cyN, ...]
        cx = output[0 * numBoxes + i];
        cy = output[1 * numBoxes + i];
        w = output[2 * numBoxes + i];
        h = output[3 * numBoxes + i];
        
        // Extract class scores
        for (let c = 0; c < numClasses; c++) {
          classScores.push(output[(4 + c) * numBoxes + i]);
        }
      } else {
        // Standard format: data is arranged [box0_cx, box0_cy, box0_w, box0_h, box0_class0, ..., box1_cx, ...]
        const offset = i * channels;
        cx = output[offset + 0];
        cy = output[offset + 1];
        w = output[offset + 2];
        h = output[offset + 3];
        
        // Extract class scores
        for (let c = 0; c < numClasses; c++) {
          classScores.push(output[offset + 4 + c]);
        }
      }

      // Get max class score and track per-class max
      let maxScore = 0;
      let maxClass = 0;
      for (let c = 0; c < numClasses; c++) {
        if (classScores[c] > maxScore) {
          maxScore = classScores[c];
          maxClass = c;
        }
        // Track max per class for debugging (persistent)
        if (classScores[c] > maxScorePerClassPersistent[c]) {
          maxScorePerClassPersistent[c] = classScores[c];
        }
      }

      if (maxScore >= CONFIG.YOLO.CONFIDENCE_THRESHOLD) {
        // Scale coordinates back to original image size
        const scaleX = originalWidth / inputSize;
        const scaleY = originalHeight / inputSize;
        
        detections.push({
          class: CONFIG.YOLO.CLASSES[maxClass],
          confidence: maxScore,
          box: {
            x: (cx - w / 2) * scaleX,
            y: (cy - h / 2) * scaleY,
            width: w * scaleX,
            height: h * scaleY
          }
        });
      }
    }
    
    // Log max scores per class periodically for debugging
    if (!self.lastMaxScoreLog || (Date.now() - self.lastMaxScoreLog > 10000)) {
      self.lastMaxScoreLog = Date.now();
      const maxScoreInfo = CONFIG.YOLO.CLASSES.map((cls, i) => `${cls}: ${(maxScorePerClassPersistent[i] * 100).toFixed(1)}%`).join(', ');
      console.log('YOLO Max scores per class:', maxScoreInfo);
    }
  } else if (dims.length === 2) {
    // Format: [numBoxes, channels]
    const numBoxes = dims[0];
    const channels = dims[1];
    
    for (let i = 0; i < numBoxes; i++) {
      const offset = i * channels;
      const cx = output[offset + 0];
      const cy = output[offset + 1];
      const w = output[offset + 2];
      const h = output[offset + 3];
      
      // Extract class scores
      let classScores = [];
      for (let c = 0; c < numClasses; c++) {
        classScores.push(output[offset + 4 + c]);
      }

      // Get max class score
      let maxScore = 0;
      let maxClass = 0;
      for (let c = 0; c < numClasses; c++) {
        if (classScores[c] > maxScore) {
          maxScore = classScores[c];
          maxClass = c;
        }
      }

      if (maxScore >= CONFIG.YOLO.CONFIDENCE_THRESHOLD) {
        const scaleX = originalWidth / inputSize;
        const scaleY = originalHeight / inputSize;
        
        detections.push({
          class: CONFIG.YOLO.CLASSES[maxClass],
          confidence: maxScore,
          box: {
            x: (cx - w / 2) * scaleX,
            y: (cy - h / 2) * scaleY,
            width: w * scaleX,
            height: h * scaleY
          }
        });
      }
    }
  } else {
    console.warn('Unexpected dims length:', dims.length, dims);
    return [];
  }

  // Apply NMS
  return nonMaxSuppression(detections, CONFIG.YOLO.IOU_THRESHOLD);
}

function nonMaxSuppression(detections, iouThreshold) {
  if (detections.length === 0) return [];

  // Sort by confidence
  detections.sort((a, b) => b.confidence - a.confidence);

  const kept = [];
  const used = new Set();

  for (let i = 0; i < detections.length; i++) {
    if (used.has(i)) continue;

    kept.push(detections[i]);

    for (let j = i + 1; j < detections.length; j++) {
      if (used.has(j)) continue;
      if (detections[i].class !== detections[j].class) continue;

      const iou = calculateIoU(detections[i].box, detections[j].box);
      if (iou > iouThreshold) {
        used.add(j);
      }
    }
  }

  return kept;
}

function calculateIoU(box1, box2) {
  const x1 = Math.max(box1.x, box2.x);
  const y1 = Math.max(box1.y, box2.y);
  const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
  const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const area1 = box1.width * box1.height;
  const area2 = box2.width * box2.height;
  const union = area1 + area2 - intersection;

  return intersection / union;
}

// ============================================
// MESSAGE HANDLER
// ============================================
self.onmessage = async (e) => {
  const { type, payload } = e.data;

  if (type === 'INIT') {
    await initializeAI();
  } else if (type === 'PROCESS_FRAME') {
    await processFrame(payload);
  }
};

// Auto-initialize
initializeAI();
