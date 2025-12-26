// AI Worker - YOLO Object Detection for Anti-Cheat
// This worker runs in a separate thread to avoid blocking the main UI
// 
// Features:
// - Object detection (phone, headphones, materials)
// - Person detection (for multi-person alerts)
// 
// NOTE: MediaPipe face detection runs on MAIN THREAD (see mediaPipeProctoring.js)
// because MediaPipe uses importScripts() which doesn't work in ES module workers.

// ONNX Runtime for YOLO model inference
import * as ort from 'onnxruntime-web';

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  // YOLO settings - Custom trained YOLOv11 model for anti-cheat detection
  // Model: lasttt.onnx - YOLOv11s segmentation model (~40MB)
  // Output format: [1, 40, 8400] = 4 bbox + 4 classes + 32 mask coefficients
  YOLO: {
    MODEL_PATH: '/models/lasttt.onnx',
    INPUT_SIZE: 640, // Model was trained with 640x640 input
    // Confidence threshold - matches Python test code (conf=0.4)
    // Production can use 0.5-0.6 for fewer false positives
    CONFIDENCE_THRESHOLD: 0.4,
    IOU_THRESHOLD: 0.45,
    CLASSES: ['person', 'phone', 'material', 'headphones'], // Must match training classes (from model metadata)
    // Only alert on phone, material, headphones - NOT person
    ALERT_CLASSES: ['phone', 'material', 'headphones'],
    MASK_COEFFICIENTS: 32, // For segmentation models
    // Multi-person detection via YOLO (backup to MediaPipe on main thread)
    MULTI_PERSON_ALERT: true,
    MULTI_PERSON_THRESHOLD: 0.5,
    // Model output format:
    // IMPORTANT: This YOLOv11-seg ONNX model outputs PROBABILITIES directly (0-1 range)
    // NOT raw logits! The model includes sigmoid activation in its output layer.
    // Setting FORCE_SIGMOID to false because applying sigmoid to probabilities
    // would compress all scores to ~50-66% range (sigmoid(0.66) ≈ 0.66)
    FORCE_SIGMOID: false,  // DO NOT apply sigmoid - model outputs probabilities directly
    // Letterbox padding color (gray 114/255 = 0.447, same as Ultralytics)
    LETTERBOX_COLOR: 114 / 255,
    // Processing settings
    THROTTLE_MS: 500,  // Run YOLO every 500ms for responsive detection
  }
};

// Sigmoid function to convert raw logits to probabilities
// YOLOv11 ONNX exports output RAW LOGITS for class scores, not probabilities
function sigmoid(x) {
  // Clamp to avoid overflow
  const clampedX = Math.max(-20, Math.min(20, x));
  return 1 / (1 + Math.exp(-clampedX));
}

// Score analysis thresholds for detecting if model outputs logits or probabilities
// These constants are used to auto-detect the model's output format
const SCORE_ANALYSIS = {
  // Floating point tolerance for probability bounds
  // Small negative values (-0.01) and small overflow (1.01) can occur due to 
  // float precision errors during inference. Values outside this range
  // definitively indicate raw logits rather than probabilities.
  LOGIT_NEGATIVE_THRESHOLD: -0.01,
  LOGIT_POSITIVE_THRESHOLD: 1.01,
  
  // Detection of "clustered at 0.5" pattern (indicates sigmoid already applied to ~0 logits)
  CENTERED_MEAN_MIN: 0.45,
  CENTERED_MEAN_MAX: 0.55,
  NARROW_STDDEV: 0.05,
  NARROW_RANGE: 0.15,
  
  // Probability distribution analysis
  LOW_BACKGROUND: 0.05,   // Background predictions should be near 0
  HIGH_DETECTION: 0.3,    // Valid detections should exceed this
};

// Input tensor validation thresholds
const INPUT_VALIDATION = {
  // Max expected value for normalized input (allow small float errors)
  MAX_VALUE: 1.1,
  // Min expected value (should not be negative after normalization)
  MIN_VALUE: -0.1,
  // Minimum ratio of non-letterbox pixels expected in a valid image
  MIN_IMAGE_RATIO: 0.1,
};

