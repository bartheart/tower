# Goals Feasibility & Suggestion Engine — Design Spec

## Overview

When a user sets a savings goal, the app needs to tell them whether their current spending trajectory will let them hit it on time. This system does that automatically in the background: every time a background sync completes, it reads the user's confirmed income, projects their monthly spend from real transactions, runs a feasibility check against every active goal, and if anything changed it writes an audit event, updates the goal's status in Supabase, and fires a push notification. If a goal flips to `at_risk`, a companion suggestion engine computes which budget categories to trim and by how much to close the shortfall.

No new screens — status feeds into the existing Plan tab goal list and any sheet that calls `useGoals`. The audit log feeds the goal timeline view via `loadGoalEvents`.

---

## Motivation

Without automated checking, users only see a static progress bar and have no indication when their spending pattern has made their goal unreachable by the target date. They also have no actionable guidance on what to cut. This system closes both gaps.

Issue #66: 30-day month approximation in `monthsUntil`. Issue #69: `timelineExtensionMonths` can return `Infinity` or `NaN`.

---

## Architecture

| File | Responsibility |
|------|---------------|
| `goals/feasibilityEngine.ts` | Pure function. Takes income, spend, and goals; returns a `GoalFeasibilityResult[]`. No I/O. |
| `goals/checkGoalFeasibility.ts` | Orchestrator. Reads Supabase (`savings_goals`, `income_sources`, `budget_categories`) and WatermelonDB (transactions). Calls the engine, writes results back to Supabase, calls `writeGoalEvent` and notification helpers. Triggered by `backgroundSync`. |
| `goals/suggestionEngine.ts` | Pure function. Takes a shortfall and a list of budget buckets; returns an ordered list of cuts and a timeline extension estimate. |
| `goals/goalEvents.ts` | Thin Supabase wrapper. `writeGoalEvent` inserts a row; `loadGoalEvents` reads them ordered by `created_at DESC`. Used by PlanScreen to render the goal history timeline. |
| `goals/goalNotifications.ts` | Fires an immediate Expo push notification when a goal flips to `at_risk`. Uses `SecureStore` to dedup within the calendar month. |
| `hooks/useGoals.ts` | React hook. Fetches `savings_goals` from Supabase on mount; re-fetches on `reload()`. Owns `createGoal`, `updateGoalProgress`, `deleteGoal` helpers. Derives `progressPercent`, `monthsLeft`, and `monthlyContributionNeeded` client-side. |

Data flow:

```
backgroundSync
  └─ checkGoalFeasibility(userId)
        ├─ supabase: savings_goals, income_sources, budget_categories
        ├─ WatermelonDB: transactions (current month, settled)
        ├─ runFeasibilityCheck(input) → GoalFeasibilityResult[]
        └─ per result:
              ├─ supabase.update savings_goals { status, last_computed_at }
              ├─ writeGoalEvent(...)            [only on statusChanged]
              └─ fireGoalAtRiskNotification()   [only on statusChanged]
                 or clearGoalAtRiskKey()
```

`computeSuggestions` is called separately by the UI (Plan tab) when it needs to show cut recommendations for an `at_risk` goal. It is not called by `checkGoalFeasibility`.

---

## Data Model

### `GoalStatus`

```typescript
export type GoalStatus = 'on_track' | 'at_risk' | 'completed';
```

### `FeasibilityGoal`

```typescript
export interface FeasibilityGoal {
  id: string;
  targetAmount: number;
  currentAmount: number;
  startingAmount: number;
  targetDate: string | null;  // ISO date string, or null for aspirational goals
  status: GoalStatus;
}
```

### `FeasibilityInput`

```typescript
export interface FeasibilityInput {
  confirmedMonthlyIncome: number;
  currentMonthSpend: number;
  daysElapsed: number;
  daysInMonth: number;
  priorMonthSpend?: number;  // used as fallback when daysElapsed === 0
  goals: FeasibilityGoal[];
}
```

