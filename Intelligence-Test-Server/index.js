require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { z } = require('zod');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- Configuration ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyBZPYoNZexpqbMRhxyth1uBB5HvakrZ-Jo";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

// --- Validation Schemas (Zod) ---
const SubmitExamSchema = z.object({
  userId: z.string().uuid(),
  score: z.number().min(0).max(100),
  cheatCount: z.number().min(0),
  tabViolations: z.number().min(0).optional(),
  fullscreenViolations: z.number().min(0).optional(),
  multiScreenDetected: z.boolean().optional(),
  details: z.string().optional()
});

const GenerateQuestionSchema = z.object({
  topic: z.string().min(1).max(50),
  difficulty: z.enum(['easy', 'medium', 'hard']),
});

// --- API Endpoints ---

app.get('/', (req, res) => {
  res.send({ status: "ok", message: "Intelligence Test Server Running (v2.1 - Anti-Cheat Enhanced)" });
});

app.post('/api/exam/submit', async (req, res) => {
    // 1. Validation
    const validation = SubmitExamSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({ error: "Invalid Input", details: validation.error.errors });
    }
    const { userId, score, cheatCount, tabViolations, fullscreenViolations, multiScreenDetected, details } = validation.data;

    try {
        // 2. Database Insert
        const { data, error } = await supabase
            .from('exam_results')
            .insert([{
                user_id: userId,
                score,
                cheat_count: cheatCount,
                tab_violations: tabViolations || 0,
                fullscreen_violations: fullscreenViolations || 0,
                multi_screen_detected: multiScreenDetected || false,
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

app.post('/api/generate-question', async (req, res) => {
    const validation = GenerateQuestionSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({ error: "Invalid Input", details: validation.error.errors });
    }
    const { topic, difficulty } = validation.data;

    try {
        const prompt = `Create a ${difficulty} multiple-choice question about "${topic}" in Vietnamese.
        Format strictly as JSON: {"question": "...", "options": ["A", "B", "C", "D"], "correctAnswer": "A"}`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const questionData = JSON.parse(jsonStr);

        res.json({ success: true, data: questionData });
    } catch (error) {
        console.error("Gemini Error:", error);
        res.status(500).json({ error: "Failed to generate question" });
    }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
