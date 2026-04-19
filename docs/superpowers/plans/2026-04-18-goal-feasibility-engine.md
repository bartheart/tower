# Goal Feasibility Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual goal progress updates with an automatic engine that computes after every Plaid sync whether the user can hit each savings goal by its target date, notifies them when a goal falls at-risk, and lets them cut budgets or extend the timeline to recover.

**Architecture:** Client-side feasibility computation using on-device WatermelonDB transaction data immediately after sync. Status flips write a `goal_event` to Supabase (audit log) and fire a local push notification. Supabase stores events and goal status — it does not run the computation. Pure engine functions are unit-tested in isolation; I/O is handled by an orchestrator that follows the existing `checkBudgetAlerts` pattern in `backgroundSync.ts`.

**Tech Stack:** React Native (Expo), WatermelonDB, Supabase JS v2, `expo-notifications`, `expo-secure-store`, TypeScript, Jest.

---

## File Map

| File | Action | Role |
|---|---|---|
| `budget-app/supabase/migrations/20260418000000_goal_feasibility.sql` | Create | Add columns to savings_goals + budget_categories; create goal_events table |
| `budget-app/mobile/src/goals/feasibilityEngine.ts` | Create | Pure function: given income/spend/goals → per-goal feasibility results |
| `budget-app/mobile/src/goals/__tests__/feasibilityEngine.test.ts` | Create | Unit tests for feasibility engine |
| `budget-app/mobile/src/goals/suggestionEngine.ts` | Create | Pure function: given shortfall + buckets → ordered cut list + timeline extension |
| `budget-app/mobile/src/goals/__tests__/suggestionEngine.test.ts` | Create | Unit tests for suggestion engine |
| `budget-app/mobile/src/goals/goalEvents.ts` | Create | writeGoalEvent + loadGoalEvents (Supabase I/O) |
| `budget-app/mobile/src/goals/__tests__/goalEvents.test.ts` | Create | Tests for goalEvents (mocked Supabase) |
| `budget-app/mobile/src/goals/goalNotifications.ts` | Create | Fire local push + SecureStore dedup |
| `budget-app/mobile/src/goals/checkGoalFeasibility.ts` | Create | Orchestrator: loads data, runs engine, writes events, fires notifications |
| `budget-app/mobile/src/goals/__tests__/checkGoalFeasibility.test.ts` | Create | Integration tests for orchestrator (mocked deps) |
| `budget-app/mobile/src/hooks/useGoals.ts` | Modify | Add startingAmount, status, monthlyContributionNeeded to Goal type; update queries |
| `budget-app/mobile/src/hooks/useBudgets.ts` | Modify | Add priorityRank to BudgetCategory; update Supabase select + sort |
| `budget-app/mobile/src/plaid/backgroundSync.ts` | Modify | Call checkGoalFeasibility after checkBudgetAlerts |
| `budget-app/mobile/src/screens/PlanScreen.tsx` | Modify | AddGoalModal startingAmount field; goal card status pill + contribution line + at-risk prompt; suggestion sheet; history section |

---

## Task 1: DB Migration

**Files:**
- Create: `budget-app/supabase/migrations/20260418000000_goal_feasibility.sql`

- [ ] **Step 1: Write the migration**

Create `budget-app/supabase/migrations/20260418000000_goal_feasibility.sql`:

```sql
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
```

- [ ] **Step 2: Apply migration locally**

```bash
cd budget-app
npx supabase db push
```

Expected: migration runs without errors.

- [ ] **Step 3: Commit**

```bash
git checkout -b feat/goal-feasibility-engine
git add budget-app/supabase/migrations/20260418000000_goal_feasibility.sql
git commit -m "feat: add goal_events table, starting_amount/status to savings_goals, priority_rank to budget_categories"
```

---

## Task 2: Feasibility Engine (pure function)

**Files:**
- Create: `budget-app/mobile/src/goals/feasibilityEngine.ts`
- Create: `budget-app/mobile/src/goals/__tests__/feasibilityEngine.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `budget-app/mobile/src/goals/__tests__/feasibilityEngine.test.ts`:

```typescript
import { runFeasibilityCheck, GoalStatus } from '../feasibilityEngine';

const baseInput = {
  confirmedMonthlyIncome: 5000,
  currentMonthSpend: 1500,
  daysElapsed: 15,
  daysInMonth: 30,
  goals: [
    {
      id: 'g1',
      targetAmount: 6000,
      currentAmount: 1000,
      startingAmount: 1000,
      targetDate: '2026-10-01',
      status: 'on_track' as GoalStatus,
    },
  ],
};

test('marks goal on_track when surplus covers contribution', () => {
  // projectedSpend = 1500/15*30 = 3000, surplus = 5000-3000 = 2000
  // monthsLeft ≈ 6, contribution = (6000-1000)/6 ≈ 834
  const results = runFeasibilityCheck(baseInput);
  expect(results[0].newStatus).toBe('on_track');
  expect(results[0].shortfall).toBe(0);
});

test('marks goal at_risk when surplus < total contributions needed', () => {
  const result = runFeasibilityCheck({
    ...baseInput,
    confirmedMonthlyIncome: 2000, // surplus = 2000-3000 = negative → shortfall
  });
  expect(result[0].newStatus).toBe('at_risk');
  expect(result[0].shortfall).toBeGreaterThan(0);
});

test('marks goal completed when currentAmount >= targetAmount', () => {
  const result = runFeasibilityCheck({
    ...baseInput,
    goals: [{ ...baseInput.goals[0], currentAmount: 6000 }],
  });
  expect(result[0].newStatus).toBe('completed');
});

test('skips feasibility check for goals with no targetDate', () => {
  const result = runFeasibilityCheck({
    ...baseInput,
    goals: [{ ...baseInput.goals[0], targetDate: null }],
  });
  expect(result[0].newStatus).toBe('on_track'); // unchanged
  expect(result[0].shortfall).toBe(0);
});

test('marks all goals at_risk when income is zero', () => {
  const result = runFeasibilityCheck({ ...baseInput, confirmedMonthlyIncome: 0 });
  expect(result[0].newStatus).toBe('at_risk');
});

test('uses prior month spend when daysElapsed is 0', () => {
  const result = runFeasibilityCheck({
    ...baseInput,
    currentMonthSpend: 0,
    daysElapsed: 0,
    priorMonthSpend: 2000,
  });
  expect(result[0].newStatus).toBe('on_track'); // surplus = 5000-2000=3000 > contribution
});

test('marks goal at_risk when overdue (monthsLeft <= 0)', () => {
  const result = runFeasibilityCheck({
    ...baseInput,
    goals: [{ ...baseInput.goals[0], targetDate: '2025-01-01' }], // past date
  });
  expect(result[0].newStatus).toBe('at_risk');
});