### `GoalFeasibilityResult`

```typescript
export interface GoalFeasibilityResult {
  goalId: string;
  previousStatus: GoalStatus;
  newStatus: GoalStatus;
  statusChanged: boolean;
  projectedSurplus: number;
  shortfall: number;                  // 0 if feasible
  monthlyContributionNeeded: number;
  monthsLeft: number | null;          // null for aspirational goals (no targetDate)
}
```

### `BudgetCut`

```typescript
export interface BudgetCut {
  bucketId: string;
  bucketName: string;
  currentPct: number;
  suggestedPct: number;
  cutAmount: number;
  reason: string;  // e.g. "ranked #2 — lower priority" or "$400 headroom above floor"
}
```

### `SuggestionInput`

```typescript
export interface SuggestionInput {
  shortfall: number;
  buckets: SuggestionBucket[];
  confirmedMonthlyIncome: number;
  goalMonthlyContribution?: number;
  projectedSurplus?: number;
  monthsLeft?: number;
}
```

### `GoalEvent`

```typescript
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
```

### `Goal` (hook shape)

```typescript
export interface Goal {
  id: string;
  name: string;
  emoji: string;
  targetAmount: number;
  currentAmount: number;
  startingAmount: number;
  targetDate: string | null;
  status: GoalStatus;
  progressPercent: number;        // clamped 0–100
  monthsLeft: number | null;      // null if no targetDate
  monthlyContributionNeeded: number | null;
}
```

---

## Feasibility Engine

**File:** `goals/feasibilityEngine.ts`

### Projected spend

```
baseSpend = daysElapsed > 0
  ? (currentMonthSpend / daysElapsed) × daysInMonth
  : priorMonthSpend
```

When the sync runs on the first day of the month (`daysElapsed === 0`), it falls back to `priorMonthSpend` (which `checkGoalFeasibility` does not currently supply — it defaults to `0`, making the first-day projection optimistic).

```
projectedSurplus = confirmedMonthlyIncome - baseSpend
```

### Total contribution needed

Summed across all goals that have a future `targetDate` and are not yet complete:

```
totalContributionNeeded = Σ (targetAmount - currentAmount) / monthsUntil(targetDate)
```

Goals that are overdue (`monthsLeft <= 0`) or already complete are excluded from this sum.

### Per-goal status

| Condition | `newStatus` | `shortfall` | `monthsLeft` |
|-----------|-------------|-------------|--------------|
| `currentAmount >= targetAmount` | `completed` | `0` | `0` |
| `targetDate` is null | unchanged (never `completed`) | `0` | `null` |
| `monthsLeft <= 0` | `at_risk` | `targetAmount - currentAmount` | `0` |
| `confirmedMonthlyIncome > 0` and `projectedSurplus >= totalContributionNeeded` | `on_track` | `0` | computed |
| otherwise | `at_risk` | `totalContributionNeeded - projectedSurplus` | computed |

Feasibility is evaluated against the **total** contribution across all goals, not per-goal. If the projected surplus cannot cover the combined monthly contribution needed, every goal that requires contributions is marked `at_risk`.

### `monthsUntil` — known issue (issue #66)

```typescript
function monthsUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30));
}
```

This uses a hardcoded 30-day month. It does not account for actual calendar month lengths (28–31 days). A goal with a target date of 2026-02-28 evaluated mid-January will have its months counted too optimistically. The correct approach is calendar-aware month differencing (e.g. using `date-fns` `differenceInCalendarMonths`). The same 30-day approximation is duplicated in `useGoals.ts` (`toGoal`), so both need to be fixed together.

---

## checkGoalFeasibility

**File:** `goals/checkGoalFeasibility.ts`

**Trigger:** Called by `backgroundSync` with the authenticated `userId`.

### Steps