// Improved sigmoid detection: Check if scores look like raw logits or probabilities
// 
// This model (YOLOv11-seg ONNX) outputs PROBABILITIES in [0, 1] range.
// The analysis function helps detect the output format automatically.
//
// Raw logits characteristics:
// 1. Can be negative or > 1
// 2. Often clustered around 0 (sigmoid(0) = 0.5)
// 3. Large variance for actual detections
// 
// Probability characteristics:
// 1. Always in [0, 1] range
// 2. Background boxes have scores near 0
// 3. Actual detections have scores > 0.3
function analyzeScoreDistribution(scores) {
  if (!scores || scores.length === 0) {
    return { needsSigmoid: false, reason: 'empty_scores_using_config' };
  }

  // Filter out invalid values
  const validScores = scores.filter(s => !isNaN(s) && isFinite(s));
  if (validScores.length === 0) {
    return { needsSigmoid: false, reason: 'no_valid_scores_using_config' };
  }

  // Calculate statistics
  const min = Math.min(...validScores);
  const max = Math.max(...validScores);
  const mean = validScores.reduce((a, b) => a + b, 0) / validScores.length;
  const variance = validScores.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / validScores.length;
  const stdDev = Math.sqrt(variance);

  // KEY CHECK: If values are outside [0, 1], these are definitely raw logits
  const hasNegative = min < SCORE_ANALYSIS.LOGIT_NEGATIVE_THRESHOLD;
  const hasLargePositive = max > SCORE_ANALYSIS.LOGIT_POSITIVE_THRESHOLD;

  if (hasNegative || hasLargePositive) {
    return {
      needsSigmoid: true,
      reason: hasNegative ? 'has_negative_values' : 'has_values_gt_1',
      stats: { min, max, mean, stdDev }
    };
  }

  // Values are in [0, 1] range - likely probabilities
  // Check if they have a sensible distribution

  // If most values are near 0 (background) and some are higher (detections)
  // this is characteristic of probability output
  const nearZeroCount = validScores.filter(s => s < 0.1).length;
  const nearZeroRatio = nearZeroCount / validScores.length;

  if (nearZeroRatio > 0.8) {
    // Most scores are near 0 (background), some may be higher - this is probability output
    return {
      needsSigmoid: false,
      reason: 'probability_distribution_most_near_zero',
      stats: { min, max, mean, stdDev, nearZeroRatio }
    };
  }

  // Check for "clustered around 0.5" pattern
  // This happens when sigmoid is applied to logits that are all ~0
  // If we see this pattern, the model likely outputs raw logits
  const isCentered = mean > SCORE_ANALYSIS.CENTERED_MEAN_MIN && mean < SCORE_ANALYSIS.CENTERED_MEAN_MAX;
  const isNarrow = stdDev < SCORE_ANALYSIS.NARROW_STDDEV && (max - min) < SCORE_ANALYSIS.NARROW_RANGE;

  if (isCentered && isNarrow) {
    // All scores clustered around 0.5 - this suggests raw logits near 0
    return {
      needsSigmoid: true,
      reason: 'scores_clustered_at_0.5_indicating_raw_logits_near_0',
      stats: { min, max, mean, stdDev }
    };
  }

  // If we have good spread with some background (near 0) and some detections
  const hasBackground = min < SCORE_ANALYSIS.LOW_BACKGROUND;
  const hasDetections = max > SCORE_ANALYSIS.HIGH_DETECTION;

  if (hasBackground && hasDetections) {
    return {
      needsSigmoid: false,
      reason: 'good_probability_distribution',
      stats: { min, max, mean, stdDev }
    };
  }

  // Default: respect FORCE_SIGMOID config setting
  return {
    needsSigmoid: CONFIG.YOLO.FORCE_SIGMOID,
    reason: 'uncertain_using_config',
    stats: { min, max, mean, stdDev }
  };
}

// ============================================
// STATE
// ============================================
let yoloSession = null;
let lastAlertTime = 0;
// Per-class alert tracking to prevent one class blocking others
let lastAlertTimePerClass = {};
let lastYoloRunTime = 0;
let isInitialized = false;

// Track max scores per class for debugging (persistent across inference runs)
let maxScorePerClassPersistent = null;

// Multi-person alert cooldown
let multiPersonAlertTime = 0;

