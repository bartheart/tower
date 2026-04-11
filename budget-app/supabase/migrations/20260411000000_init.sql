-- Enable RLS on all tables
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz default now()
);

create table if not exists public.budget_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  emoji text not null default '💰',
  monthly_limit numeric(10,2) not null default 0,
  color text not null default '#6366f1',
  created_at timestamptz default now()
);

create table if not exists public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  emoji text not null default '🎯',
  target_amount numeric(10,2) not null,
  current_amount numeric(10,2) not null default 0,
  target_date date,
  created_at timestamptz default now()
);

create table if not exists public.app_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  theme text not null default 'dark',
  expo_push_token text,
  updated_at timestamptz default now()
);

-- Row-level security: each user can only see their own rows
alter table public.users enable row level security;
alter table public.budget_categories enable row level security;
alter table public.savings_goals enable row level security;
alter table public.app_preferences enable row level security;

create policy "users: own row" on public.users for all using (auth.uid() = id);
create policy "categories: own rows" on public.budget_categories for all using (auth.uid() = user_id);
create policy "goals: own rows" on public.savings_goals for all using (auth.uid() = user_id);
create policy "prefs: own row" on public.app_preferences for all using (auth.uid() = user_id);

-- Auto-create user profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email) values (new.id, new.email);
  insert into public.app_preferences (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