1. **Load goals** — `supabase.from('savings_goals').select(...).eq('user_id', userId)`. Returns early if no goals.
2. **Load confirmed income** — `supabase.from('income_sources').select('amount_monthly, is_confirmed').eq('user_id', userId)`. Sums `amount_monthly` for rows where `is_confirmed` is true.
3. **Load budget categories** (snapshot only) — `supabase.from('budget_categories').select(...)`. Not used by the engine; passed into the `snapshot` field of `goal_events` for audit purposes.
4. **Compute current month spend** — WatermelonDB query on the `transactions` table, filtered to the current calendar month (`date >= monthStart` and `date < monthEnd`), settled only (`!t.pending`), debits only (`t.amount > 0`). Month bounds are computed from `new Date()` using actual calendar days.
5. **Run engine** — `runFeasibilityCheck(input)`.
6. **Handle each result:**
   - Always: `supabase.update savings_goals { status, last_computed_at }`.
   - Skip the rest if `statusChanged === false`.
   - Write audit event via `writeGoalEvent` with `trigger: 'sync'`.
   - If `newStatus === 'at_risk'`: call `fireGoalAtRiskNotification(goal.name, goal.id)`.
   - If `newStatus === 'on_track'`: call `clearGoalAtRiskKey(goal.id)`.

### Snapshot written to `goal_events`

```typescript
{
  income: confirmedMonthlyIncome,
  projectedSurplus: result.projectedSurplus,
  shortfall: result.shortfall,
  contributionNeeded: result.monthlyContributionNeeded,
  monthsLeft: result.monthsLeft,
  buckets: bucketsData ?? [],  // full budget_categories rows
}
```

### Event type mapping

| `newStatus` | `eventType` written |
|-------------|---------------------|
| `at_risk` | `'at_risk'` |
| `on_track` | `'back_on_track'` |
| `completed` | `'completed'` |

---

## Suggestion Engine

**File:** `goals/suggestionEngine.ts`

### Eligibility filter

Buckets are eligible for cuts if:
- `isGoal === false` — goal-allocated buckets are never cut.
- `monthlyFloor < monthlyLimit` — there is slack to absorb a cut.

### Prioritization

Eligible buckets are sorted in cut order:

1. **Unranked buckets** (`priorityRank === null`) come first, sorted by `slack DESC` (most headroom first).
2. **Ranked buckets** come after, sorted by `priorityRank DESC` (higher rank number = lower priority = cut sooner).

### Cut calculation

The engine iterates through sorted buckets and takes the minimum of available slack and remaining shortfall until the shortfall is covered or buckets are exhausted.

```
cutPct = (cutAmount / confirmedMonthlyIncome) × 100
suggestedPct = max(0, bucket.targetPct - cutPct)
```

`reason` field:
- Ranked bucket: `"ranked #N — lower priority"`
- Unranked bucket: `"$N headroom above floor"` (N = `Math.round(bucket.slack)`)

### Timeline extension

```
timelineExtensionMonths = Math.ceil(amountStillNeeded / affordable)
```

Where:
- `affordable = max(0, projectedSurplus)`
- `amountStillNeeded = goalMonthlyContribution × monthsLeft - affordable × monthsLeft`

This estimates how many additional months the goal timeline would need to extend if the user keeps their current surplus without making any budget cuts.