test('status stays at_risk if already at_risk and still infeasible', () => {
  const result = runFeasibilityCheck({
    ...baseInput,
    confirmedMonthlyIncome: 500,
    goals: [{ ...baseInput.goals[0], status: 'at_risk' as GoalStatus }],
  });
  expect(result[0].previousStatus).toBe('at_risk');
  expect(result[0].newStatus).toBe('at_risk');
  expect(result[0].statusChanged).toBe(false);
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd budget-app/mobile
npx jest src/goals/__tests__/feasibilityEngine.test.ts --no-coverage 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../feasibilityEngine'`

- [ ] **Step 3: Implement the engine**

Create `budget-app/mobile/src/goals/feasibilityEngine.ts`:

```typescript
export type GoalStatus = 'on_track' | 'at_risk' | 'completed';

export interface FeasibilityGoal {
  id: string;
  targetAmount: number;
  currentAmount: number;
  startingAmount: number;
  targetDate: string | null;
  status: GoalStatus;
}

export interface FeasibilityInput {
  confirmedMonthlyIncome: number;
  currentMonthSpend: number;
  daysElapsed: number;
  daysInMonth: number;
  priorMonthSpend?: number; // used when daysElapsed === 0
  goals: FeasibilityGoal[];
}

export interface GoalFeasibilityResult {
  goalId: string;
  previousStatus: GoalStatus;
  newStatus: GoalStatus;
  statusChanged: boolean;
  projectedSurplus: number;
  shortfall: number;       // 0 if feasible
  monthlyContributionNeeded: number;
  monthsLeft: number | null;
}

function monthsUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30));
}

export function runFeasibilityCheck(input: FeasibilityInput): GoalFeasibilityResult[] {
  const {
    confirmedMonthlyIncome,
    currentMonthSpend,
    daysElapsed,
    daysInMonth,
    priorMonthSpend = 0,
    goals,
  } = input;

  // Projected spend: extrapolate current month, fall back to prior month on day 0
  const baseSpend = daysElapsed > 0
    ? (currentMonthSpend / daysElapsed) * daysInMonth
    : priorMonthSpend;

  const projectedSurplus = confirmedMonthlyIncome - baseSpend;

  // Sum of all active goal contributions
  const totalContributionNeeded = goals.reduce((sum, g) => {
    if (!g.targetDate || g.currentAmount >= g.targetAmount) return sum;
    const months = monthsUntil(g.targetDate);
    if (months <= 0) return sum; // overdue handled per-goal
    return sum + (g.targetAmount - g.currentAmount) / months;
  }, 0);

  return goals.map((goal): GoalFeasibilityResult => {
    const previousStatus = goal.status;

    // Already completed
    if (goal.currentAmount >= goal.targetAmount) {
      return {
        goalId: goal.id,
        previousStatus,
        newStatus: 'completed',
        statusChanged: previousStatus !== 'completed',
        projectedSurplus,
        shortfall: 0,
        monthlyContributionNeeded: 0,
        monthsLeft: 0,
      };
    }

    // No target date — aspirational goal, skip feasibility
    if (!goal.targetDate) {
      return {
        goalId: goal.id,
        previousStatus,
        newStatus: previousStatus === 'completed' ? 'on_track' : previousStatus,
        statusChanged: false,
        projectedSurplus,
        shortfall: 0,
        monthlyContributionNeeded: 0,
        monthsLeft: null,
      };
    }

    const monthsLeft = monthsUntil(goal.targetDate);

    // Overdue
    if (monthsLeft <= 0) {
      const newStatus: GoalStatus = 'at_risk';
      return {
        goalId: goal.id,
        previousStatus,
        newStatus,
        statusChanged: previousStatus !== newStatus,
        projectedSurplus,
        shortfall: goal.targetAmount - goal.currentAmount,
        monthlyContributionNeeded: goal.targetAmount - goal.currentAmount,
        monthsLeft: 0,
      };
    }

    const monthlyContributionNeeded = (goal.targetAmount - goal.currentAmount) / monthsLeft;
    const feasible = confirmedMonthlyIncome > 0 && projectedSurplus >= totalContributionNeeded;
    const shortfall = feasible ? 0 : Math.max(0, totalContributionNeeded - projectedSurplus);
    const newStatus: GoalStatus = feasible ? 'on_track' : 'at_risk';

    return {
      goalId: goal.id,
      previousStatus,
      newStatus,
      statusChanged: previousStatus !== newStatus,
      projectedSurplus,
      shortfall,
      monthlyContributionNeeded,
      monthsLeft,
    };
  });
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd budget-app/mobile
npx jest src/goals/__tests__/feasibilityEngine.test.ts --no-coverage 2>&1 | tail -15
```

Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add budget-app/mobile/src/goals/feasibilityEngine.ts \
        budget-app/mobile/src/goals/__tests__/feasibilityEngine.test.ts
git commit -m "feat: add goal feasibility engine (pure function)"
```

---

## Task 3: Suggestion Engine (pure function)

**Files:**
- Create: `budget-app/mobile/src/goals/suggestionEngine.ts`
- Create: `budget-app/mobile/src/goals/__tests__/suggestionEngine.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `budget-app/mobile/src/goals/__tests__/suggestionEngine.test.ts`:

```typescript
import { computeSuggestions, SuggestionBucket } from '../suggestionEngine';

const buckets: SuggestionBucket[] = [
  { id: 'b1', name: 'Dining',        targetPct: 12, monthlyFloor: 0,   priorityRank: null, monthlyLimit: 600,  isGoal: false },
  { id: 'b2', name: 'Entertainment', targetPct: 8,  monthlyFloor: 0,   priorityRank: null, monthlyLimit: 400,  isGoal: false },
  { id: 'b3', name: 'Rent',          targetPct: 30, monthlyFloor: 1500, priorityRank: 1,   monthlyLimit: 1500, isGoal: false },
  { id: 'b4', name: 'Groceries',     targetPct: 10, monthlyFloor: 400,  priorityRank: 2,   monthlyLimit: 500,  isGoal: false },
  { id: 'b5', name: 'Goal bucket',   targetPct: 10, monthlyFloor: 0,   priorityRank: null, monthlyLimit: 500,  isGoal: true  },
];

const income = 5000;

test('excludes goal buckets from suggestions', () => {
  const result = computeSuggestions({ shortfall: 200, buckets, confirmedMonthlyIncome: income });
  expect(result.cuts.find(c => c.bucketId === 'b5')).toBeUndefined();
});

test('excludes buckets with no slack above floor', () => {
  const result = computeSuggestions({ shortfall: 200, buckets, confirmedMonthlyIncome: income });
  // Rent: monthlyLimit=1500, floor=1500 → no slack
  expect(result.cuts.find(c => c.bucketId === 'b3')).toBeUndefined();
});

test('cuts unranked buckets before ranked ones', () => {
  const result = computeSuggestions({ shortfall: 200, buckets, confirmedMonthlyIncome: income });
  const ids = result.cuts.map(c => c.bucketId);
  // b1 and b2 are unranked (null) so they come before b4 (rank 2)
  const unrankedIdx = Math.max(ids.indexOf('b1'), ids.indexOf('b2'));
  const rankedIdx = ids.indexOf('b4');
  if (rankedIdx !== -1) expect(unrankedIdx).toBeLessThan(rankedIdx);
});

test('cuts most slack first among unranked buckets', () => {
  const result = computeSuggestions({ shortfall: 100, buckets, confirmedMonthlyIncome: income });
  // b1 slack = 600, b2 slack = 400 → b1 comes first
  const ids = result.cuts.map(c => c.bucketId);
  if (ids.includes('b1') && ids.includes('b2')) {
    expect(ids.indexOf('b1')).toBeLessThan(ids.indexOf('b2'));
  }
});

test('sum of cuts >= shortfall when enough slack exists', () => {
  const result = computeSuggestions({ shortfall: 300, buckets, confirmedMonthlyIncome: income });
  const totalCut = result.cuts.reduce((s, c) => s + c.cutAmount, 0);
  expect(totalCut).toBeGreaterThanOrEqual(300);
});

test('reason label says "ranked #N" for ranked buckets', () => {
  // Force a large shortfall so we reach b4 (rank 2)
  const result = computeSuggestions({ shortfall: 1200, buckets, confirmedMonthlyIncome: income });
  const b4cut = result.cuts.find(c => c.bucketId === 'b4');
  if (b4cut) expect(b4cut.reason).toMatch(/ranked #2/);
});

test('reason label says headroom for unranked buckets', () => {
  const result = computeSuggestions({ shortfall: 100, buckets, confirmedMonthlyIncome: income });
  const b1cut = result.cuts.find(c => c.bucketId === 'b1');
  expect(b1cut?.reason).toMatch(/headroom above floor/);
});

test('computes timelineExtensionMonths > 0 when shortfall exists', () => {
  const result = computeSuggestions({
    shortfall: 300,
    buckets,
    confirmedMonthlyIncome: income,
    goalMonthlyContribution: 500,
    projectedSurplus: 200,
    monthsLeft: 12,
  });
  expect(result.timelineExtensionMonths).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd budget-app/mobile
npx jest src/goals/__tests__/suggestionEngine.test.ts --no-coverage 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../suggestionEngine'`

- [ ] **Step 3: Implement the suggestion engine**

Create `budget-app/mobile/src/goals/suggestionEngine.ts`:

```typescript
export interface SuggestionBucket {
  id: string;
  name: string;
  targetPct: number;
  monthlyFloor: number;
  monthlyLimit: number;
  priorityRank: number | null;
  isGoal: boolean;
}

export interface BudgetCut {
  bucketId: string;
  bucketName: string;
  currentPct: number;
  suggestedPct: number;
  cutAmount: number;
  reason: string;
}

export interface SuggestionInput {
  shortfall: number;
  buckets: SuggestionBucket[];
  confirmedMonthlyIncome: number;
  goalMonthlyContribution?: number;
  projectedSurplus?: number;
  monthsLeft?: number;
}

export interface SuggestionResult {
  cuts: BudgetCut[];
  coverableShortfall: number;
  timelineExtensionMonths: number;
}

export function computeSuggestions(input: SuggestionInput): SuggestionResult {
  const {
    shortfall,
    buckets,
    confirmedMonthlyIncome,
    goalMonthlyContribution = 0,
    projectedSurplus = 0,
    monthsLeft = 0,
  } = input;

  // Eligible: non-goal buckets with slack above their floor
  const eligible = buckets
    .filter(b => !b.isGoal && b.monthlyFloor < b.monthlyLimit)
    .map(b => ({
      ...b,
      slack: b.monthlyLimit - b.monthlyFloor,
    }))
    // Sort: unranked (null) first sorted by slack DESC, then ranked ASC (lowest rank = lowest priority = cut first)
    .sort((a, b) => {
      const aRanked = a.priorityRank !== null;
      const bRanked = b.priorityRank !== null;
      if (!aRanked && !bRanked) return b.slack - a.slack; // both unranked: most slack first
      if (!aRanked) return -1; // a unranked, b ranked: a comes first (cut unranked first)
      if (!bRanked) return 1;
      // Both ranked: higher rank number = lower priority = cut first
      return b.priorityRank! - a.priorityRank!;
    });

  const cuts: BudgetCut[] = [];
  let remaining = shortfall;
  let coverableShortfall = 0;

  for (const bucket of eligible) {
    if (remaining <= 0) break;
    const cut = Math.min(bucket.slack, remaining);
    if (cut <= 0) continue;

    const cutPct = confirmedMonthlyIncome > 0 ? (cut / confirmedMonthlyIncome) * 100 : 0;
    const reason = bucket.priorityRank !== null
      ? `ranked #${bucket.priorityRank} — lower priority`
      : `$${Math.round(bucket.slack)} headroom above floor`;

    cuts.push({
      bucketId: bucket.id,
      bucketName: bucket.name,
      currentPct: bucket.targetPct,
      suggestedPct: Math.max(0, bucket.targetPct - cutPct),
      cutAmount: cut,
      reason,
    });

    remaining -= cut;
    coverableShortfall += cut;
  }

  // Timeline extension: how many extra months needed if we keep current surplus
  let timelineExtensionMonths = 0;
  if (goalMonthlyContribution > 0 && projectedSurplus >= 0 && monthsLeft > 0) {
    const affordable = Math.max(0, projectedSurplus);
    if (affordable < goalMonthlyContribution && affordable > 0) {
      const amountStillNeeded = goalMonthlyContribution * monthsLeft - affordable * monthsLeft;
      timelineExtensionMonths = Math.ceil(amountStillNeeded / affordable);
    } else if (affordable === 0) {
      timelineExtensionMonths = monthsLeft; // can't make progress at all
    }
  }

  return { cuts, coverableShortfall, timelineExtensionMonths };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd budget-app/mobile
npx jest src/goals/__tests__/suggestionEngine.test.ts --no-coverage 2>&1 | tail -15
```

Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add budget-app/mobile/src/goals/suggestionEngine.ts \
        budget-app/mobile/src/goals/__tests__/suggestionEngine.test.ts
git commit -m "feat: add goal suggestion engine (pure function)"
```

---

## Task 4: Goal Events (Supabase I/O)

**Files:**
- Create: `budget-app/mobile/src/goals/goalEvents.ts`
- Create: `budget-app/mobile/src/goals/__tests__/goalEvents.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `budget-app/mobile/src/goals/__tests__/goalEvents.test.ts`:

```typescript
import { writeGoalEvent, loadGoalEvents } from '../goalEvents';

const mockInsert = jest.fn().mockReturnValue({ error: null });
const mockSelect = jest.fn().mockReturnValue({
  data: [
    {
      id: 'e1',
      goal_id: 'g1',
      event_type: 'at_risk',
      trigger: 'sync',
      shortfall: 300,
      snapshot: { projectedSurplus: 200 },
      created_at: '2026-04-18T12:00:00Z',
    },
  ],
  error: null,
});

jest.mock('../../supabase/client', () => ({
  supabase: {
    from: jest.fn(() => ({
      insert: mockInsert,
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          order: jest.fn(() => ({
            limit: jest.fn(() => mockSelect()),
          })),
        })),
      })),
    })),
  },
}));

