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
  // Model: anticheat_yolo11s.onnx - YOLOv11s segmentation model (~40MB)
  // Output format: [1, 40, 8400] = 4 bbox + 4 classes + 32 mask coefficients
  YOLO: {
    MODEL_PATH: '/models/anticheat_yolo11s.onnx',
    INPUT_SIZE: 640, // Model was trained with 640x640 input
    // Confidence threshold - use higher threshold to reduce false positives
    CONFIDENCE_THRESHOLD: 0.6,
    IOU_THRESHOLD: 0.45,
    CLASSES: ['person', 'phone', 'material', 'headphones'], // Must match training classes
    // Only alert on phone, material, headphones - NOT person
    ALERT_CLASSES: ['phone', 'material', 'headphones'],
    MASK_COEFFICIENTS: 32, // For segmentation models
    // Multi-person detection via YOLO (backup to MediaPipe on main thread)
    MULTI_PERSON_ALERT: true,
    MULTI_PERSON_THRESHOLD: 0.6,
    // Model output format:
    // YOLOv8/v11 ONNX exports with default settings have sigmoid applied internally
    // If scores cluster around 0.5 with FORCE_SIGMOID=true, try false (double sigmoid issue)
    FORCE_SIGMOID: false,  // Try WITHOUT sigmoid first - YOLOv11 may have it built-in
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
const SCORE_ANALYSIS = {
  LOGIT_NEGATIVE_THRESHOLD: -0.1,  // Scores below this indicate raw logits
  LOGIT_POSITIVE_THRESHOLD: 1.5,    // Scores above this indicate raw logits
  CENTERED_MEAN_MIN: 0.4,           // Mean lower bound for "clustered at 0.5" check
  CENTERED_MEAN_MAX: 0.6,           // Mean upper bound for "clustered at 0.5" check
  NARROW_STDDEV: 0.1,               // StdDev threshold for narrow distribution
  NARROW_RANGE: 0.3,                // Max-min range threshold for narrow distribution
  LOW_BACKGROUND: 0.1,              // Scores below this are "background"
  HIGH_DETECTION: 0.7,              // Scores above this are "detections"
};

// Improved sigmoid detection: Check if scores look like raw logits or probabilities
// Raw logits characteristics:
// 1. Can be negative or > 1
// 2. Often clustered around 0 (sigmoid(0) = 0.5)
// 3. High variance for actual detections
// 
// Probability characteristics:
// 1. Always in [0, 1] range
// 2. Background boxes have scores near 0
// 3. Actual detections have scores near 1
function analyzeScoreDistribution(scores) {
  if (!scores || scores.length === 0) {
    return { needsSigmoid: true, reason: 'empty_scores' };  // Default to applying sigmoid
  }

  // Filter out invalid values
  const validScores = scores.filter(s => !isNaN(s) && isFinite(s));
  if (validScores.length === 0) {
    return { needsSigmoid: true, reason: 'no_valid_scores' };
  }

  // Calculate statistics
  const min = Math.min(...validScores);
  const max = Math.max(...validScores);
  const mean = validScores.reduce((a, b) => a + b, 0) / validScores.length;
  const variance = validScores.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / validScores.length;
  const stdDev = Math.sqrt(variance);

  // Check for obvious logit indicators
  const hasNegative = min < SCORE_ANALYSIS.LOGIT_NEGATIVE_THRESHOLD;
  const hasLargePositive = max > SCORE_ANALYSIS.LOGIT_POSITIVE_THRESHOLD;
  
  if (hasNegative || hasLargePositive) {
    return { 
      needsSigmoid: true, 
      reason: hasNegative ? 'has_negative_values' : 'has_values_gt_1',
      stats: { min, max, mean, stdDev }
    };
  }

  // Check for "clustered around 0.5" pattern (sigmoid(0) = 0.5)
  // If after sigmoid, everything is ~0.5, the raw values were ~0
  // This pattern: mean ≈ 0.5, low stdDev, and narrow range
  const isCentered = mean > SCORE_ANALYSIS.CENTERED_MEAN_MIN && mean < SCORE_ANALYSIS.CENTERED_MEAN_MAX;
  const isNarrow = stdDev < SCORE_ANALYSIS.NARROW_STDDEV && (max - min) < SCORE_ANALYSIS.NARROW_RANGE;
  
  if (isCentered && isNarrow) {
    // This is suspicious - likely already-sigmoidified logits near 0
    // which would indicate double sigmoid or incorrect data
    // Since this produces useless scores, assume we need sigmoid
    return {
      needsSigmoid: true,
      reason: 'scores_clustered_at_0.5_indicating_raw_logits_near_0',
      stats: { min, max, mean, stdDev }
    };
  }

  // If scores have a good distribution with clear background (near 0) 
  // and potential detections (higher values), these are likely probabilities
  const hasLowBackground = min < SCORE_ANALYSIS.LOW_BACKGROUND;
  const hasHighDetections = max > SCORE_ANALYSIS.HIGH_DETECTION;
  
  if (hasLowBackground && hasHighDetections) {
    return {
      needsSigmoid: false,
      reason: 'good_probability_distribution',
      stats: { min, max, mean, stdDev }
    };
  }

  // Default: apply sigmoid to be safe
  return {
    needsSigmoid: true,
    reason: 'uncertain_defaulting_to_sigmoid',
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

    // Log model details
    console.log('[YOLO Worker] Input names:', yoloSession.inputNames);
    console.log('[YOLO Worker] Output names:', yoloSession.outputNames);
    console.log('[YOLO Worker] Classes:', CONFIG.YOLO.CLASSES);
    console.log('[YOLO Worker] Confidence threshold:', CONFIG.YOLO.CONFIDENCE_THRESHOLD);
    console.log('[YOLO Worker] Force sigmoid:', CONFIG.YOLO.FORCE_SIGMOID);

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
      console.log('YOLO inference output:', {
        outputNames: yoloSession.outputNames,
        outputDims: outputTensor.dims,
        numElements: outputTensor.data.length
      });
      self.loggedOutputInfo = true;
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
