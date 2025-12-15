# YOLO Segmentation Anti-Cheat Model Training

This folder contains scripts for fine-tuning the YOLO **segmentation** model used for AI proctoring in SmartExamPro.

## ⚠️ Important: Segmentation Model

The anti-cheat system uses a **YOLO Segmentation model** (yolo11s-seg), NOT a detection model. 
The training scripts automatically convert bounding box labels to segmentation polygon format.

If you get this error:
```
TypeError: ERROR ❌ segment dataset incorrectly formatted or not a segment dataset.
```

This means the labels are in detection format (5 values: class x_center y_center width height) 
instead of segmentation format (class followed by polygon coordinates). 
The updated scripts now handle this conversion automatically.

## Current Model Status

The existing model (`Intelligence-Test/public/models/anticheat_yolo11s.onnx`) has the following detection performance:

| Class | Max Confidence | Status |
|-------|---------------|--------|
| Person | ~5% | ⚠️ Needs improvement |
| Phone | <1% | ❌ Needs training |
| Material/Paper | <1% | ❌ Needs training |
| Headphones | 44% | ✅ Good |

## How to Fine-tune the Model

### Option 1: Google Colab (Recommended)

1. Open `finetune_yolo_colab.ipynb` in Google Colab
2. Enable GPU runtime (Runtime > Change runtime type > GPU)
3. Upload your `best.pt` model to Google Drive
4. Run all cells in order
5. Download the new `best.onnx` file when done
6. Copy to `Intelligence-Test/public/models/anticheat_yolo11s.onnx`

### Option 2: Local Training

Requirements:
- Python 3.8+
- NVIDIA GPU with CUDA support
- 8GB+ GPU memory

```bash
# Install dependencies
pip install ultralytics onnx onnxruntime

# Run fine-tuning
python finetune_yolo_anticheat.py \
  --base-model /path/to/best.pt \
  --output-dir ./training_output
```

## Datasets Used

The training script downloads these datasets from Roboflow:

- **Phone Detection**: 2 datasets focused on mobile phones
- **Paper/Material Detection**: 2 datasets for documents and papers
- **Headphones Detection**: 2 datasets for headphones and earbuds
- **Person Detection**: 1 dataset for person detection

## Target Classes

```python
TARGET_CLASSES = ['person', 'phone', 'material', 'headphones']
```

## Training Configuration

```python
TRAIN_CONFIG = {
    'epochs': 50,
    'imgsz': 640,
    'batch': 16,
    'patience': 15,
    'lr0': 0.001,      # Lower learning rate for fine-tuning
    'freeze': 10,       # Freeze first 10 layers
}
```

## After Training

1. Export to ONNX format (done automatically by scripts)
2. Rename to `anticheat_yolo11s.onnx`
3. Copy to `Intelligence-Test/public/models/`
4. Rebuild and deploy the web application

## Troubleshooting

### "segment dataset incorrectly formatted" Error
This error occurs when training a segmentation model with detection-format labels.
- **Solution**: Use the updated `finetune_yolo_colab.ipynb` or `finetune_yolo_anticheat.py`
- These scripts automatically convert bounding box labels to segmentation polygon format
- Make sure you're using a segmentation model (`yolo11s-seg.pt`, NOT `yolo11s.pt`)

### Low detection confidence
- Train for more epochs (increase to 100-150)
- Add more training data
- Decrease confidence threshold in `ai.worker.js`

### CUDA out of memory
- Reduce batch size to 8 or 4
- Reduce image size to 416

### Model not detecting objects
- Verify class mapping is correct
- Check that labels are in YOLO segmentation format (polygon coordinates)
- Ensure image preprocessing matches training
- For segmentation models: labels should have more than 5 values per line
