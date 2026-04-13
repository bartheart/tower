-- ── income_sources ──────────────────────────────────────────────────────────
-- Stores confirmed and suggested recurring income streams per user.
-- Only rows with is_confirmed = true feed the monthly income total.

create table if not exists public.income_sources (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  name             text not null,
  amount_monthly   numeric(10,2) not null,
  frequency        text not null check (frequency in ('biweekly','monthly','manual')),
  source_account_id text,          -- plaid account_id; null for manually-added sources
  is_confirmed     boolean not null default false,
  created_at       timestamptz default now()
);

alter table public.income_sources enable row level security;
create policy "income_sources: own rows"
  on public.income_sources for all using (auth.uid() = user_id);

-- ── fixed_items ──────────────────────────────────────────────────────────────
-- Individual recurring fixed charges auto-detected or manually added.
-- Only is_confirmed = true items count toward a bucket's monthly_floor.

create table if not exists public.fixed_items (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  category_id       uuid not null references public.budget_categories(id) on delete cascade,
  merchant_name     text not null,
  detected_amount   numeric(10,2) not null,
  confirmed_amount  numeric(10,2),   -- user override; null = use detected_amount
  last_seen_date    date,
  is_confirmed      boolean not null default false,
  needs_review      boolean not null default false,
  created_at        timestamptz default now(),
  unique (user_id, category_id, merchant_name)
);

alter table public.fixed_items enable row level security;
create policy "fixed_items: own rows"
  on public.fixed_items for all using (auth.uid() = user_id);

-- ── budget_categories additions ───────────────────────────────────────────────
-- monthly_floor: sum of confirmed fixed_items for this category (recomputed app-side)
-- is_goal / goal_id: marks goal-generated budget buckets

alter table public.budget_categories
  add column if not exists monthly_floor numeric(10,2) not null default 0,
  add column if not exists is_goal       boolean not null default false,
  add column if not exists goal_id       uuid references public.savings_goals(id) on delete set null;

-- ── savings_goals additions ───────────────────────────────────────────────────
-- linked_category_id: the budget bucket created for this goal
-- monthly_contribution: (target_amount - current_amount) / months_remaining (computed app-side)

alter table public.savings_goals
  add column if not exists linked_category_id  uuid references public.budget_categories(id) on delete set null,
  add column if not exists monthly_contribution numeric(10,2);
