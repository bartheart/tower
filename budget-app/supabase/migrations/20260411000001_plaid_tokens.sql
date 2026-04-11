create table public.plaid_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  item_id text not null unique,
  access_token text not null,
  created_at timestamptz default now()
);

alter table public.plaid_tokens enable row level security;

-- Clients can NEVER read this table. Only Edge Functions with service_role key can.
create policy "plaid_tokens: no client access" on public.plaid_tokens
  for all using (false);
