require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.get('/', (req, res) => {
  res.send('Intelligence Test Server Running');
});

// Example Endpoint: Save Exam Result
app.post('/api/exam/submit', async (req, res) => {
    const { userId, score, cheatCount } = req.body;
    // Save to Supabase
    const { data, error } = await supabase
        .from('exam_results')
        .insert([{ user_id: userId, score, cheat_count: cheatCount }]);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, data });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