**Known issue (issue #69):** When `affordable === 0` (zero projected surplus), `timelineExtensionMonths` is set to `monthsLeft`, which is a stand-in that is often meaningless. More critically, the `amountStillNeeded / affordable` division is not reached in the zero case only because of the `else if (affordable === 0)` branch — but the general formula can produce `Infinity` if the guard conditions are wrong or if callers pass `projectedSurplus: 0` and `goalMonthlyContribution > 0` through a code path that reaches the division. The `SuggestionResult.timelineExtensionMonths` type is `number`, which accepts `Infinity`, and nothing in the UI currently guards against rendering it.

### `SuggestionResult`

```typescript
export interface SuggestionResult {
  cuts: BudgetCut[];
  coverableShortfall: number;   // sum of all cutAmount values
  timelineExtensionMonths: number;
}
```

---

## goalEvents

**File:** `goals/goalEvents.ts`

### Write

`writeGoalEvent` inserts one row into `goal_events`:

| Column | Value |
|--------|-------|
| `user_id` | caller-supplied |
| `goal_id` | goal UUID |
| `event_type` | one of `at_risk`, `back_on_track`, `adjustment`, `completed` |
| `trigger` | `sync` or `manual` |
| `shortfall` | dollar shortfall at time of event |
| `snapshot` | JSONB — income, surplus, shortfall, contribution, monthsLeft, buckets array |

Throws on Supabase error (not silenced).

### Read

`loadGoalEvents(goalId, limit = 10)` returns rows ordered by `created_at DESC`. The `adjustment` and `completed` event types exist in the type definition but are not yet written by any production caller — `checkGoalFeasibility` only writes `at_risk` and `back_on_track`.

### PlanScreen usage

PlanScreen calls `loadGoalEvents(goal.id)` to render a timeline of past status changes for a selected goal. Each event displays its `eventType`, `createdAt`, and `snapshot.shortfall`.

---

## goalNotifications

**File:** `goals/goalNotifications.ts`

### Dedup key format

```
goalAtRisk:<YYYY-MM>:<goalId>
```

Example: `goalAtRisk:2026-05:abc123-def456`

The `YYYY-MM` component is derived from `new Date()` at the time of the notification call, not at the time of the sync. Keys are stored in `expo-secure-store`.

### Dedup behavior

- Before scheduling a notification, `fireGoalAtRiskNotification` checks `SecureStore.getItemAsync(key)`.
- If the key exists (`'sent'`), the function returns without firing.
- If the key does not exist, the notification is scheduled and the key is set to `'sent'`.
- When a goal recovers (`back_on_track`), `clearGoalAtRiskKey` calls `SecureStore.deleteItemAsync(key)`. This means a goal that goes `at_risk → on_track → at_risk` within the same calendar month will re-notify on the second flip.

### Notification payload

```typescript
{
  content: {
    title: `${goalName} is at risk`,
    body: 'A recent charge may affect your timeline. Tap to review.',
    data: {
      type: 'goal_at_risk',
      goalId: string,
      screen: 'Plan',
      tab: 'goals',
    },
  },
  trigger: null,  // fire immediately
}
```

No scheduled delay — `trigger: null` means the notification fires as soon as it is scheduled.

---

## useGoals Hook

**File:** `hooks/useGoals.ts`

Fetches `savings_goals` on mount and exposes `{ goals, reload }`. The `toGoal` mapping function derives display fields client-side:

- `progressPercent`: `min(100, round(currentAmount / targetAmount × 100))`
- `monthsLeft`: computed with the same 30-day approximation as the engine (issue #66), clamped to `max(0, months)`
- `monthlyContributionNeeded`: `(targetAmount - currentAmount) / monthsLeft` when `monthsLeft > 0`

Goals are ordered by `created_at ASC`.

Mutation helpers (`createGoal`, `updateGoalProgress`, `deleteGoal`) are plain async functions, not hook methods. Callers must call `reload()` manually after mutations to refresh state.

---

## Known Issues

### Issue #66 — 30-day month approximation

`monthsUntil` in `feasibilityEngine.ts` and the parallel calculation in `useGoals.ts` (`toGoal`) both divide by `1000 * 60 * 60 * 24 * 30`. This produces month counts that drift from real calendar months. Goals near month boundaries (e.g. February) will have their feasibility and required contribution calculated incorrectly. Fix: replace with `differenceInCalendarMonths` from `date-fns` or equivalent, and share the implementation between `feasibilityEngine.ts` and `useGoals.ts`.

### Issue #69 — NaN/Infinity in `timelineExtensionMonths`

The `computeSuggestions` function returns `timelineExtensionMonths: number`, but the value can be `Infinity` if the formula branches are reached with `affordable === 0` through an edge case not covered by the `else if` guard, or if callers pass unexpected combinations of `projectedSurplus` and `goalMonthlyContribution`. The UI currently has no guard against rendering `Infinity`. Additionally, the intermediate value `amountStillNeeded` can be zero or negative when the current surplus already covers the goal amount — this produces a nonsensical `timelineExtensionMonths` of `0` even when the goal is `at_risk`.

---

## Test Coverage

### `feasibilityEngine.test.ts` — 8 tests

| Test | What it covers |
|------|---------------|
| `on_track when surplus covers contribution` | Happy path: extrapolated spend leaves enough surplus |
| `at_risk when surplus < contributions needed` | Low income triggers at_risk |
| `completed when currentAmount >= targetAmount` | Completion detection |
| `skips feasibility for no targetDate` | Aspirational goals are passed through |
| `at_risk when income is zero` | Zero income edge case |
| `uses prior month spend when daysElapsed is 0` | First-day-of-month fallback |
| `at_risk when overdue (monthsLeft <= 0)` | Past target date |
| `status stays at_risk if already at_risk` | `statusChanged: false` when no flip |

Not tested: multiple goals competing for the same surplus (totalContributionNeeded across N goals), goals where `startingAmount > 0`, the exact `shortfall` arithmetic for partial surplus coverage.

### `checkGoalFeasibility.test.ts` — 3 tests

| Test | What it covers |
|------|---------------|
| `fires at-risk notification when goal flips at_risk` | Notification called with correct goal name and id |
| `writes goal_event when status changes` | `writeGoalEvent` called with correct eventType and trigger |
| `does not fire notification when already at_risk` | No notification on no-op (statusChanged: false) |

Not tested: `clearGoalAtRiskKey` called on recovery, `completed` status handling, Supabase update failure, no goals early-return path, WatermelonDB query filtering of pending transactions.

### `suggestionEngine.test.ts` — 7 tests

| Test | What it covers |
|------|---------------|
| `excludes goal buckets from suggestions` | `isGoal: true` buckets never appear in cuts |
| `excludes buckets with no slack above floor` | `monthlyFloor === monthlyLimit` excluded |
| `cuts unranked buckets before ranked ones` | Sort order: null priority before numeric |
| `cuts most slack first among unranked buckets` | Secondary sort within unranked group |
| `sum of cuts >= shortfall when enough slack exists` | `coverableShortfall` covers the full shortfall |
| `reason label says "ranked #N" for ranked buckets` | Reason string format for ranked buckets |
| `reason label says headroom for unranked buckets` | Reason string format for unranked buckets |
| `computes timelineExtensionMonths > 0 when shortfall exists` | Extension computed when surplus < contribution |

Not tested: `timelineExtensionMonths` when `affordable === 0` (the Infinity case), `coverableShortfall` when total slack is less than shortfall (partial coverage), `suggestedPct` clamping to `0` when cut exceeds `targetPct`, zero `confirmedMonthlyIncome` guard for `cutPct`.

### Not tested at all

- `goalEvents.ts` — `writeGoalEvent` and `loadGoalEvents` have no unit tests.
- `goalNotifications.ts` — `fireGoalAtRiskNotification` (SecureStore dedup) and `clearGoalAtRiskKey` have no unit tests.
- `useGoals.ts` — `toGoal` mapping, `progressPercent` clamping, and all mutation helpers have no unit tests.

---

## Out of Scope

- Manual goal adjustment events (`eventType: 'adjustment'`) — the type exists but no caller writes it yet.
- Goal-specific contribution tracking from linked accounts — `currentAmount` is updated manually via `updateGoalProgress`.
- Suggestion UI — `computeSuggestions` is implemented and tested but the Plan tab UI for displaying cuts is not part of this feature unit.
- Push notification permission request flow — `goalNotifications.ts` assumes permission has already been granted elsewhere.