// ============================================
// INITIALIZATION - YOLO Only
// ============================================
async function initializeAI() {
  self.postMessage({ type: 'STATUS', payload: 'Đang tải YOLO model...', code: 'aiLoading' });

  // Helper that rejects on timeout
  const withTimeout = (promise, ms, name) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`${name} timeout after ${ms}ms`)), ms);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      clearTimeout(timeoutId);
    });
  };

  try {
    // Configure ONNX Runtime WASM paths - use CDN for better reliability
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/';

    // Disable SIMD and multi-threading for better browser compatibility
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = false;

    // Construct absolute URL for model
    const modelPath = CONFIG.YOLO.MODEL_PATH;
    const baseUrl = self.location.origin || '';
    const absoluteModelPath = modelPath.startsWith('/') ? baseUrl + modelPath : modelPath;
    const modelFilename = modelPath.split('/').pop();

    console.log('[YOLO Worker] Loading model from:', absoluteModelPath);

    // Try multiple paths
    const pathsToTry = [absoluteModelPath, modelPath, `./models/${modelFilename}`];
    let loadError = null;

    for (const tryPath of pathsToTry) {
      try {
        console.log('[YOLO Worker] Trying path:', tryPath);
        yoloSession = await withTimeout(
          ort.InferenceSession.create(tryPath, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'basic'
          }),
          45000,  // 45 second timeout for large model
          `YOLO model from ${tryPath}`
        );
        console.log('[YOLO Worker] ✅ Model loaded successfully from:', tryPath);
        loadError = null;
        break;
      } catch (err) {
        console.warn('[YOLO Worker] Failed to load from', tryPath, ':', err.message);
        loadError = err;
      }
    }

    if (loadError) {
      throw loadError;
    }

    // Log model details including metadata
    console.log('[YOLO Worker] Input names:', yoloSession.inputNames);
    console.log('[YOLO Worker] Output names:', yoloSession.outputNames);
    
    // Try to extract class names from ONNX metadata if available
    // Ultralytics ONNX exports include 'names' in metadata
    try {
      // ONNX Runtime Web doesn't expose metadata directly, but we can log what we have
      console.log('[YOLO Worker] Session handler:', yoloSession.handler ? 'available' : 'not available');
    } catch (metaErr) {
      console.log('[YOLO Worker] Could not read metadata:', metaErr.message);
    }
    
    console.log('[YOLO Worker] Configured classes:', CONFIG.YOLO.CLASSES);
    console.log('[YOLO Worker] Confidence threshold:', CONFIG.YOLO.CONFIDENCE_THRESHOLD);
    console.log('[YOLO Worker] Force sigmoid:', CONFIG.YOLO.FORCE_SIGMOID);
    console.log('[YOLO Worker] Alert classes:', CONFIG.YOLO.ALERT_CLASSES);

    isInitialized = true;
    self.postMessage({ type: 'STATUS', payload: 'YOLO object detection active', code: 'yoloOnly' });

  } catch (error) {
    console.error('[YOLO Worker] Initialization error:', error);
    self.postMessage({ type: 'STATUS', payload: 'YOLO unavailable - basic mode', code: 'basicMode' });
    isInitialized = true;  // Allow worker to still receive frames
  }
}

// ============================================
// FRAME PROCESSING - YOLO Only
// MediaPipe face detection runs on main thread (see mediaPipeProctoring.js)
// ============================================
async function processFrame(imageData) {
  if (!isInitialized) {
    return;
  }

  const now = Date.now();

  // Throttle YOLO detection to reduce CPU usage
  if (!yoloSession || (now - lastYoloRunTime < CONFIG.YOLO.THROTTLE_MS)) {
    return;
  }

  lastYoloRunTime = now;

  try {
    const detections = await runYoloInference(imageData);

    // Log detection count and max scores periodically (every 5 seconds for debugging)
    if (!self.lastDetectionLog || (now - self.lastDetectionLog > 5000)) {
      self.lastDetectionLog = now;
      console.log(`[YOLO] Running: ${detections.length} detections (threshold: ${CONFIG.YOLO.CONFIDENCE_THRESHOLD})`);

      // Log max scores per class to help debug
      if (maxScorePerClassPersistent) {
        const maxScoreInfo = CONFIG.YOLO.CLASSES.map((cls, i) => {
          const score = i < maxScorePerClassPersistent.length ? maxScorePerClassPersistent[i] : 0;
          return `${cls}: ${(score * 100).toFixed(1)}%`;
        }).join(', ');
        console.log(`[YOLO] Max scores: ${maxScoreInfo}`);
      }
    }

    // Log all alertable detections for debugging
    if (detections.length > 0) {
      const alertableDetections = detections.filter(d => CONFIG.YOLO.ALERT_CLASSES.includes(d.class));
      if (alertableDetections.length > 0) {
        console.log('[YOLO] Alert detections:', alertableDetections.map(d => `${d.class} (${(d.confidence * 100).toFixed(1)}%)`));
      }
    }

    // ============================================
    // MULTI-PERSON DETECTION (backup to MediaPipe on main thread)
    // ============================================
    if (CONFIG.YOLO.MULTI_PERSON_ALERT) {
      const multiPersonThreshold = CONFIG.YOLO.MULTI_PERSON_THRESHOLD || 0.5;
      const personDetections = detections.filter(d => d.class === 'person' && d.confidence > multiPersonThreshold);
      if (personDetections.length > 1 && now - multiPersonAlertTime > 10000) {
        self.postMessage({
          type: 'ALERT',
          payload: 'MULTI_PERSON',
          code: 'multiPerson',
          count: personDetections.length
        });
        multiPersonAlertTime = now;
        console.log('[YOLO] Multi-person detected:', personDetections.length, 'people');
      }
    }

    // ============================================
    // OBJECT DETECTION ALERTS (phone, headphones, material)
    // ============================================
    for (const detection of detections) {
      if (CONFIG.YOLO.ALERT_CLASSES.includes(detection.class)) {
        // Throttle alerts per class (max once per 8 seconds per class)
        const lastTimeForClass = lastAlertTimePerClass[detection.class] || 0;
        if (now - lastTimeForClass > 8000) {
          lastAlertTimePerClass[detection.class] = now;

          // Send detection alert
          self.postMessage({
            type: 'ALERT',
            payload: detection.class.toUpperCase() + '_DETECTED',
            code: detection.class + 'Detected',
            detectedClass: detection.class,
            confidence: detection.confidence
          });
          lastAlertTime = now;

          // Also update status to show detection
          self.postMessage({
            type: 'STATUS',
            payload: `Detected: ${detection.class} (${(detection.confidence * 100).toFixed(0)}%)`,
            code: 'detection',
            detectedClass: detection.class,
            confidence: detection.confidence
          });
        }
      }
    }
  } catch (error) {
    console.warn('[YOLO] Inference error:', error);
  }
}

