
# Intelligence Test Platform (Smart Testing Platform)

## Overview
The **Intelligence Test Platform** is a state-of-the-art, AI-powered exam proctoring and adaptive testing system. It features a **Hybrid Anti-Cheat Architecture** (YOLO11 + L2CS-Net) and a **Computerized Adaptive Testing (CAT)** engine powered by 3PL IRT and Gemini AI.

## Key Features

### 1. Hybrid Anti-Cheat System
-   **Object Detection (YOLO11)**: Detects unauthorized objects like Phones, Books, and multiple people.
-   **Gaze Estimation (L2CS-Net)**: Tracks head pose (Pitch/Yaw) to detect "looking away" behavior.
-   **Real-time Logic Fusion**: Combines object and gaze data to flag suspicious activity with high precision.

### 2. Computerized Adaptive Testing (CAT)
-   **3PL IRT Model**: Estimates student ability ($\theta$) based on item difficulty, discrimination, and guessing parameters.
-   **Adaptive Selection**: Dynamically selects the next question to maximize information at the student's current ability level.
-   **Gemini AI Fallback**: Automatically generates new, calibrated questions if the question bank is exhausted.

### 3. Instructor Dashboard
-   **Real-time Monitoring**: View live proctoring feeds and alerts.
-   **Analytics**: Comprehensive stats on student performance, exam completion, and cheat warnings.
-   **Class Management**: Easy student enrollment and exam assignment.

## Tech Stack
-   **Frontend**: React, Vite, TailwindCSS, ONNX Runtime Web
-   **Backend**: Node.js, Express, Supabase (PostgreSQL)
-   **AI/ML**: YOLO11 (ONNX), L2CS-Net (ONNX), Google Gemini API

## Setup & Run

### Prerequisites
-   Node.js (v18+)
-   Supabase Project
-   Gemini API Key

### Installation

1.  **Backend**:
    ```bash
    cd Intelligence-Test-Server
    npm install
    cp .env.example .env # Configure Supabase & Gemini keys
    npm run dev
    ```

2.  **Frontend**:
    ```bash
    cd Intelligence-Test
    npm install
    # Ensure models are in public/models/
    npm run dev
    ```

## Models
Ensure the following ONNX models are placed in `Intelligence-Test/public/models/`:
-   `anticheat_yolo11s.onnx`
-   `l2cs_net_gaze.onnx`

## Testing
-   **Simulation**: Run `npx ts-node simulate_flow.ts` in the server directory to verify the end-to-end exam flow.

---
**Status**: 100% Complete & Verified
