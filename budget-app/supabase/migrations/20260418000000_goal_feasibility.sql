-- ── savings_goals additions ───────────────────────────────────────────────────

alter table public.savings_goals
  add column if not exists starting_amount   numeric(10,2) not null default 0,
  add column if not exists status            text          not null default 'on_track',
  add column if not exists last_computed_at  timestamptz;

-- status must be one of the three valid values
alter table public.savings_goals
  add constraint savings_goals_status_check
  check (status in ('on_track', 'at_risk', 'completed'));

-- ── budget_categories additions ───────────────────────────────────────────────

alter table public.budget_categories
  add column if not exists priority_rank int;

-- ── goal_events ───────────────────────────────────────────────────────────────

create table if not exists public.goal_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  goal_id        uuid not null references public.savings_goals(id) on delete cascade,
  event_type     text not null,
  trigger        text not null default 'sync',
  shortfall      numeric(10,2),
  snapshot       jsonb not null default '{}',
  created_at     timestamptz not null default now()
);

alter table public.goal_events enable row level security;
create policy "goal_events: own rows"
  on public.goal_events for all using (auth.uid() = user_id);

alter table public.goal_events
  add constraint goal_events_event_type_check
  check (event_type in ('at_risk', 'back_on_track', 'adjustment', 'completed')),
  add constraint goal_events_trigger_check
  check (trigger in ('sync', 'manual'));