// ============================================
// LETTERBOX PREPROCESSING (matches Ultralytics)
// ============================================

/**
 * Bilinear interpolation helper for high-quality image resizing.
 * This matches what Ultralytics/OpenCV uses internally (cv2.INTER_LINEAR).
 * 
 * @param {Uint8ClampedArray} data - RGBA pixel data from Canvas ImageData
 * @param {number} width - Source image width in pixels
 * @param {number} height - Source image height in pixels
 * @param {number} x - X coordinate in source image (can be fractional)
 * @param {number} y - Y coordinate in source image (can be fractional)
 * @returns {{r: number, g: number, b: number}} Interpolated RGB values (0-255)
 */
function bilinearInterpolate(data, width, height, x, y) {
  // Clamp coordinates to valid range
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  
  // Fractional parts for interpolation weights
  const xFrac = x - x0;
  const yFrac = y - y0;
  
  // Get pixel indices (RGBA format - 4 bytes per pixel)
  const idx00 = (y0 * width + x0) * 4;
  const idx10 = (y0 * width + x1) * 4;
  const idx01 = (y1 * width + x0) * 4;
  const idx11 = (y1 * width + x1) * 4;
  
  // Bilinear interpolation weights
  const w00 = (1 - xFrac) * (1 - yFrac);
  const w10 = xFrac * (1 - yFrac);
  const w01 = (1 - xFrac) * yFrac;
  const w11 = xFrac * yFrac;
  
  // Interpolate each channel (RGB)
  const r = data[idx00] * w00 + data[idx10] * w10 + data[idx01] * w01 + data[idx11] * w11;
  const g = data[idx00 + 1] * w00 + data[idx10 + 1] * w10 + data[idx01 + 1] * w01 + data[idx11 + 1] * w11;
  const b = data[idx00 + 2] * w00 + data[idx10 + 2] * w10 + data[idx01 + 2] * w01 + data[idx11 + 2] * w11;
  
  return { r, g, b };
}

/**
 * Preprocess image with letterbox padding (matching Ultralytics exactly)
 * 
 * Ultralytics letterbox process:
 * 1. Calculate scale to fit image while maintaining aspect ratio
 * 2. Resize image using bilinear interpolation
 * 3. Pad to target size with gray (114) color, centered
 * 4. Convert to RGB float32 in range [0, 1]
 * 5. Transpose to CHW format (Channel, Height, Width)
 * 
 * @returns {{ input: Float32Array, params: LetterboxParams }}
 */
