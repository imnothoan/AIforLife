// AI Worker - Classic Script Mode (uses importScripts for CDN dependencies)
// This worker runs in a separate thread to avoid blocking the main UI
// 
// Features:
// - YOLO Object detection (phone, headphones, materials)
// - Face detection and head pose estimation (MediaPipe)
// - Eye gaze tracking
// - Multi-person detection

// ============================================
// LOAD DEPENDENCIES VIA importScripts
// ============================================
try {
    // Load ONNX Runtime Web from CDN
    importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/ort.min.js');
    console.log('✅ ONNX Runtime loaded successfully');
} catch (e) {
    console.error('Failed to load ONNX Runtime:', e);
}

// Note: MediaPipe tasks-vision doesn't work well with importScripts in workers
// We'll handle face detection in the main thread (FaceVerification component)
// This worker focuses on YOLO object detection only

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    // YOLO settings - Custom trained SEGMENTATION model for anti-cheat detection
    YOLO: {
        MODEL_PATH: '/models/anticheat_yolo11s.onnx',
        INPUT_SIZE: 640,
        // Confidence threshold - set to 0.6 to filter out ~50% noise
        CONFIDENCE_THRESHOLD: 0.6,
        IOU_THRESHOLD: 0.45,
        CLASSES: ['person', 'phone', 'material', 'headphones'],
        ALERT_CLASSES: ['phone', 'material', 'headphones'],
        MASK_COEFFICIENTS: 32,
        MULTI_PERSON_ALERT: false, // Disabled due to model quality issues
        MULTI_PERSON_THRESHOLD: 0.7,
    },
};

// Sigmoid function to convert raw logits to probabilities
function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
}

// ============================================
// STATE
// ============================================
let yoloSession = null;
let lastAlertTime = 0;
let lastAlertTimePerClass = {};
let lastYoloRunTime = 0;
let isInitialized = false;
let maxScorePerClassPersistent = null;

const YOLO_THROTTLE_MS = 500;

// ============================================
// INITIALIZATION
// ============================================
async function initializeAI() {
    self.postMessage({ type: 'STATUS', payload: 'Đang tải YOLO model...', code: 'yoloLoading' });

    try {
        // Configure ONNX Runtime WASM paths
        if (typeof ort !== 'undefined') {
            ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/';
            ort.env.wasm.numThreads = 1;
            ort.env.wasm.simd = false;

            const modelPath = CONFIG.YOLO.MODEL_PATH;
            const baseUrl = self.location.origin || '';
            const absoluteModelPath = modelPath.startsWith('/') ? baseUrl + modelPath : modelPath;

            console.log('Attempting to load YOLO model from:', absoluteModelPath);

            const pathsToTry = [absoluteModelPath, modelPath, `./models/anticheat_yolo11s.onnx`];

            for (const tryPath of pathsToTry) {
                try {
                    console.log('Trying to load from:', tryPath);
                    yoloSession = await ort.InferenceSession.create(tryPath, {
                        executionProviders: ['wasm'],
                        graphOptimizationLevel: 'basic'
                    });
                    console.log('✅ Successfully loaded from:', tryPath);
                    console.log('✅ YOLO model loaded successfully!');
                    console.log('Input names:', yoloSession.inputNames);
                    console.log('Output names:', yoloSession.outputNames);
                    console.log('Confidence threshold:', CONFIG.YOLO.CONFIDENCE_THRESHOLD);
                    break;
                } catch (err) {
                    console.warn('Failed to load from', tryPath, ':', err.message);
                }
            }
        } else {
            console.error('ONNX Runtime not loaded!');
        }
    } catch (error) {
        console.warn('YOLO model not available:', error.message);
    }

    isInitialized = true;

    if (yoloSession) {
        self.postMessage({ type: 'STATUS', payload: 'YOLO object detection ready', code: 'yoloReady' });
        self.postMessage({ type: 'READY', payload: 'YOLO ready', code: 'ready' });
    } else {
        self.postMessage({ type: 'STATUS', payload: 'AI monitoring (basic mode)', code: 'basicMode' });
        self.postMessage({ type: 'READY', payload: 'Basic mode', code: 'ready' });
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
        const inputTensor = new Float32Array(3 * inputSize * inputSize);

        // Calculate scaling to maintain aspect ratio
        const scale = Math.min(inputSize / width, inputSize / height);
        const newWidth = Math.round(width * scale);
        const newHeight = Math.round(height * scale);
        const offsetX = Math.floor((inputSize - newWidth) / 2);
        const offsetY = Math.floor((inputSize - newHeight) / 2);

        // Fill with gray (letterboxing)
        inputTensor.fill(0.5);

        // Copy and normalize pixel data
        for (let y = 0; y < newHeight; y++) {
            for (let x = 0; x < newWidth; x++) {
                const srcX = Math.floor(x / scale);
                const srcY = Math.floor(y / scale);
                const srcIdx = (srcY * width + srcX) * 4;

                const dstX = x + offsetX;
                const dstY = y + offsetY;

                if (srcX < width && srcY < height && dstX < inputSize && dstY < inputSize) {
                    inputTensor[0 * inputSize * inputSize + dstY * inputSize + dstX] = data[srcIdx] / 255;
                    inputTensor[1 * inputSize * inputSize + dstY * inputSize + dstX] = data[srcIdx + 1] / 255;
                    inputTensor[2 * inputSize * inputSize + dstY * inputSize + dstX] = data[srcIdx + 2] / 255;
                }
            }
        }

        // Run inference
        const tensor = new ort.Tensor('float32', inputTensor, [1, 3, inputSize, inputSize]);
        const results = await yoloSession.run({ [yoloSession.inputNames[0]]: tensor });

        // Parse output
        const output = results[yoloSession.outputNames[0]];
        const outputData = output.data;
        const dims = output.dims;

        // Expected format: [1, 40, 8400] for segmentation model
        // 40 = 4 (bbox) + 4 (classes) + 32 (mask coefficients)
        const numClasses = CONFIG.YOLO.CLASSES.length;
        const numChannels = dims[1];
        const numBoxes = dims[2];

        const detections = [];
        const threshold = CONFIG.YOLO.CONFIDENCE_THRESHOLD;

        // Track max scores per class for debugging
        const maxScorePerClass = new Array(numClasses).fill(0);

        for (let boxIdx = 0; boxIdx < numBoxes; boxIdx++) {
            // Extract class scores (channels 4-7 for 4 classes)
            const classScores = [];
            for (let c = 0; c < numClasses; c++) {
                const rawScore = outputData[(4 + c) * numBoxes + boxIdx];
                const score = sigmoid(rawScore);
                classScores.push(score);
                if (score > maxScorePerClass[c]) {
                    maxScorePerClass[c] = score;
                }
            }

            // Find best class
            const maxScore = Math.max(...classScores);
            const maxClassIdx = classScores.indexOf(maxScore);

            if (maxScore > threshold) {
                const cx = outputData[0 * numBoxes + boxIdx];
                const cy = outputData[1 * numBoxes + boxIdx];
                const w = outputData[2 * numBoxes + boxIdx];
                const h = outputData[3 * numBoxes + boxIdx];

                detections.push({
                    class: CONFIG.YOLO.CLASSES[maxClassIdx],
                    confidence: maxScore,
                    box: { cx, cy, w, h }
                });
            }
        }

        // Update persistent max scores
        maxScorePerClassPersistent = maxScorePerClass;

        return detections;
    } catch (error) {
        console.warn('YOLO inference error:', error);
        return [];
    }
}

