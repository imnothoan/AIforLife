// AI Worker - Implements the Cascade Strategy (MediaPipe Face Mesh → YOLO)
// This worker runs in a separate thread to avoid blocking the main UI

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
  },
  // YOLO settings
  YOLO: {
    MODEL_PATH: '/models/anticheat_yolo11s.onnx',
    INPUT_SIZE: 640,
    CONFIDENCE_THRESHOLD: 0.4,
    IOU_THRESHOLD: 0.45,
    CLASSES: ['person', 'phone', 'material', 'headphones'],
    ALERT_CLASSES: ['phone', 'material', 'headphones'], // Classes that trigger alerts
  },
  // Cascade timing
  CASCADE: {
    YOLO_ACTIVATION_SECONDS: 3, // Activate YOLO for N seconds after suspicious activity
  }
};

// ============================================
// STATE
// ============================================
let faceLandmarker = null;
let yoloSession = null;
let yoloActiveUntil = 0;
let suspiciousFrameCount = 0;
let lastAlertTime = 0;
let isInitialized = false;

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

    self.postMessage({ type: 'STATUS', payload: 'Đang tải YOLO...' });

    // Load YOLO ONNX model
    try {
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
      yoloSession = await ort.InferenceSession.create(CONFIG.YOLO.MODEL_PATH, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      });
      self.postMessage({ type: 'STATUS', payload: 'Hệ thống giám sát đã sẵn sàng.' });
    } catch (yoloError) {
      console.warn('YOLO model not available, using face detection only:', yoloError);
      self.postMessage({ type: 'STATUS', payload: 'Giám sát khuôn mặt đang hoạt động.' });
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
  // STAGE 1: FACE MESH DETECTION
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
          // Check for looking away
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
      }
    } catch (error) {
      console.warn('Face detection error:', error);
    }
  }

  // ============================================
  // STAGE 2: YOLO DETECTION (Cascade Trigger)
  // ============================================
  if (isSuspicious && yoloSession) {
    // Activate YOLO for the next few seconds
    yoloActiveUntil = now + CONFIG.CASCADE.YOLO_ACTIVATION_SECONDS * 1000;
  }

  if (yoloSession && now < yoloActiveUntil) {
    try {
      const detections = await runYoloInference(imageData);
      
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

    // Create tensor and run inference
    const tensor = new ort.Tensor('float32', input, [1, 3, inputSize, inputSize]);
    const results = await yoloSession.run({ images: tensor });

    // Parse YOLO output
    const output = results.output0?.data || results[Object.keys(results)[0]]?.data;
    if (!output) return [];

    const detections = parseYoloOutput(output, width, height);
    return detections;
  } catch (error) {
    console.error('YOLO inference error:', error);
    return [];
  }
}

function parseYoloOutput(output, originalWidth, originalHeight) {
  const detections = [];
  const numClasses = CONFIG.YOLO.CLASSES.length;
  const inputSize = CONFIG.YOLO.INPUT_SIZE;

  // YOLO output format: [batch, num_boxes, 4 + num_classes]
  // Or for segmentation: [batch, 4 + num_classes + mask_channels, num_boxes]
  
  // Assuming output shape [1, numBoxes, 4 + numClasses]
  const numBoxes = output.length / (4 + numClasses);
  
  for (let i = 0; i < numBoxes; i++) {
    const baseIdx = i * (4 + numClasses);
    
    // Get box coordinates
    const cx = output[baseIdx];
    const cy = output[baseIdx + 1];
    const w = output[baseIdx + 2];
    const h = output[baseIdx + 3];

    // Get class scores
    let maxScore = 0;
    let maxClass = 0;
    for (let c = 0; c < numClasses; c++) {
      const score = output[baseIdx + 4 + c];
      if (score > maxScore) {
        maxScore = score;
        maxClass = c;
      }
    }

    if (maxScore >= CONFIG.YOLO.CONFIDENCE_THRESHOLD) {
      detections.push({
        class: CONFIG.YOLO.CLASSES[maxClass],
        confidence: maxScore,
        box: {
          x: (cx - w / 2) * originalWidth / inputSize,
          y: (cy - h / 2) * originalHeight / inputSize,
          width: w * originalWidth / inputSize,
          height: h * originalHeight / inputSize
        }
      });
    }
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
