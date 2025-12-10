# DEPLOYMENT PACKAGE - SUPABASE AI MODELS

## 📦 Complete Deployment Scripts

This package contains everything needed to deploy AI models to Supabase.

### Files Included:

1. **`deploy_ai_schema.sql`** - Main schema deployment
   - Creates all tables (irt_parameters, anticheat_models, anticheat_events, exam_analytics)
   - Sets up Row Level Security (RLS)
   - Creates indexes for performance
   - Adds triggers and views

2. **`populate_irt_parameters.sql`** - IRT data population
   - Sample SQL for inserting 500 calibrated questions
   - Needs question ID mapping for production

3. **`../ai_models/irt_calibration.json`** - Source IRT data
   - 500 questions with a, b, c parameters
   - Ready for import

4. **`../ai_models/anticheat_models.json`** - Model metadata
   - 3 trained models (gaze, objects, faces)
   - Performance metrics included

---

## 🚀 Deployment Steps

### Step 1: Deploy Schema

1. Open Supabase Dashboard → SQL Editor
2. Copy contents of `deploy_ai_schema.sql`
3. Execute the script
4. Verify success message

**Expected Output**:
```
✅ AI MODELS SCHEMA DEPLOYED SUCCESSFULLY!
📊 Tables Created: 4
🔒 Row Level Security: ENABLED
```

### Step 2: Verify Tables

Run this query:
```sql
SELECT 
    tablename,
    schemaname
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('irt_parameters', 'anticheat_models', 'anticheat_events', 'exam_analytics');
```

**Expected**: 4 rows returned

### Step 3: Populate Anticheat Models

```sql
-- Insert Gaze Detection Model
INSERT INTO public.anticheat_models (
    model_type,
    version,
    accuracy,
    parameters,
    threshold,
    training_dataset
)
VALUES (
    'gaze',
    '1.0.0',
    0.9352,
    '{
        "type": "gaze_classifier",
        "classes": ["looking_at_screen", "looking_away"],
        "threshold": 0.7,
        "architecture": "MobileNet CNN"
    }'::jsonb,
    0.7,
    'Simulated gaze dataset (2000 samples)'
);

-- Insert Object Detection Model
INSERT INTO public.anticheat_models (
    model_type,
    version,
    accuracy,
    parameters,
    threshold,
    training_dataset
)
VALUES (
    'objects',
    '1.0.0',
    0.7505,
    '{
        "type": "yolo_detector",
        "classes": ["phone", "book", "notes"],
        "confidence_threshold": 0.6,
        "map": 0.7505
    }'::jsonb,
    0.6,
    'Simulated object dataset (2000 samples)'
);

-- Insert Face Counting Model
INSERT INTO public.anticheat_models (
    model_type,
    version,
    accuracy,
    parameters,
    threshold,
    training_dataset
)
VALUES (
    'faces',
    '1.0.0',
    0.9597,
    '{
        "type": "face_counter",
        "max_detectable": 5,
        "confidence_threshold": 0.9
    }'::jsonb,
    0.9,
    'Simulated face dataset (2000 samples)'
);
```

### Step 4: Populate IRT Parameters (REQUIRES MAPPING)

⚠️ **Important**: `populate_irt_parameters.sql` contains sample mappings.

**For Production**:
1. Export existing questions from Supabase:
   ```sql
   SELECT id, topic, question FROM public.questions;
   ```

2. Create mapping file: `sample_id → uuid`

3. Update SQL script with correct UUIDs

4. Execute updated script

**Alternative - CSV Import**:
```csv
question_id,discrimination,difficulty_irt,guessing
uuid-1,1.408,-0.018,0.250
uuid-2,1.438,0.215,0.250
...
```

### Step 5: Verify Deployment

```sql
-- Check IRT parameters
SELECT COUNT(*) FROM public.irt_parameters;
-- Expected: 500 (after mapping)

-- Check anticheat models
SELECT model_type, version, accuracy 
FROM public.anticheat_models 
WHERE is_active = TRUE;
-- Expected: 3 models

-- Check views
SELECT * FROM public.questions_with_irt LIMIT 5;
```

---

## 🔧 Server Integration

After database deployment, update server code:

### Update anticheatRoutes.ts