beforeEach(() => jest.clearAllMocks());

test('writeGoalEvent calls supabase insert with correct shape', async () => {
  await writeGoalEvent({
    userId: 'u1',
    goalId: 'g1',
    eventType: 'at_risk',
    trigger: 'sync',
    shortfall: 300,
    snapshot: { projectedSurplus: 200 },
  });
  expect(mockInsert).toHaveBeenCalledWith({
    user_id: 'u1',
    goal_id: 'g1',
    event_type: 'at_risk',
    trigger: 'sync',
    shortfall: 300,
    snapshot: { projectedSurplus: 200 },
  });
});

test('writeGoalEvent throws when supabase returns error', async () => {
  mockInsert.mockReturnValueOnce({ error: { message: 'DB error' } });
  await expect(writeGoalEvent({
    userId: 'u1', goalId: 'g1', eventType: 'at_risk',
    trigger: 'sync', shortfall: 0, snapshot: {},
  })).rejects.toThrow('DB error');
});

test('loadGoalEvents returns mapped events', async () => {
  const events = await loadGoalEvents('g1');
  expect(events).toHaveLength(1);
  expect(events[0].eventType).toBe('at_risk');
  expect(events[0].shortfall).toBe(300);
  expect(events[0].createdAt).toBe('2026-04-18T12:00:00Z');
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd budget-app/mobile
npx jest src/goals/__tests__/goalEvents.test.ts --no-coverage 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../goalEvents'`

- [ ] **Step 3: Implement goalEvents**

Create `budget-app/mobile/src/goals/goalEvents.ts`:

```typescript
import { supabase } from '../supabase/client';

export type GoalEventType = 'at_risk' | 'back_on_track' | 'adjustment' | 'completed';
export type GoalEventTrigger = 'sync' | 'manual';

export interface GoalEvent {
  id: string;
  goalId: string;
  eventType: GoalEventType;
  trigger: GoalEventTrigger;
  shortfall: number | null;
  snapshot: Record<string, unknown>;
  createdAt: string;
}

export interface WriteGoalEventParams {
  userId: string;
  goalId: string;
  eventType: GoalEventType;
  trigger: GoalEventTrigger;
  shortfall: number;
  snapshot: Record<string, unknown>;
}

export async function writeGoalEvent(params: WriteGoalEventParams): Promise<void> {
  const { error } = await supabase.from('goal_events').insert({
    user_id: params.userId,
    goal_id: params.goalId,
    event_type: params.eventType,
    trigger: params.trigger,
    shortfall: params.shortfall,
    snapshot: params.snapshot,
  });
  if (error) throw new Error(error.message);
}

export async function loadGoalEvents(goalId: string, limit = 10): Promise<GoalEvent[]> {
  const { data, error } = await supabase
    .from('goal_events')
    .select('*')
    .eq('goal_id', goalId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(r => ({
    id: r.id,
    goalId: r.goal_id,
    eventType: r.event_type as GoalEventType,
    trigger: r.trigger as GoalEventTrigger,
    shortfall: r.shortfall ?? null,
    snapshot: r.snapshot ?? {},
    createdAt: r.created_at,
  }));
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd budget-app/mobile
npx jest src/goals/__tests__/goalEvents.test.ts --no-coverage 2>&1 | tail -15
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add budget-app/mobile/src/goals/goalEvents.ts \
        budget-app/mobile/src/goals/__tests__/goalEvents.test.ts
git commit -m "feat: add goalEvents — writeGoalEvent + loadGoalEvents"
```

---

## Task 5: Goal Notifications

**Files:**
- Create: `budget-app/mobile/src/goals/goalNotifications.ts`

- [ ] **Step 1: Implement goalNotifications**

This follows the exact same SecureStore dedup pattern as `budgetAlerts.ts`.

Create `budget-app/mobile/src/goals/goalNotifications.ts`:

```typescript
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

/**
 * Key format: goalAtRisk:<YYYY-MM>:<goalId>
 * Ensures the user gets at most one notification per goal per calendar month.
 * Resets when the goal recovers (clearGoalAtRiskKey) so they get re-notified
 * if it falls at-risk again in the same month.
 */
function atRiskKey(goalId: string): string {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `goalAtRisk:${ym}:${goalId}`;
}

export async function fireGoalAtRiskNotification(
  goalName: string,
  goalId: string,
): Promise<void> {
  const key = atRiskKey(goalId);
  const alreadySent = await SecureStore.getItemAsync(key);
  if (alreadySent) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${goalName} is at risk`,
      body: 'A recent charge may affect your timeline. Tap to review.',
      data: { type: 'goal_at_risk', goalId, screen: 'Plan', tab: 'goals' },
    },
    trigger: null, // fire immediately
  });

  await SecureStore.setItemAsync(key, 'sent');
}