function preprocessWithLetterbox(imageData) {
  const { width, height, data } = imageData;
  const inputSize = CONFIG.YOLO.INPUT_SIZE;
  const letterboxColor = CONFIG.YOLO.LETTERBOX_COLOR; // 114/255 ≈ 0.447

  // Step 1: Calculate scale to fit image while maintaining aspect ratio
  // This is the SAME formula as Ultralytics: min(new_shape / old_shape)
  const scale = Math.min(inputSize / width, inputSize / height);
  
  // New dimensions after scaling (keeping aspect ratio)
  const newW = Math.round(width * scale);
  const newH = Math.round(height * scale);

  // Padding to center the resized image (Ultralytics centers the image)
  // Using floor ensures pixel-perfect alignment with Ultralytics
  const padX = Math.floor((inputSize - newW) / 2);
  const padY = Math.floor((inputSize - newH) / 2);

  // Letterbox params for coordinate conversion later
  const params = { scale, padX, padY, newW, newH, origW: width, origH: height };

  // Log letterbox params once for debugging
  if (!self.loggedLetterbox) {
    console.log('[YOLO] Letterbox preprocessing params:');
    console.log(`   Original size: ${width}x${height}`);
    console.log(`   Target size: ${inputSize}x${inputSize}`);
    console.log(`   Scale factor: ${scale.toFixed(4)}`);
    console.log(`   Resized to: ${newW}x${newH}`);
    console.log(`   Padding: X=${padX}, Y=${padY}`);
    console.log(`   Letterbox color: ${letterboxColor.toFixed(4)} (114/255)`);
    self.loggedLetterbox = true;
  }

  // Step 2: Create output tensor filled with letterbox color (gray 114/255)
  // Format: CHW (Channel, Height, Width) - standard for YOLO
  const input = new Float32Array(3 * inputSize * inputSize);
  input.fill(letterboxColor);

  // Step 3: Resize and copy image with bilinear interpolation
  // We iterate over the destination (resized) coordinates and sample from source
  for (let dstY = 0; dstY < newH; dstY++) {
    for (let dstX = 0; dstX < newW; dstX++) {
      // Map destination coordinates back to source image coordinates
      // The +0.5 / -0.5 offset implements "pixel center" sampling:
      // - We map from the center of destination pixel to source space
      // - This matches Ultralytics/OpenCV's INTER_LINEAR behavior
      // - Without this offset, edge pixels would be slightly misaligned
      const srcX = (dstX + 0.5) / scale - 0.5;
      const srcY = (dstY + 0.5) / scale - 0.5;
      
      // Clamp to valid range
      const clampedSrcX = Math.max(0, Math.min(srcX, width - 1));
      const clampedSrcY = Math.max(0, Math.min(srcY, height - 1));
      
      // Get interpolated RGB values using bilinear interpolation
      const { r, g, b } = bilinearInterpolate(data, width, height, clampedSrcX, clampedSrcY);

      // Destination coordinates in letterboxed tensor (with padding offset)
      const tensorX = padX + dstX;
      const tensorY = padY + dstY;

      // Step 4: Normalize to [0, 1] and store in CHW format
      // Channel order: R, G, B (same as Ultralytics - NOT BGR)
      // Ultralytics uses RGB order for ONNX models
      const baseIdx = tensorY * inputSize + tensorX;
      input[0 * inputSize * inputSize + baseIdx] = r / 255.0;  // R channel
      input[1 * inputSize * inputSize + baseIdx] = g / 255.0;  // G channel
      input[2 * inputSize * inputSize + baseIdx] = b / 255.0;  // B channel
    }
  }

  // Debug: Log sample pixel values from center of image (once)
  if (!self.loggedPixelSample) {
    const centerX = Math.floor(inputSize / 2);
    const centerY = Math.floor(inputSize / 2);
    const idx = centerY * inputSize + centerX;
    console.log('[YOLO] Sample pixel at center (', centerX, ',', centerY, '):');
    console.log(`   R: ${input[0 * inputSize * inputSize + idx].toFixed(4)}`);
    console.log(`   G: ${input[1 * inputSize * inputSize + idx].toFixed(4)}`);
    console.log(`   B: ${input[2 * inputSize * inputSize + idx].toFixed(4)}`);
    self.loggedPixelSample = true;
  }

  return { input, params };
}

/**
 * Convert box coordinates from letterbox space to original image coordinates
 * @param {number} cx - Center X in letterbox space
 * @param {number} cy - Center Y in letterbox space  
 * @param {number} w - Width in letterbox space
 * @param {number} h - Height in letterbox space
 * @param {Object} params - Letterbox parameters {scale, padX, padY, origW, origH}
 * @returns {Object} Box in original image coordinates {x, y, width, height}
 */
function convertLetterboxToOriginalCoords(cx, cy, w, h, params) {
  const { scale, padX, padY, origW, origH } = params;
  
  // Remove letterbox padding and scale back to original size
  const x1 = (cx - w / 2 - padX) / scale;
  const y1 = (cy - h / 2 - padY) / scale;
  const x2 = (cx + w / 2 - padX) / scale;
  const y2 = (cy + h / 2 - padY) / scale;
  
  // Clamp to image bounds
  const boxX = Math.max(0, Math.min(x1, origW));
  const boxY = Math.max(0, Math.min(y1, origH));
  const boxW = Math.min(x2 - x1, origW - boxX);
  const boxH = Math.min(y2 - y1, origH - boxY);

  return {
    x: boxX,
    y: boxY,
    width: Math.max(0, boxW),
    height: Math.max(0, boxH)
  };
}

