-- Chat messages table for the Analytics Chat tab
-- Stores conversation between Jer/Josh and Claude about business data

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_name text not null,
  question text not null,
  answer text not null,
  chart_data jsonb,
  chart_type text,
  chart_config jsonb,
  created_at timestamptz default now()
);

-- RLS: same pattern as all other tables (private app, anon key has full access)
alter table chat_messages enable row level security;
create policy "Allow all" on chat_messages for all using (true) with check (true);