// ============================================
// FRAME PROCESSING
// ============================================
async function processFrame(imageData) {
    if (!isInitialized) {
        await initializeAI();
    }

    const now = Date.now();

    // Debug log YOLO status
    if (!self.lastYoloStatusLog || (now - self.lastYoloStatusLog > 5000)) {
        self.lastYoloStatusLog = now;
        console.log(`🔧 YOLO Debug: session=${!!yoloSession}, timeSinceLastRun=${now - lastYoloRunTime}ms, throttle=${YOLO_THROTTLE_MS}ms`);
    }

    // Run YOLO detection (throttled)
    if (yoloSession && (now - lastYoloRunTime >= YOLO_THROTTLE_MS)) {
        lastYoloRunTime = now;

        try {
            const detections = await runYoloInference(imageData);

            // Log detection info (every 3 seconds)
            if (!self.lastDetectionLog || (now - self.lastDetectionLog > 3000)) {
                self.lastDetectionLog = now;
                console.log(`🔍 YOLO running: ${detections.length} detections (threshold: ${CONFIG.YOLO.CONFIDENCE_THRESHOLD})`);

                if (maxScorePerClassPersistent) {
                    const maxScoreInfo = CONFIG.YOLO.CLASSES.map((cls, i) => {
                        const score = i < maxScorePerClassPersistent.length ? maxScorePerClassPersistent[i] : 0;
                        return `${cls}: ${(score * 100).toFixed(1)}%`;
                    }).join(', ');
                    console.log(`📊 Max scores seen: ${maxScoreInfo}`);
                }
            }

            // Log alertable detections
            if (detections.length > 0) {
                const alertableDetections = detections.filter(d => CONFIG.YOLO.ALERT_CLASSES.includes(d.class));
                if (alertableDetections.length > 0) {
                    console.log('🚨 YOLO Alert Detections:', alertableDetections.map(d => `${d.class} (${(d.confidence * 100).toFixed(1)}%)`));
                }
            }

            // Send alerts for detected objects
            for (const detection of detections) {
                if (CONFIG.YOLO.ALERT_CLASSES.includes(detection.class)) {
                    const lastTimeForClass = lastAlertTimePerClass[detection.class] || 0;
                    if (now - lastTimeForClass > 8000) {
                        lastAlertTimePerClass[detection.class] = now;

                        self.postMessage({
                            type: 'ALERT',
                            payload: detection.class.toUpperCase() + '_DETECTED',
                            code: detection.class + 'Detected',
                            detectedClass: detection.class,
                            confidence: detection.confidence
                        });

                        self.postMessage({
                            type: 'STATUS',
                            payload: `DETECTION_${detection.class.toUpperCase()}`,
                            code: 'detection',
                            detectedClass: detection.class,
                            confidence: detection.confidence
                        });
                    }
                }
            }
        } catch (error) {
            console.warn('YOLO processing error:', error);
        }
    }

    // Periodically update monitoring status
    if (Math.random() < 0.01) {
        self.postMessage({ type: 'STATUS', payload: 'MONITORING', code: 'monitoring' });
    }
}

// ============================================
// MESSAGE HANDLER
// ============================================
self.onmessage = async (e) => {
    const { type, imageData } = e.data;

    switch (type) {
        case 'INIT':
            if (!isInitialized) {
                await initializeAI();
            }
            break;

        case 'PROCESS_FRAME':
            if (imageData) {
                await processFrame(imageData);
            }
            break;

        case 'TERMINATE':
            yoloSession = null;
            isInitialized = false;
            self.postMessage({ type: 'TERMINATED' });
            break;
    }
};

// Auto-initialize when worker loads
initializeAI();
