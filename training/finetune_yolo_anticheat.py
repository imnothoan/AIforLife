#!/usr/bin/env python3
"""
YOLO Anti-Cheat Model Fine-tuning Script
=========================================
This script fine-tunes the existing YOLO model to improve detection of:
- Phone (currently weak)
- Material/Paper (currently weak)
- Person (needs improvement)
- Headphones (already good)

Run this on Google Colab with GPU for best results.
"""

import os
import shutil
import yaml
from pathlib import Path

# ============================================
# CONFIGURATION
# ============================================

# Target classes - must match existing model
TARGET_CLASSES = ['person', 'phone', 'material', 'headphones']

# Dataset sources from Roboflow (phone and material focused)
ROBOFLOW_DATASETS = [
    # Phone datasets (high priority)
    ("phone_1", "https://app.roboflow.com/ds/5ReObgnLbQ?key=HTPSgVzDLW"),
    ("phone_2", "https://app.roboflow.com/ds/f9k54F7Azq?key=eYssUekSYc"),
    
    # Paper/Material datasets
    ("paper_1", "https://app.roboflow.com/ds/inuabMtp6t?key=jbu7HTlrBf"),
    ("paper_2", "https://app.roboflow.com/ds/b4oxAhlW40?key=4A761Kjm5F"),
    
    # Headphones (for balance)
    ("headphones_1", "https://app.roboflow.com/ds/qqqEeSKAlk?key=GT1Xa65onI"),
    ("headphones_2", "https://app.roboflow.com/ds/cKHwOqmuda?key=qL10KsWlBt"),
    
    # Person dataset
    ("person_1", "https://app.roboflow.com/ds/PwRwV0c1jL?key=FgXbXeqlpH"),
]

# Class mapping from various dataset labels to our target classes
CLASS_MAPPING = {
    # Person variations
    'person': 'person', 'student': 'person', 'face': 'person', 'head': 'person',
    'human': 'person', 'people': 'person', 'man': 'person', 'woman': 'person',
    
    # Phone variations
    'phone': 'phone', 'mobile': 'phone', 'cell phone': 'phone', 
    'telephone': 'phone', 'smartphone': 'phone', 'cellphone': 'phone',
    'mobile phone': 'phone', 'iphone': 'phone', 'android': 'phone',
    
    # Material/Paper variations
    'paper': 'material', 'document': 'material', 'book': 'material',
    'notebook': 'material', 'notes': 'material', 'sheet': 'material',
    'material': 'material', 'cheat sheet': 'material',
    
    # Headphones variations
    'headphone': 'headphones', 'headphones': 'headphones', 
    'earphone': 'headphones', 'earphones': 'headphones',
    'headset': 'headphones', 'earbuds': 'headphones', 'earbud': 'headphones',
    'airpods': 'headphones', 'ear device': 'headphones',
}

# Training configuration
TRAIN_CONFIG = {
    'epochs': 50,           # Number of epochs for fine-tuning
    'imgsz': 640,           # Image size
    'batch': 16,            # Batch size (reduce if OOM)
    'patience': 15,         # Early stopping patience
    'lr0': 0.001,           # Initial learning rate (lower for fine-tuning)
    'lrf': 0.01,            # Final learning rate factor
    'warmup_epochs': 3,     # Warmup epochs
    'freeze': 10,           # Freeze first N layers (for fine-tuning)
}

# ============================================
# HELPER FUNCTIONS
# ============================================

def download_datasets(output_dir):
    """Download all datasets from Roboflow"""
    os.makedirs(output_dir, exist_ok=True)
    
    for name, url in ROBOFLOW_DATASETS:
        dataset_dir = os.path.join(output_dir, name)
        if os.path.exists(dataset_dir):
            print(f"Dataset {name} already exists, skipping...")
            continue
            
        print(f"Downloading {name}...")
        os.makedirs(dataset_dir, exist_ok=True)
        os.system(f'curl -L "{url}" > {dataset_dir}/dataset.zip')
        os.system(f'unzip -q {dataset_dir}/dataset.zip -d {dataset_dir}')
        os.system(f'rm {dataset_dir}/dataset.zip')
    
    print("All datasets downloaded!")


def normalize_class(class_name):
    """Map various class names to our target classes"""
    class_name = class_name.lower().strip()
    for key, target in CLASS_MAPPING.items():
        if key.lower() == class_name:
            return TARGET_CLASSES.index(target)
    return -1  # Unknown class