// ============================================
// YOLO INFERENCE
// ============================================
async function runYoloInference(imageData) {
  if (!yoloSession) return [];

  try {
    const { width, height } = imageData;
    const inputSize = CONFIG.YOLO.INPUT_SIZE;

    // Preprocess with letterbox (same as Ultralytics Python library)
    const { input, params: letterboxParams } = preprocessWithLetterbox(imageData);

    // Debug: Validate input tensor statistics (once)
    if (!self.loggedInputStats) {
      self.loggedInputStats = true;
      
      // Calculate min, max, mean of input tensor
      let minVal = Infinity, maxVal = -Infinity, sum = 0;
      let nonZeroCount = 0;
      const letterboxColorApprox = 0.447; // 114/255
      
      for (let i = 0; i < input.length; i++) {
        if (input[i] < minVal) minVal = input[i];
        if (input[i] > maxVal) maxVal = input[i];
        sum += input[i];
        // Count non-letterbox pixels (approximately)
        if (Math.abs(input[i] - letterboxColorApprox) > 0.01) {
          nonZeroCount++;
        }
      }
      const mean = sum / input.length;
      
      console.log('[YOLO] Input tensor statistics:');
      console.log(`   Shape: [1, 3, ${inputSize}, ${inputSize}]`);
      console.log(`   Min: ${minVal.toFixed(4)}, Max: ${maxVal.toFixed(4)}, Mean: ${mean.toFixed(4)}`);
      console.log(`   Non-letterbox pixels: ${nonZeroCount} / ${input.length} (${(nonZeroCount/input.length*100).toFixed(1)}%)`);
      console.log(`   Expected: Min≈0, Max≤1, Mean≈0.3-0.5 for typical webcam image`);
      
      // Warn if input looks wrong (using validation thresholds)
      if (maxVal > INPUT_VALIDATION.MAX_VALUE) {
        console.warn('[YOLO] ⚠️ Input values > 1 detected! Image may not be normalized correctly');
      }
      if (minVal < INPUT_VALIDATION.MIN_VALUE) {
        console.warn('[YOLO] ⚠️ Negative input values detected! Check preprocessing');
      }
      if (nonZeroCount < input.length * INPUT_VALIDATION.MIN_IMAGE_RATIO) {
        console.warn('[YOLO] ⚠️ Very few non-letterbox pixels! Image may be mostly padding');
      }
    }

    // Create tensor with dynamic input name
    const tensor = new ort.Tensor('float32', input, [1, 3, inputSize, inputSize]);
    const inputName = yoloSession.inputNames[0] || 'images';
    const feeds = { [inputName]: tensor };

    const results = await yoloSession.run(feeds);

    // For segmentation models, there may be 2 outputs:
    // output0: detection tensor (1, 40, 8400) for seg or (1, 8, 8400) for detect
    // output1: mask tensor (1, 32, 160, 160) for seg only
    // We only need output0 for detection
    const outputName = yoloSession.outputNames[0] || 'output0';
    const outputTensor = results[outputName];

    if (!outputTensor) {
      console.warn('No output tensor found');
      return [];
    }

    // Log output info once for debugging
    if (!self.loggedOutputInfo) {
      console.log('[YOLO] Inference output:', {
        outputNames: yoloSession.outputNames,
        outputDims: outputTensor.dims,
        numElements: outputTensor.data.length
      });
      
      // Also check output statistics to understand model behavior
      let outMin = Infinity, outMax = -Infinity;
      for (let i = 0; i < Math.min(10000, outputTensor.data.length); i++) {
        const v = outputTensor.data[i];
        if (v < outMin) outMin = v;
        if (v > outMax) outMax = v;
      }
      console.log(`[YOLO] Output range (first 10000 values): Min=${outMin.toFixed(4)}, Max=${outMax.toFixed(4)}`);
      
      self.loggedOutputInfo = true;
    }

    const detections = parseYoloOutput(outputTensor.data, outputTensor.dims, letterboxParams);
    return detections;
  } catch (error) {
    console.error('[YOLO] Inference error:', error);
    return [];
  }
}

