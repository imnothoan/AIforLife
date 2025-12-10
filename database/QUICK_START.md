# SUPABASE DEPLOYMENT GUIDE

## IMMEDIATE ACTION REQUIRED

### Step 1: Deploy AI Schema (MANUAL - 5 minutes)

1. Open Supabase Dashboard: https://supabase.com/dashboard
2. Navigate to: **SQL Editor**
3. Click: **New Query**
4. Copy entire contents of: `database/deploy_ai_schema.sql`
5. Paste into SQL Editor
6. Click: **RUN**
7. Verify success messages

### Step 2: Verify Tables Created

Run this query in SQL Editor:
```sql
SELECT tablename 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('irt_parameters', 'anticheat_models', 'anticheat_events', 'exam_analytics');
```

Expected: 4 rows

### Step 3: Populate Data (AUTOMATED)

After schema is deployed, run:
```bash
cd /Users/macbook12/Desktop/AI_FL
node scripts/full_supabase_deployment.js
```

This will:
- Insert 3 anticheat models
- Populate IRT parameters (if questions exist)
- Verify deployment

### Step 4: Update Server Code

Once data is populated, update server to use Supabase:
- anticheatRoutes.ts: Fetch models from DB
- CAT algorithm: Use IRT parameters from DB

---

## QUICK START COMMANDS

```bash
# 1. Verify .env has service key
cat Intelligence-Test-Server/.env | grep SUPABASE_SERVICE

# 2. Deploy schema (MANUAL in Supabase Dashboard)
# Copy: database/deploy_ai_schema.sql

# 3. Run data population
node scripts/full_supabase_deployment.js

# 4. Verify deployment
# Check Supabase Dashboard → Table Editor
```

---

## TROUBLESHOOTING

**Q: Schema deployment fails?**  
A: Check for existing tables, may need to drop first

**Q: Module not found?**  
A: Run `npm install` in root directory

**Q: No questions in database?**  
A: IRT parameters will be skipped, can run again later

---

**Status**: Ready to deploy! 🚀