def convert_labels(dataset_dir, output_dir, split='train'):
    """Convert dataset labels to unified format"""
    images_out = os.path.join(output_dir, split, 'images')
    labels_out = os.path.join(output_dir, split, 'labels')
    os.makedirs(images_out, exist_ok=True)
    os.makedirs(labels_out, exist_ok=True)
    
    # Find data.yaml to get class names
    data_yaml = None
    for root, dirs, files in os.walk(dataset_dir):
        if 'data.yaml' in files:
            data_yaml = os.path.join(root, 'data.yaml')
            break
    
    if not data_yaml:
        print(f"No data.yaml found in {dataset_dir}")
        return 0
    
    with open(data_yaml, 'r') as f:
        config = yaml.safe_load(f)
    
    source_classes = config.get('names', [])
    if isinstance(source_classes, dict):
        source_classes = list(source_classes.values())
    
    print(f"Source classes: {source_classes}")
    
    # Process images and labels
    count = 0
    for split_name in ['train', 'valid', 'test']:
        img_dir = os.path.join(dataset_dir, split_name, 'images')
        lbl_dir = os.path.join(dataset_dir, split_name, 'labels')
        
        if not os.path.exists(img_dir):
            continue
        
        for img_file in os.listdir(img_dir):
            if not img_file.lower().endswith(('.jpg', '.jpeg', '.png')):
                continue
            
            # Copy image
            src_img = os.path.join(img_dir, img_file)
            dst_img = os.path.join(images_out, f"{Path(dataset_dir).name}_{img_file}")
            shutil.copy(src_img, dst_img)
            
            # Convert label
            lbl_file = os.path.splitext(img_file)[0] + '.txt'
            src_lbl = os.path.join(lbl_dir, lbl_file)
            dst_lbl = os.path.join(labels_out, f"{Path(dataset_dir).name}_{lbl_file}")
            
            if os.path.exists(src_lbl):
                with open(src_lbl, 'r') as f:
                    lines = f.readlines()
                
                new_lines = []
                for line in lines:
                    parts = line.strip().split()
                    if len(parts) < 5:
                        continue
                    
                    old_class_id = int(parts[0])
                    if old_class_id < len(source_classes):
                        old_class_name = source_classes[old_class_id]
                        new_class_id = normalize_class(old_class_name)
                        
                        if new_class_id >= 0:
                            parts[0] = str(new_class_id)
                            new_lines.append(' '.join(parts))
                
                if new_lines:
                    with open(dst_lbl, 'w') as f:
                        f.write('\n'.join(new_lines))
                    count += 1
    
    return count


def prepare_dataset(raw_dir, output_dir):
    """Prepare unified dataset from all downloaded datasets"""
    print("Preparing unified dataset...")
    
    # Clear output directory
    if os.path.exists(output_dir):
        shutil.rmtree(output_dir)
    
    total_train = 0
    total_valid = 0
    
    for name, _ in ROBOFLOW_DATASETS:
        dataset_dir = os.path.join(raw_dir, name)
        if not os.path.exists(dataset_dir):
            continue
        
        print(f"Processing {name}...")
        train_count = convert_labels(dataset_dir, output_dir, 'train')
        valid_count = convert_labels(dataset_dir, output_dir, 'valid')
        
        total_train += train_count
        total_valid += valid_count
        print(f"  Added {train_count} train, {valid_count} valid images")
    
    # Create data.yaml
    data_yaml = {
        'path': output_dir,
        'train': 'train/images',
        'val': 'valid/images',
        'names': {i: name for i, name in enumerate(TARGET_CLASSES)},
        'nc': len(TARGET_CLASSES),
    }
    
    with open(os.path.join(output_dir, 'data.yaml'), 'w') as f:
        yaml.dump(data_yaml, f, default_flow_style=False)
    
    print(f"\nDataset prepared!")
    print(f"  Total train images: {total_train}")
    print(f"  Total valid images: {total_valid}")
    print(f"  Classes: {TARGET_CLASSES}")
    
    return os.path.join(output_dir, 'data.yaml')


def finetune_model(base_model_path, data_yaml, output_dir):
    """Fine-tune the YOLO model"""
    from ultralytics import YOLO
    
    print(f"\nLoading base model from {base_model_path}...")
    model = YOLO(base_model_path)
    
    print("Starting fine-tuning...")
    results = model.train(
        data=data_yaml,
        epochs=TRAIN_CONFIG['epochs'],
        imgsz=TRAIN_CONFIG['imgsz'],
        batch=TRAIN_CONFIG['batch'],
        patience=TRAIN_CONFIG['patience'],
        lr0=TRAIN_CONFIG['lr0'],
        lrf=TRAIN_CONFIG['lrf'],
        warmup_epochs=TRAIN_CONFIG['warmup_epochs'],
        freeze=TRAIN_CONFIG['freeze'],
        project=output_dir,
        name='anticheat_finetuned',
        exist_ok=True,
        device=0,  # Use GPU
        verbose=True,
    )
    
    print("\nTraining completed!")
    
    # Export to ONNX
    best_model_path = os.path.join(output_dir, 'anticheat_finetuned', 'weights', 'best.pt')
    print(f"Exporting to ONNX from {best_model_path}...")
    
    model = YOLO(best_model_path)
    model.export(
        format='onnx',
        imgsz=640,
        simplify=True,
        dynamic=False,
        opset=17
    )
    
    onnx_path = best_model_path.replace('.pt', '.onnx')
    print(f"\n✅ ONNX model saved to: {onnx_path}")
    print("\nCopy this file to: Intelligence-Test/public/models/anticheat_yolo11s.onnx")
    
    return onnx_path


# ============================================
# MAIN EXECUTION
# ============================================

if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Fine-tune YOLO Anti-Cheat Model')
    parser.add_argument('--base-model', type=str, required=True,
                        help='Path to base model (.pt file)')
    parser.add_argument('--output-dir', type=str, default='./training_output',
                        help='Output directory for training')
    parser.add_argument('--skip-download', action='store_true',
                        help='Skip dataset download')
    
    args = parser.parse_args()
    
    raw_datasets_dir = os.path.join(args.output_dir, 'raw_datasets')
    merged_dataset_dir = os.path.join(args.output_dir, 'merged_dataset')
    
    # Step 1: Download datasets
    if not args.skip_download:
        download_datasets(raw_datasets_dir)
    
    # Step 2: Prepare unified dataset
    data_yaml = prepare_dataset(raw_datasets_dir, merged_dataset_dir)
    
    # Step 3: Fine-tune model
    finetune_model(args.base_model, data_yaml, args.output_dir)
    
    print("\n" + "="*60)
    print("FINE-TUNING COMPLETE!")
    print("="*60)
