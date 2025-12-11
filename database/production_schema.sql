-- PRODUCTION SCHEMA FOR INTELLIGENCE TEST PLATFORM
-- Run this in the Supabase SQL Editor

-- 1. Table: Exam Results
-- Stores the final score and cheat metrics for each submission.
create table if not exists public.exam_results (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  score numeric(5, 2) not null check (score >= 0 and score <= 100),
  cheat_count integer default 0,
  tab_violations integer default 0,
  fullscreen_violations integer default 0,
  multi_screen_detected boolean default false,
  cheat_details jsonb, -- Detailed logs (timestamps of violations)
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. RLS Policies (Security)
-- Enable Row Level Security
alter table public.exam_results enable row level security;

-- Policy: Users can only see their own results
create policy "Users can view own results"
on public.exam_results for select
using (auth.uid() = user_id);

-- Policy: Users can insert their own results (Server-side validation required, or use Service Role)
-- ideally, insertion is done via a Postgres Function or Service Role API to prevent tampering.
-- For this MVP using client-side insertion with RLS:
create policy "Users can insert own results"
on public.exam_results for insert
with check (auth.uid() = user_id);

-- 3. Table: Question Bank (Optional, for Gemini Fallback context)
create table if not exists public.questions (
  id uuid default gen_random_uuid() primary key,
  topic text not null,
  difficulty text check (difficulty in ('easy', 'medium', 'hard')),
  content jsonb not null, -- { "question": "...", "options": [...] }
  created_at timestamp with time zone default timezone('utc'::text, now())
);