/** Call when a goal recovers (back_on_track) so the next at-risk event re-notifies. */
export async function clearGoalAtRiskKey(goalId: string): Promise<void> {
  await SecureStore.deleteItemAsync(atRiskKey(goalId));
}
```

- [ ] **Step 2: Update setupNotificationHandler in backgroundSync.ts to allow goal_at_risk notifications**

Open `budget-app/mobile/src/plaid/backgroundSync.ts`. Update `setupNotificationHandler` so `goal_at_risk` notifications also show banner/sound:

```typescript
export function setupNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const type = notification.request.content.data?.type;
      const show = type === 'budget_alert' || type === 'goal_at_risk';
      return {
        shouldShowBanner: show,
        shouldShowList: show,
        shouldPlaySound: show,
        shouldSetBadge: false,
      };
    },
  });

  return Notifications.addNotificationReceivedListener(async notification => {
    const itemId = notification.request.content.data?.itemId as string | undefined;
    if (!itemId) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const items = await database.get<PlaidItem>('plaid_items')
      .query(Q.where('user_id', user.id))
      .fetch();
    const item = items.find(i => i.itemId === itemId);
    if (item) await syncTransactions(item, user.id);
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add budget-app/mobile/src/goals/goalNotifications.ts \
        budget-app/mobile/src/plaid/backgroundSync.ts
git commit -m "feat: add goalNotifications — local push with SecureStore dedup"
```

---

## Task 6: Orchestrator + Wire into backgroundSync

**Files:**
- Create: `budget-app/mobile/src/goals/checkGoalFeasibility.ts`
- Create: `budget-app/mobile/src/goals/__tests__/checkGoalFeasibility.test.ts`
- Modify: `budget-app/mobile/src/plaid/backgroundSync.ts`

- [ ] **Step 1: Write the failing tests**

Create `budget-app/mobile/src/goals/__tests__/checkGoalFeasibility.test.ts`:

```typescript
import { checkGoalFeasibility } from '../checkGoalFeasibility';

// Mock Supabase
const mockGoals = [
  {
    id: 'g1', name: 'Emergency Fund', target_amount: 6000, current_amount: 1000,
    starting_amount: 1000, target_date: '2026-10-01', status: 'on_track',
  },
];
const mockIncome = [{ amount_monthly: 5000, is_confirmed: true }];
const mockBuckets = [
  { id: 'b1', name: 'Dining', target_pct: 12, monthly_floor: 0, monthly_limit: 600, priority_rank: null, is_goal: false },
];

const mockSupabaseFrom = jest.fn();
jest.mock('../../supabase/client', () => ({
  supabase: { auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    from: mockSupabaseFrom },
}));

// Mock WatermelonDB
jest.mock('../../db', () => ({ database: { get: jest.fn() } }));
import { database } from '../../db';

// Mock engines + notifications
jest.mock('../feasibilityEngine', () => ({
  runFeasibilityCheck: jest.fn().mockReturnValue([
    { goalId: 'g1', previousStatus: 'on_track', newStatus: 'at_risk', statusChanged: true,
      projectedSurplus: 100, shortfall: 400, monthlyContributionNeeded: 500, monthsLeft: 6 },
  ]),
}));
jest.mock('../goalNotifications', () => ({
  fireGoalAtRiskNotification: jest.fn(),
  clearGoalAtRiskKey: jest.fn(),
}));
jest.mock('../goalEvents', () => ({ writeGoalEvent: jest.fn() }));

import { fireGoalAtRiskNotification } from '../goalNotifications';
import { writeGoalEvent } from '../goalEvents';

beforeEach(() => {
  jest.clearAllMocks();
  // Set up Supabase chain mocks
  mockSupabaseFrom.mockImplementation((table: string) => {
    if (table === 'savings_goals') return { select: () => ({ eq: () => ({ data: mockGoals, error: null }) }) };
    if (table === 'income_sources') return { select: () => ({ eq: () => ({ data: mockIncome, error: null }) }) };
    if (table === 'budget_categories') return { select: () => ({ eq: () => ({ data: mockBuckets, error: null }) }) };
    return { update: () => ({ eq: () => ({ error: null }) }) };
  });
  // WatermelonDB mock returns transactions that imply some spend
  (database.get as jest.Mock).mockReturnValue({
    query: jest.fn().mockReturnValue({ fetch: jest.fn().mockResolvedValue([
      { amount: 500, pending: false, categoryL1: 'Dining', categoryL2: '' },
    ]) }),
  });
});

test('fires at-risk notification when goal flips at_risk', async () => {
  await checkGoalFeasibility('u1');
  expect(fireGoalAtRiskNotification).toHaveBeenCalledWith('Emergency Fund', 'g1');
});

test('writes goal_event when status changes', async () => {
  await checkGoalFeasibility('u1');
  expect(writeGoalEvent).toHaveBeenCalledWith(expect.objectContaining({
    goalId: 'g1', eventType: 'at_risk', trigger: 'sync',
  }));
});

test('does not fire notification when goal was already at_risk', async () => {
  // Simulate goal already at_risk and still at_risk (statusChanged: false)
  const { runFeasibilityCheck } = require('../feasibilityEngine');
  runFeasibilityCheck.mockReturnValueOnce([
    { goalId: 'g1', previousStatus: 'at_risk', newStatus: 'at_risk', statusChanged: false,
      projectedSurplus: 100, shortfall: 400, monthlyContributionNeeded: 500, monthsLeft: 6 },
  ]);
  await checkGoalFeasibility('u1');
  expect(fireGoalAtRiskNotification).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd budget-app/mobile
npx jest src/goals/__tests__/checkGoalFeasibility.test.ts --no-coverage 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../checkGoalFeasibility'`

- [ ] **Step 3: Implement the orchestrator**

Create `budget-app/mobile/src/goals/checkGoalFeasibility.ts`:

```typescript
import { Q } from '@nozbe/watermelondb';
import { database } from '../db';
import Transaction from '../db/models/Transaction';
import { supabase } from '../supabase/client';
import { runFeasibilityCheck, FeasibilityGoal, GoalStatus } from './feasibilityEngine';
import { writeGoalEvent } from './goalEvents';
import { fireGoalAtRiskNotification, clearGoalAtRiskKey } from './goalNotifications';

function currentMonthBounds(): { monthStart: string; monthEnd: string; daysElapsed: number; daysInMonth: number } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthStr = String(month + 1).padStart(2, '0');
  const nextMonth = month === 11 ? 1 : month + 2;
  const nextYear = month === 11 ? year + 1 : year;
  const nextMonthStr = String(nextMonth).padStart(2, '0');
  const monthStart = `${year}-${monthStr}-01`;
  const monthEnd = `${nextYear}-${nextMonthStr}-01`;
  const daysElapsed = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return { monthStart, monthEnd, daysElapsed, daysInMonth };
}

export async function checkGoalFeasibility(userId: string): Promise<void> {
  // 1. Load goals
  const { data: goalsData } = await supabase
    .from('savings_goals')
    .select('id, name, target_amount, current_amount, starting_amount, target_date, status')
    .eq('user_id', userId);
  if (!goalsData || goalsData.length === 0) return;

  // 2. Load confirmed monthly income
  const { data: incomeData } = await supabase
    .from('income_sources')
    .select('amount_monthly, is_confirmed')
    .eq('user_id', userId);
  const confirmedMonthlyIncome = (incomeData ?? [])
    .filter((s: any) => s.is_confirmed)
    .reduce((sum: number, s: any) => sum + s.amount_monthly, 0);

  // 3. Load budgets (for suggestion engine — needed in snapshot)
  const { data: bucketsData } = await supabase
    .from('budget_categories')
    .select('id, name, target_pct, monthly_floor, monthly_limit, priority_rank, is_goal')
    .eq('user_id', userId);

  // 4. Compute current month spend from WatermelonDB
  const { monthStart, monthEnd, daysElapsed, daysInMonth } = currentMonthBounds();
  const transactions = await database
    .get<Transaction>('transactions')
    .query(
      Q.where('user_id', userId),
      Q.where('date', Q.gte(monthStart)),
      Q.where('date', Q.lt(monthEnd)),
    )
    .fetch();

  const currentMonthSpend = transactions
    .filter(t => t.amount > 0 && !t.pending)
    .reduce((sum, t) => sum + t.amount, 0);

  // 5. Run feasibility engine
  const goals: FeasibilityGoal[] = goalsData.map((g: any) => ({
    id: g.id,
    targetAmount: g.target_amount,
    currentAmount: g.current_amount,
    startingAmount: g.starting_amount ?? 0,
    targetDate: g.target_date ?? null,
    status: g.status as GoalStatus,
  }));

  const results = runFeasibilityCheck({
    confirmedMonthlyIncome,
    currentMonthSpend,
    daysElapsed,
    daysInMonth,
    goals,
  });

  // 6. Handle each result
  for (const result of results) {
    const goal = goalsData.find((g: any) => g.id === result.goalId)!;

    // Update status in Supabase
    await supabase
      .from('savings_goals')
      .update({ status: result.newStatus, last_computed_at: new Date().toISOString() })
      .eq('id', result.goalId);

    if (!result.statusChanged) continue;

    // Write audit event
    await writeGoalEvent({
      userId,
      goalId: result.goalId,
      eventType: result.newStatus === 'on_track' ? 'back_on_track' : result.newStatus,
      trigger: 'sync',
      shortfall: result.shortfall,
      snapshot: {
        income: confirmedMonthlyIncome,
        projectedSurplus: result.projectedSurplus,
        shortfall: result.shortfall,
        contributionNeeded: result.monthlyContributionNeeded,
        monthsLeft: result.monthsLeft,
        buckets: bucketsData ?? [],
      },
    });

    // Fire notification or clear dedup key
    if (result.newStatus === 'at_risk') {
      await fireGoalAtRiskNotification(goal.name, goal.id);
    } else if (result.newStatus === 'on_track') {
      await clearGoalAtRiskKey(goal.id);
    }
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd budget-app/mobile
npx jest src/goals/__tests__/checkGoalFeasibility.test.ts --no-coverage 2>&1 | tail -15
```

Expected: 3 tests PASS.

- [ ] **Step 5: Wire into backgroundSync.ts**

Open `budget-app/mobile/src/plaid/backgroundSync.ts`. Add import at top:

```typescript
import { checkGoalFeasibility } from '../goals/checkGoalFeasibility';
```

In `syncStaleItems`, add the call after `checkBudgetAlerts`:

```typescript
export async function syncStaleItems() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await migrateAccessTokens();

  const items = await database.get<PlaidItem>('plaid_items')
    .query(Q.where('user_id', user.id))
    .fetch();
  const now = Date.now();

  for (const item of items) {
    const lastSync = item.lastSyncedAt ?? 0;
    if (now - lastSync > STALE_THRESHOLD_MS) {
      await syncTransactions(item, user.id);
    }
  }

  await detectIncomeSources().catch(() => {});
  await detectFixedItems().catch(() => {});
  await checkBudgetAlerts(user.id).catch(() => {});
  await checkGoalFeasibility(user.id).catch(() => {});
}
```

- [ ] **Step 6: Run full test suite to check for regressions**

```bash
cd budget-app/mobile
npx jest --no-coverage 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add budget-app/mobile/src/goals/checkGoalFeasibility.ts \
        budget-app/mobile/src/goals/__tests__/checkGoalFeasibility.test.ts \
        budget-app/mobile/src/plaid/backgroundSync.ts
git commit -m "feat: add checkGoalFeasibility orchestrator, wire into backgroundSync"
```

---

## Task 7: Update useGoals and useBudgets Types

**Files:**
- Modify: `budget-app/mobile/src/hooks/useGoals.ts`
- Modify: `budget-app/mobile/src/hooks/useBudgets.ts`

- [ ] **Step 1: Update useGoals.ts**

Open `budget-app/mobile/src/hooks/useGoals.ts`. Replace the entire file:

```typescript
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabase/client';
import { GoalStatus } from '../goals/feasibilityEngine';

export interface Goal {
  id: string;
  name: string;
  emoji: string;
  targetAmount: number;
  currentAmount: number;
  startingAmount: number;
  targetDate: string | null;
  status: GoalStatus;
  progressPercent: number;
  monthsLeft: number | null;
  monthlyContributionNeeded: number | null;
}

function toGoal(g: any): Goal {
  const progressPercent = g.target_amount > 0
    ? Math.min(100, Math.round((g.current_amount / g.target_amount) * 100))
    : 0;
  let monthsLeft: number | null = null;
  let monthlyContributionNeeded: number | null = null;
  if (g.target_date) {
    const months = Math.ceil(
      (new Date(g.target_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30)
    );
    monthsLeft = Math.max(0, months);
    if (monthsLeft > 0 && g.target_amount > g.current_amount) {
      monthlyContributionNeeded = (g.target_amount - g.current_amount) / monthsLeft;
    }
  }
  return {
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    targetAmount: g.target_amount,
    currentAmount: g.current_amount,
    startingAmount: g.starting_amount ?? 0,
    targetDate: g.target_date,
    status: (g.status as GoalStatus) ?? 'on_track',
    progressPercent,
    monthsLeft,
    monthlyContributionNeeded,
  };
}

export function useGoals(): { goals: Goal[]; reload: () => void } {
  const [goals, setGoals] = useState<Goal[]>([]);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('savings_goals')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at');
    if (data) setGoals(data.map(toGoal));
  }, []);

  useEffect(() => { load(); }, [load]);

  return { goals, reload: load };
}

export async function createGoal(
  name: string,
  emoji: string,
  targetAmount: number,
  startingAmount: number,
  targetDate: string | null
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await supabase.from('savings_goals').insert({
    user_id: user.id,
    name,
    emoji,
    target_amount: targetAmount,
    current_amount: startingAmount,
    starting_amount: startingAmount,
    target_date: targetDate || null,
    status: 'on_track',
  });
  if (error) throw error;
}

export async function updateGoalProgress(id: string, currentAmount: number): Promise<void> {
  const { error } = await supabase
    .from('savings_goals')
    .update({ current_amount: currentAmount })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteGoal(id: string): Promise<void> {
  const { error } = await supabase.from('savings_goals').delete().eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 2: Update useBudgets.ts — add priorityRank**

Open `budget-app/mobile/src/hooks/useBudgets.ts`. Add `priorityRank` to the interfaces and Supabase query:

In `BudgetCategory` interface, add after `isGoal`:
```typescript
priorityRank: number | null;
```

In `SupabaseBudget` interface, add after `is_goal`:
```typescript
priority_rank: number | null;
```

In the `result` mapping inside `useMemo`, add after `goalId`:
```typescript
priorityRank: cat.priority_rank ?? null,
```

In `loadCategories`, the `select('*')` already fetches all columns including `priority_rank` — no change needed there.

- [ ] **Step 3: Run tests to confirm no regressions**

```bash
cd budget-app/mobile
npx jest --no-coverage 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add budget-app/mobile/src/hooks/useGoals.ts \
        budget-app/mobile/src/hooks/useBudgets.ts
git commit -m "feat: add startingAmount/status to Goal type, priorityRank to BudgetCategory"
```

---

## Task 8: AddGoalModal — startingAmount field

**Files:**
- Modify: `budget-app/mobile/src/screens/PlanScreen.tsx` (AddGoalModal section, lines ~201–310)
- Modify: `budget-app/mobile/src/budget/goalAllocator.ts`

The `AddGoalModal` currently uses `current` state as the starting balance and passes it as `currentAmount`. We rename the field label and update the `createGoal` call signature.

- [ ] **Step 1: Update goalAllocator.ts — rename currentAmount to startingAmount in GoalInput**

Open `budget-app/mobile/src/budget/goalAllocator.ts`. In `GoalInput`:

```typescript
export interface GoalInput {
  name: string;
  targetAmount: number;
  startingAmount: number;  // renamed from currentAmount
  targetDate: string;
}
```

Find every usage of `goal.currentAmount` inside the file and replace with `goal.startingAmount`. There should be one in `previewGoalAllocation` and one in `commitGoalAllocation`.

In `commitGoalAllocation`, find the `createGoal` call and update the argument:
```typescript
await createGoal(goal.name, '🎯', goal.targetAmount, goal.startingAmount, goal.targetDate);
```

- [ ] **Step 2: Update AddGoalModal in PlanScreen.tsx**

Open `budget-app/mobile/src/screens/PlanScreen.tsx`.

Replace the label `SAVED SO FAR` with `ALREADY SAVED (starting balance)` — this is the only label change needed. The state variable `current` and its usage stays the same.

Find (around line 269):
```tsx
<Text style={m.label}>SAVED SO FAR</Text>
```

Replace with:
```tsx
<Text style={m.label}>ALREADY SAVED (STARTING BALANCE)</Text>
```

In `handlePreview` (around line 234), update the `previewGoalAllocation` call to use `startingAmount` instead of `currentAmount`:
```typescript
const p = previewGoalAllocation(
  { name: name.trim(), targetAmount: t, startingAmount: parseFloat(current) || 0, targetDate: targetDate.trim() },
  budgets,
  confirmedMonthlyIncome
);
```

In `handleConfirm` (around line 247), update `commitGoalAllocation`:
```typescript
await commitGoalAllocation(
  { name: name.trim(), targetAmount: parseFloat(target), startingAmount: parseFloat(current) || 0, targetDate: targetDate.trim() },
  preview,
  color
);
```

- [ ] **Step 3: Run tests**

```bash
cd budget-app/mobile
npx jest --no-coverage 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add budget-app/mobile/src/screens/PlanScreen.tsx \
        budget-app/mobile/src/budget/goalAllocator.ts
git commit -m "feat: rename currentAmount→startingAmount in goal creation flow"
```

---

## Task 9: Goal Card UI — Status Pill + Contribution Line + At-Risk Prompt

**Files:**
- Modify: `budget-app/mobile/src/screens/PlanScreen.tsx` (GoalsTab section, lines ~806–879)

- [ ] **Step 1: Replace GoalsTab in PlanScreen.tsx**

Open `budget-app/mobile/src/screens/PlanScreen.tsx`. Import `loadGoalEvents` and `GoalEvent` at the top of the file (with other imports):

```typescript
import { loadGoalEvents, GoalEvent } from '../goals/goalEvents';
```

Replace the entire `GoalsTab` function (lines ~806–879) with:

```typescript
// ─── Goals Tab ────────────────────────────────────────────────────────────────

function GoalStatusPill({ status }: { status: string }) {
  const config = {
    on_track:  { label: 'On track',  bg: '#14532d', text: '#4ade80' },
    at_risk:   { label: 'At risk',   bg: '#431407', text: '#fb923c' },
    completed: { label: 'Completed', bg: '#1e1b4b', text: '#818cf8' },
  }[status] ?? { label: status, bg: '#1e293b', text: '#94a3b8' };
  return (
    <View style={{ backgroundColor: config.bg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: config.text, fontSize: 10, fontWeight: '600', letterSpacing: 0.5 }}>{config.label.toUpperCase()}</Text>
    </View>
  );
}

function GoalCard({
  g, budgets, confirmedMonthlyIncome, onDeleted, onReload,
}: {
  g: import('../hooks/useGoals').Goal;
  budgets: ReturnType<typeof useBudgets>['budgets'];
  confirmedMonthlyIncome: number;
  onDeleted: () => void;
  onReload: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<GoalEvent[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const loadEvents = async () => {
    try { setEvents(await loadGoalEvents(g.id, 5)); } catch {}
  };

  const handleExpand = () => {
    if (!expanded) loadEvents();
    setExpanded(e => !e);
  };

  const handleDelete = () => {
    Alert.alert(`Delete "${g.name}"?`, 'This will redistribute its budget allocation back to other buckets.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
          await removeGoalAllocation(g.id, budgets);
          onDeleted();
        }
      },
    ]);
  };

  return (
    <View style={s.goalCard}>
      <TouchableOpacity onLongPress={handleDelete} activeOpacity={0.9}>
        <View style={s.goalCardRow}>
          <Text style={s.goalCardName}>{g.name}</Text>
          <GoalStatusPill status={g.status} />
        </View>

        <View style={s.barTrack}>
          <View style={[s.barFill, {
            width: `${Math.min(g.progressPercent / 100, 1) * 100}%`,
            backgroundColor: g.status === 'at_risk' ? '#fb923c' : '#6366f1',
          }]} />
        </View>

        <Text style={s.goalSub}>
          {fmt(g.currentAmount)} of {fmt(g.targetAmount)}
          {g.monthsLeft !== null ? ` · ~${g.monthsLeft}mo left` : ''}
        </Text>

        {g.monthlyContributionNeeded !== null && (
          <Text style={[s.goalSub, { marginTop: 2, color: '#64748b' }]}>
            Needs {fmt(g.monthlyContributionNeeded)}/mo
          </Text>
        )}

        {g.status === 'at_risk' && (
          <View style={{ marginTop: 8, padding: 10, backgroundColor: '#1c1012', borderRadius: 6, borderLeftWidth: 3, borderLeftColor: '#fb923c' }}>
            <Text style={{ color: '#fb923c', fontSize: 12, fontWeight: '600', marginBottom: 6 }}>
              This goal may fall behind schedule.
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#fb923c', borderRadius: 6, paddingVertical: 6, alignItems: 'center' }}
                onPress={() => setShowSuggestions(true)}
              >
                <Text style={{ color: '#0f0f0f', fontSize: 12, fontWeight: '700' }}>Adjust Budgets</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={handleExpand} style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Text style={{ color: '#475569', fontSize: 11 }}>{expanded ? '▲ Hide history' : '▼ Show history'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={{ marginTop: 6 }}>
          {events.length === 0 ? (
            <Text style={{ color: '#475569', fontSize: 11 }}>No events yet.</Text>
          ) : events.map(e => (
            <View key={e.id} style={{ paddingVertical: 4, borderTopWidth: 1, borderTopColor: '#1e293b' }}>
              <Text style={{ color: '#94a3b8', fontSize: 11 }}>
                {e.eventType === 'at_risk' ? `⚠️ Fell at risk — $${e.shortfall?.toFixed(0) ?? '?'} shortfall` :
                 e.eventType === 'back_on_track' ? '✓ Back on track' :
                 e.eventType === 'adjustment' ? `Budgets adjusted` :
                 '✓ Goal reached'}
                {' · '}
                {new Date(e.createdAt).toLocaleDateString()}
              </Text>
            </View>
          ))}
        </View>
      )}

      <SuggestionSheet
        visible={showSuggestions}
        onClose={() => setShowSuggestions(false)}
        goal={g}
        budgets={budgets}
        confirmedMonthlyIncome={confirmedMonthlyIncome}
        onApplied={onReload}
      />
    </View>
  );
}

function GoalsTab({ budgets, confirmedMonthlyIncome, onReload }: {
  budgets: ReturnType<typeof useBudgets>['budgets'];
  confirmedMonthlyIncome: number;
  onReload: () => void;
}) {
  const { goals, reload: reloadGoals } = useGoals();
  const [showGoalModal, setShowGoalModal] = useState(false);

  return (
    <View>
      {goals.length === 0 ? (
        <Text style={s.emptyHint}>No goals yet. Add one to see how it affects your budget.</Text>
      ) : (
        goals.map(g => (
          <GoalCard
            key={g.id}
            g={g}
            budgets={budgets}
            confirmedMonthlyIncome={confirmedMonthlyIncome}
            onDeleted={() => { reloadGoals(); onReload(); }}
            onReload={() => { reloadGoals(); onReload(); }}
          />
        ))
      )}
      <TouchableOpacity style={[s.addRowBtn, { marginTop: 12 }]} onPress={() => setShowGoalModal(true)}>
        <Text style={s.addRowBtnText}>+ Add Goal</Text>
      </TouchableOpacity>
      <AddGoalModal
        visible={showGoalModal}
        onClose={() => setShowGoalModal(false)}
        onSaved={() => { reloadGoals(); onReload(); }}
        budgets={budgets}
        confirmedMonthlyIncome={confirmedMonthlyIncome}
      />
    </View>
  );
}
```

- [ ] **Step 2: Run tests**

```bash
cd budget-app/mobile
npx jest --no-coverage 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add budget-app/mobile/src/screens/PlanScreen.tsx
git commit -m "feat: goal card status pill, contribution line, at-risk prompt, history section"
```

---

## Task 10: Suggestion Sheet

**Files:**
- Modify: `budget-app/mobile/src/screens/PlanScreen.tsx` (add SuggestionSheet component before GoalsTab)

- [ ] **Step 1: Add SuggestionSheet component**

Open `budget-app/mobile/src/screens/PlanScreen.tsx`. Add the following imports at the top with the other imports:

```typescript
import { computeSuggestions, BudgetCut } from '../goals/suggestionEngine';
import { writeGoalEvent } from '../goals/goalEvents';
```

Insert the `SuggestionSheet` component just before the `GoalStatusPill` function (before the `GoalsTab` section):

```typescript
// ─── Suggestion Sheet ─────────────────────────────────────────────────────────

function SuggestionSheet({
  visible, onClose, goal, budgets, confirmedMonthlyIncome, onApplied,
}: {
  visible: boolean;
  onClose: () => void;
  goal: import('../hooks/useGoals').Goal;
  budgets: ReturnType<typeof useBudgets>['budgets'];
  confirmedMonthlyIncome: number;
  onApplied: () => void;
}) {
  const [applying, setApplying] = useState(false);

  const suggestionBuckets = budgets.map(b => ({
    id: b.id,
    name: b.name,
    targetPct: b.targetPct ?? 0,
    monthlyFloor: b.monthlyFloor,
    monthlyLimit: b.monthlyLimit,
    priorityRank: b.priorityRank,
    isGoal: b.isGoal,
  }));

  const { cuts, timelineExtensionMonths } = computeSuggestions({
    shortfall: goal.monthlyContributionNeeded
      ? Math.max(0, goal.monthlyContributionNeeded - (confirmedMonthlyIncome * 0.1))
      : 0,
    buckets: suggestionBuckets,
    confirmedMonthlyIncome,
    goalMonthlyContribution: goal.monthlyContributionNeeded ?? 0,
    monthsLeft: goal.monthsLeft ?? 0,
  });

  const handleAutoApply = async () => {
    setApplying(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await Promise.all(
        cuts.map(cut =>
          supabase
            .from('budget_categories')
            .update({ target_pct: Math.round(cut.suggestedPct * 100) / 100 })
            .eq('id', cut.bucketId)
        )
      );

      await writeGoalEvent({
        userId: user.id,
        goalId: goal.id,
        eventType: 'adjustment',
        trigger: 'manual',
        shortfall: 0,
        snapshot: {
          cuts: cuts.map(c => ({
            bucket_id: c.bucketId,
            bucket_name: c.bucketName,
            old_pct: c.currentPct,
            new_pct: c.suggestedPct,
            cut_amount: c.cutAmount,
            reason: c.reason,
          })),
        },
      });

      onApplied();
      onClose();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setApplying(false);
    }
  };

  const handleExtendTimeline = async () => {
    if (!goal.targetDate || timelineExtensionMonths <= 0) return;
    const current = new Date(goal.targetDate);
    current.setMonth(current.getMonth() + timelineExtensionMonths);
    const newDate = current.toISOString().split('T')[0];
    const { error } = await supabase
      .from('savings_goals')
      .update({ target_date: newDate })
      .eq('id', goal.id);
    if (!error) { onApplied(); onClose(); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#0f172a', padding: 24 }}>
        <View style={{ width: 36, height: 4, backgroundColor: '#334155', borderRadius: 2, alignSelf: 'center', marginBottom: 20 }} />
        <Text style={{ color: '#f1f5f9', fontSize: 17, fontWeight: '700', marginBottom: 4 }}>
          To stay on track for {goal.name}:
        </Text>

        {cuts.length === 0 ? (
          <Text style={{ color: '#64748b', marginTop: 12 }}>Not enough slack in your budgets to cover the shortfall. Consider extending the timeline.</Text>
        ) : (
          <>
            <Text style={{ color: '#64748b', fontSize: 12, marginBottom: 12, marginTop: 4 }}>SUGGESTED BUDGET CUTS</Text>
            {cuts.map(cut => (
              <View key={cut.bucketId} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1e293b' }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: '#f1f5f9', fontSize: 14, fontWeight: '600' }}>{cut.bucketName}</Text>
                  <Text style={{ color: '#fb923c', fontSize: 14 }}>−{fmt(cut.cutAmount)}</Text>
                </View>
                <Text style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>{cut.reason}</Text>
                <Text style={{ color: '#475569', fontSize: 11 }}>
                  {cut.currentPct.toFixed(1)}% → {cut.suggestedPct.toFixed(1)}% of income
                </Text>
              </View>
            ))}

            <TouchableOpacity
              style={{ backgroundColor: '#6366f1', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 20 }}
              onPress={handleAutoApply}
              disabled={applying}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
                {applying ? 'Applying…' : 'Apply These Cuts'}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {timelineExtensionMonths > 0 && (
          <TouchableOpacity
            style={{ borderWidth: 1, borderColor: '#334155', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 12 }}
            onPress={handleExtendTimeline}
          >
            <Text style={{ color: '#94a3b8', fontWeight: '600', fontSize: 14 }}>
              Extend timeline by {timelineExtensionMonths} month{timelineExtensionMonths > 1 ? 's' : ''} instead
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity onPress={onClose} style={{ marginTop: 16, alignItems: 'center' }}>
          <Text style={{ color: '#475569', fontSize: 14 }}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}
```

- [ ] **Step 2: Run tests**

```bash
cd budget-app/mobile
npx jest --no-coverage 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add budget-app/mobile/src/screens/PlanScreen.tsx
git commit -m "feat: add SuggestionSheet — budget cuts list, auto-apply, extend timeline"
```

---

## Task 11: Final Check and PR

- [ ] **Step 1: Run full test suite**

```bash
cd budget-app/mobile
npx jest --no-coverage 2>&1 | tail -25
```

Expected: all tests PASS, no failures.

- [ ] **Step 2: TypeScript check**

```bash
cd budget-app/mobile
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin feat/goal-feasibility-engine
gh pr create \
  --base main \
  --head feat/goal-feasibility-engine \
  --title "feat: goal feasibility engine — auto-track progress, notify at-risk, suggest cuts" \
  --body "Closes #33

## What this adds
- Client-side feasibility engine runs after every Plaid sync
- Goals marked on_track / at_risk / completed automatically
- Local push notification when a goal flips at-risk (deduped per month)
- Suggestion engine: cut list sorted by priority rank + slack, with explanation labels
- Auto-apply cuts or extend timeline from the suggestion sheet
- Transparency log: goal_events table, expandable history on each goal card
- DB migration: starting_amount + status on savings_goals, priority_rank on budget_categories, new goal_events table"
```