function parseYoloOutput(output, dims, letterboxParams) {
  const detections = [];
  const numClasses = CONFIG.YOLO.CLASSES.length;
  const inputSize = CONFIG.YOLO.INPUT_SIZE;
  const maskCoefficients = CONFIG.YOLO.MASK_COEFFICIENTS;

  // Log output dimensions for debugging (only first time)
  if (!self.loggedDims) {
    console.log('🔍 YOLO Output dimensions:', dims);
    console.log('   Expected classes:', numClasses, '(' + CONFIG.YOLO.CLASSES.join(', ') + ')');
    console.log('   Expected detect channels:', 4 + numClasses);
    console.log('   Expected seg channels:', 4 + numClasses + maskCoefficients);
    self.loggedDims = true;
  }

  // Initialize persistent max score tracking if not done
  if (!maxScorePerClassPersistent) {
    maxScorePerClassPersistent = new Array(numClasses).fill(0);
  }

  // Detect if model outputs raw logits or probabilities
  // Use FORCE_SIGMOID config option or analyze scores
  let applySigmoid = CONFIG.YOLO.FORCE_SIGMOID;

  if (!self.sigmoidDetected) {
    // Sample some class scores from different positions
    // Only sample valid positions within the output tensor
    const sampleScores = [];

    // Get number of boxes from output dimensions
    let numBoxes = 0;
    if (dims.length === 3) {
      const dim1 = dims[1];
      const dim2 = dims[2];
      numBoxes = dim1 < dim2 ? dim2 : dim1;
    } else if (dims.length === 2) {
      numBoxes = dims[0];
    }

    // Sample positions must be within valid range (0 to numBoxes-1)
    const samplePositions = [0, 100, 500, 1000, 2000, 4000]
      .filter(pos => pos < numBoxes);

    if (dims.length === 3) {
      const dim1 = dims[1];
      const dim2 = dims[2];
      const isTransposed = dim1 < dim2 && dim1 <= 100;

      for (const pos of samplePositions) {
        if (isTransposed) {
          // Transposed: class scores at channels 4-7, each channel has dim2 values
          for (let c = 0; c < numClasses; c++) {
            const idx = (4 + c) * dim2 + pos;
            if (idx < output.length) {
              sampleScores.push(output[idx]);
            }
          }
        } else {
          // Standard: data is [box0, box1, ...], each box has `channels` values
          // Class scores start at offset 4 within each box
          const channels = dim2;
          const offset = pos * channels;
          for (let c = 0; c < numClasses; c++) {
            const idx = offset + 4 + c;
            if (idx < output.length) {
              sampleScores.push(output[idx]);
            }
          }
        }
      }
    } else if (dims.length === 2) {
      // 2D format: [numBoxes, channels]
      const channels = dims[1];
      for (const pos of samplePositions) {
        const offset = pos * channels;
        for (let c = 0; c < numClasses; c++) {
          const idx = offset + 4 + c;
          if (idx < output.length) {
            sampleScores.push(output[idx]);
          }
        }
      }
    }

    // Use improved score distribution analysis
    const analysis = analyzeScoreDistribution(sampleScores);

    // Override with forced sigmoid if configured
    applySigmoid = CONFIG.YOLO.FORCE_SIGMOID || analysis.needsSigmoid;
    self.applySigmoid = applySigmoid;
    self.sigmoidDetected = true;

    console.log('📊 Score analysis:', {
      sampleScores: sampleScores.slice(0, 12).map(s => s?.toFixed(4) || 'N/A'),
      forceSigmoid: CONFIG.YOLO.FORCE_SIGMOID,
      analysisResult: analysis.needsSigmoid,
      reason: analysis.reason,
      stats: analysis.stats,
      applySigmoid: applySigmoid,
      interpretation: applySigmoid ? 'Will apply sigmoid to class scores' : 'Using raw scores as probabilities'
    });
  } else {
    applySigmoid = self.applySigmoid;
  }

  // Handle different output formats
  // YOLO11 segmentation outputs: [1, 40, 8400] = 4 bbox + 4 classes + 32 mask coefficients

  if (dims.length === 3) {
    // Format: [1, channels, numBoxes] or [1, numBoxes, channels]
    const dim1 = dims[1];
    const dim2 = dims[2];

    const expectedDetect = 4 + numClasses; // 8 for 4 classes
    const expectedSeg = 4 + numClasses + maskCoefficients; // 40 for 4 classes + 32 mask

    // Log format determination (only first time)
    if (!self.loggedFormat) {
      console.log('   Actual dims: [1,', dim1, ',', dim2, ']');
      console.log('   Determining format...');
      self.loggedFormat = true;
    }

    // Determine format based on dimensions
    let isTransposed = false;
    let channels, numBoxes;

    // For segmentation model output [1, 40, 8400], dim1=40 matches expectedSeg
    if (dim1 === expectedDetect || dim1 === expectedSeg) {
      // Format: [1, channels, numBoxes] - transposed format (common for YOLO)
      isTransposed = true;
      channels = dim1;
      numBoxes = dim2;
      if (!self.loggedFormatResult) {
        console.log('   ✅ Detected transposed format: [1, channels, numBoxes]');
        console.log('   Channels:', channels, 'NumBoxes:', numBoxes);
        self.loggedFormatResult = true;
      }
    } else if (dim2 === expectedDetect || dim2 === expectedSeg) {
      // Format: [1, numBoxes, channels] - standard format
      isTransposed = false;
      channels = dim2;
      numBoxes = dim1;
      if (!self.loggedFormatResult) {
        console.log('   ✅ Detected standard format: [1, numBoxes, channels]');
        self.loggedFormatResult = true;
      }
    } else {
      // Try to infer from size ratio - smaller dimension is likely channels
      if (dim1 < dim2 && dim1 <= 100) {
        isTransposed = true;
        channels = dim1;
        numBoxes = dim2;
        if (!self.loggedFormatResult) {
          console.log('   ⚠️ Inferred transposed format from size ratio');
          console.log('   Channels:', channels, 'NumBoxes:', numBoxes);
          self.loggedFormatResult = true;
        }
      } else if (dim2 < dim1 && dim2 <= 100) {
        isTransposed = false;
        channels = dim2;
        numBoxes = dim1;
        if (!self.loggedFormatResult) {
          console.log('   ⚠️ Inferred standard format from size ratio');
          self.loggedFormatResult = true;
        }
      } else {
        console.warn(`❌ Cannot determine YOLO format. Dims: [1, ${dim1}, ${dim2}]`);
        console.warn(`   Expected detect channels: ${expectedDetect}, seg channels: ${expectedSeg}`);
        return [];
      }
    }

    // Enhanced diagnostic: Log raw output values once to understand model format
    if (!self.loggedRawOutput) {
      self.loggedRawOutput = true;
      console.log('[YOLO] 🔬 Raw output analysis for first 3 predictions:');
      for (let i = 0; i < Math.min(3, numBoxes); i++) {
        const values = [];
        for (let c = 0; c < Math.min(channels, 12); c++) {
          if (isTransposed) {
            values.push(output[c * numBoxes + i]);
          } else {
            values.push(output[i * channels + c]);
          }
        }
        console.log(`   Pred[${i}]: [${values.map(v => v?.toFixed(3) || 'N/A').join(', ')}]`);
      }
      console.log(`   Format: ${isTransposed ? 'transposed [channels, boxes]' : 'standard [boxes, channels]'}`);
      console.log(`   Total values: ${output.length}, Channels: ${channels}, Boxes: ${numBoxes}`);
    }

    // Sample first few detections for debugging
    let sampleLogged = false;

    for (let i = 0; i < numBoxes; i++) {
      let cx, cy, w, h;
      let classScores = [];

      if (isTransposed) {
        // Transposed format: data is arranged [cx0, cx1, ..., cxN, cy0, cy1, ..., cyN, ...]
        // For [1, 40, 8400], each channel has 8400 values
        cx = output[0 * numBoxes + i];
        cy = output[1 * numBoxes + i];
        w = output[2 * numBoxes + i];
        h = output[3 * numBoxes + i];

        // Extract class scores (indices 4, 5, 6, 7 for 4 classes)
        // Only apply sigmoid if the model outputs raw logits (not probabilities)
        for (let c = 0; c < numClasses; c++) {
          const rawValue = output[(4 + c) * numBoxes + i];
          classScores.push(applySigmoid ? sigmoid(rawValue) : rawValue);
        }
      } else {
        // Standard format: data is arranged [box0_cx, box0_cy, box0_w, box0_h, box0_class0, ..., box1_cx, ...]
        const offset = i * channels;
        cx = output[offset + 0];
        cy = output[offset + 1];
        w = output[offset + 2];
        h = output[offset + 3];

        // Extract class scores - only apply sigmoid if needed
        for (let c = 0; c < numClasses; c++) {
          const rawValue = output[offset + 4 + c];
          classScores.push(applySigmoid ? sigmoid(rawValue) : rawValue);
        }
      }

      // Debug logging for first detection with highest scores
      if (!sampleLogged && i < 5) {
        const maxS = Math.max(...classScores);
        if (maxS > 0.001) {
          console.log(`   Box[${i}]: cx=${cx.toFixed(1)}, cy=${cy.toFixed(1)}, w=${w.toFixed(1)}, h=${h.toFixed(1)}, scores=[${classScores.map(s => (s * 100).toFixed(1) + '%').join(', ')}]`);
          sampleLogged = true;
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
        // Track max per class for debugging (persistent) with bounds check
        if (maxScorePerClassPersistent && c < maxScorePerClassPersistent.length &&
          classScores[c] > maxScorePerClassPersistent[c]) {
          maxScorePerClassPersistent[c] = classScores[c];
        }
      }

      if (maxScore >= CONFIG.YOLO.CONFIDENCE_THRESHOLD) {
        // Convert from letterbox coordinates back to original image coordinates
        const box = convertLetterboxToOriginalCoords(cx, cy, w, h, letterboxParams);

        detections.push({
          class: CONFIG.YOLO.CLASSES[maxClass],
          confidence: maxScore,
          box
        });
      }
    }

    // Log max scores per class periodically for debugging (every 10 seconds)
    if (maxScorePerClassPersistent && (!self.lastMaxScoreLog || (Date.now() - self.lastMaxScoreLog > 10000))) {
      self.lastMaxScoreLog = Date.now();
      const maxScoreInfo = CONFIG.YOLO.CLASSES.map((cls, i) => {
        const score = i < maxScorePerClassPersistent.length ? maxScorePerClassPersistent[i] : 0;
        return `${cls}: ${(score * 100).toFixed(2)}%`;
      }).join(', ');
      console.log('📊 YOLO Max scores per class:', maxScoreInfo);
      if (detections.length > 0) {
        console.log('   Detections found:', detections.length);
      }
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

      // Extract class scores - only apply sigmoid if needed
      let classScores = [];
      for (let c = 0; c < numClasses; c++) {
        const rawValue = output[offset + 4 + c];
        classScores.push(applySigmoid ? sigmoid(rawValue) : rawValue);
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
        // Convert from letterbox coordinates back to original image coordinates
        const box = convertLetterboxToOriginalCoords(cx, cy, w, h, letterboxParams);

        detections.push({
          class: CONFIG.YOLO.CLASSES[maxClass],
          confidence: maxScore,
          box
        });
      }
    }
  } else {
    console.warn('❌ Unexpected dims length:', dims.length, dims);
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