Replace JSON file loading with database queries:

```typescript
// OLD: Load from JSON
const anticheatModels = JSON.parse(
  fs.readFileSync(path, 'utf8')
);

// NEW: Load from Supabase
const { data: models } = await supabase
  .from('anticheat_models')
  .select('*')
  .eq('is_active', true);
```

### Update CAT Algorithm

```typescript
// Fetch IRT parameters for questions
const { data: params } = await supabase
  .from('irt_parameters')
  .select('*')
  .in('question_id', questionIds);

// Use parameters in CAT calculation
const information = calculateInformation(
  theta,
  params.discrimination,
  params.difficulty_irt,
  params.guessing
);
```

---

## 📊 Performance Optimization

### Recommended Indexes (already created):

```sql
CREATE INDEX idx_irt_parameters_question ON irt_parameters(question_id);
CREATE INDEX idx_irt_difficulty ON irt_parameters(difficulty_irt);
CREATE INDEX idx_anticheat_events_attempt ON anticheat_events(attempt_id, detected_at DESC);
```

### Query Optimization:

For large datasets, use materialized views:

```sql
CREATE MATERIALIZED VIEW mv_question_analytics AS
SELECT 
    q.id,
    q.topic,
    irt.discrimination,
    irt.difficulty_irt,
    COUNT(DISTINCT ea.id) as times_used
FROM questions q
LEFT JOIN irt_parameters irt ON irt.question_id = q.id
LEFT JOIN exam_attempts ea ON ea.exam_id = ANY(
    SELECT exam_id FROM exams WHERE q.id = ANY(questions)
)
GROUP BY q.id, q.topic, irt.discrimination, irt.difficulty_irt;

-- Refresh periodically
REFRESH MATERIALIZED VIEW mv_question_analytics;
```

---

## 🔒 Security Considerations

### Row Level Security (RLS):

Already enabled! Instructors can only see:
- IRT parameters for their questions
- Anticheat events for their exams
- Analytics for their exams

### API Keys:

Never expose in client code:
```typescript
// ❌ WRONG
const supabase = createClient(url, ANON_KEY); // in React

// ✅ CORRECT
// Use server-side with SERVICE_ROLE_KEY for admin operations
```

---

## 📈 Monitoring & Maintenance

### Weekly Tasks:

1. **Refresh Analytics**:
   ```sql
   REFRESH MATERIALIZED VIEW mv_question_analytics;
   ```

2. **Archive Old Events** (6 months+):
   ```sql
   DELETE FROM anticheat_events 
   WHERE detected_at < NOW() - INTERVAL '6 months';
   ```

3. **Update Model Versions**:
   ```sql
   -- Deactivate old version
   UPDATE anticheat_models SET is_active = FALSE 
   WHERE model_type = 'gaze' AND version = '1.0.0';
   
   -- Insert new version
   INSERT INTO anticheat_models (...) VALUES (...);
   ```

---

## ✅ Deployment Checklist

- [ ] Run `deploy_ai_schema.sql` in Supabase
- [ ] Verify all 4 tables created
- [ ] Insert anticheat model metadata
- [ ] Map sample question IDs to real UUIDs
- [ ] Populate IRT parameters
- [ ] Test queries with sample data
- [ ] Update server code to use database
- [ ] Test anticheat API with DB integration
- [ ] Test CAT algorithm with IRT from DB
- [ ] Set up automated backups
- [ ] Configure monitoring alerts

---

## 🆘 Troubleshooting

### Issue: "relation does not exist"
**Solution**: Ensure schema script ran successfully. Check pg_tables.

### Issue: "null value in column violates not-null constraint"
**Solution**: Verify all required fields populated in INSERT statements.

### Issue: RLS blocking queries
**Solution**: Use service role key for admin operations, or update policies.

### Issue: Slow queries
**Solution**: Run ANALYZE, check indexes, consider materialized views.

---

## 📞 Support

For issues deploying this schema:
1. Check Supabase logs in Dashboard → Database → Logs
2. Verify RLS policies match your auth setup
3. Test queries in SQL Editor first
4. Check server connection with test query

---

**Version**: 1.0.0  
**Last Updated**: 2025-11-22  
**Maintainer**: Intelligence Test Platform Team
