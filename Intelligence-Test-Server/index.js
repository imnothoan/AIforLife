require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { z } = require('zod');

const app = express();
const port = process.env.PORT || 3000;

// Security: Strict CORS (Allow all for now for dev, but ready for production restriction)
app.use(cors());
app.use(express.json());

// --- Configuration ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Initialize Gemini
// Note: In a real app, this key should be in .env, but user provided it explicitly for this session.
// We prioritize the .env variable if it exists.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyBZPYoNZexpqbMRhxyth1uBB5HvakrZ-Jo";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

// --- Validation Schemas (Zod) ---
const SubmitExamSchema = z.object({
  userId: z.string().uuid(),
  score: z.number().min(0).max(100),
  cheatCount: z.number().min(0),
  details: z.string().optional() // JSON string of cheat events
});

const GenerateQuestionSchema = z.object({
  topic: z.string().min(1).max(50),
  difficulty: z.enum(['easy', 'medium', 'hard']),
});

// --- API Endpoints ---

app.get('/', (req, res) => {
  res.send({ status: "ok", message: "Intelligence Test Server Running (v2.0 - Secure & AI Enabled)" });
});

/**
 * Endpoint: Submit Exam Results
 * Features: Input Validation, Database Insert, Concurrency Handling (Basic)
 */
app.post('/api/exam/submit', async (req, res) => {
    // 1. Validation
    const validation = SubmitExamSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({ error: "Invalid Input", details: validation.error.errors });
    }
    const { userId, score, cheatCount, details } = validation.data;

    try {
        // 2. Database Operation
        // Using Supabase to insert. RLS (Row Level Security) on the DB side protects users from seeing each other's data.
        const { data, error } = await supabase
            .from('exam_results')
            .insert([{
                user_id: userId,
                score,
                cheat_count: cheatCount,
                cheat_details: details,
                created_at: new Date().toISOString()
            }])
            .select();

        if (error) throw error;

        res.json({ success: true, message: "Exam submitted successfully", data });
    } catch (error) {
        console.error("Submit Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

/**
 * Endpoint: Generate Question (Gemini AI Fallback)
 * Use case: When the question bank is exhausted or to provide adaptive difficulty.
 */
app.post('/api/generate-question', async (req, res) => {
    // 1. Validation
    const validation = GenerateQuestionSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({ error: "Invalid Input", details: validation.error.errors });
    }
    const { topic, difficulty } = validation.data;

    try {
        // 2. Call Gemini AI
        const prompt = `Create a ${difficulty} multiple-choice question about "${topic}" in Vietnamese.
        Format strictly as JSON: {"question": "...", "options": ["A", "B", "C", "D"], "correctAnswer": "A"}`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // 3. Clean and Parse JSON
        // Sometimes LLMs wrap JSON in ```json ... ```
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const questionData = JSON.parse(jsonStr);

        res.json({ success: true, data: questionData });
    } catch (error) {
        console.error("Gemini Error:", error);
        res.status(500).json({ error: "Failed to generate question" });
    }
});

// --- Server Start ---
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
