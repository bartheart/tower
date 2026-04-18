# Goal Feasibility Engine — Design Spec

**Goal:** Replace manual goal progress updates with an automatic engine that computes — after every Plaid sync — whether the user can still hit each savings goal by its target date, notifies them when a goal falls at-risk, and suggests or auto-applies budget cuts to get back on track.

**Architecture:** Client-side feasibility computation using on-device WatermelonDB data (fast, no round-trip). If a goal flips at-risk, the app writes a `goal_event` to Supabase (audit log) and fires a local push notification. Supabase is the persistence layer for events and status — not the computation layer.

**Tech Stack:** React Native (Expo), WatermelonDB (transaction/account source), Supabase (goal status + event log), `expo-notifications` (local push), TypeScript.

---

## Table of Contents

1. [Data Model](#1-data-model)
2. [Feasibility Engine](#2-feasibility-engine)
3. [Suggestion Engine](#3-suggestion-engine)
4. [Auto-Rebalance](#4-auto-rebalance)
5. [Notification Flow](#5-notification-flow)
6. [Transparency Log](#6-transparency-log)
7. [UI Changes](#7-ui-changes)
8. [Backlog](#8-backlog)

---

## 1. Data Model

### Changes to `savings_goals`

| Column | Type | Notes |
|---|---|---|
| `starting_amount` | numeric(10,2) default 0 | User-provided at goal creation — "I already have $X toward this" |
| `status` | text default `'on_track'` | `'on_track' \| 'at_risk' \| 'completed'` |
| `last_computed_at` | timestamptz nullable | Timestamp of last feasibility check |

`current_amount` (already exists) continues to represent the total accumulated toward the goal. The engine updates it each month by crediting the confirmed surplus contribution.

**monthly_contribution_needed** is computed app-side:
```
(target_amount - current_amount) / months_remaining
```

### Changes to `budget_categories`

| Column | Type | Notes |
|---|---|---|
| `priority_rank` | int nullable | 1 = highest priority (cut last). null = unranked (treated as lowest). Driven by list order in UI. |

### New Table: `goal_events`

Records every goal status change and budget adjustment for the transparency log.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | gen_random_uuid() |
| `user_id` | uuid FK → users | RLS enforced |
| `goal_id` | uuid FK → savings_goals | |
| `event_type` | text | `'at_risk' \| 'back_on_track' \| 'adjustment' \| 'completed'` |
| `trigger` | text | `'sync' \| 'manual'` |
| `shortfall` | numeric(10,2) nullable | How much surplus was missing when event fired |
| `snapshot` | jsonb | See snapshot schema below |
| `created_at` | timestamptz | default now() |

**Snapshot schema** (stored in `snapshot` jsonb):
```json
{
  "income": 5200,
  "projected_spend": 4800,
  "projected_surplus": 400,
  "contribution_needed": 500,
  "adjustments": [
    {
      "bucket_id": "...",
      "bucket_name": "Dining",
      "old_pct": 12,
      "new_pct": 9,
      "cut_amount": 156,
      "reason": "ranked lowest priority",
      "rank": null
    }
  ],
  "timeline_extension_months": 2
}
```

---

## 2. Feasibility Engine

Runs client-side immediately after every `syncTransactions` call completes. Pure function — no side effects — returns a result the caller uses to decide whether to write events or fire notifications.

### Algorithm

```
Input:
  confirmedMonthlyIncome   — from income_sources (Supabase, already loaded)
  currentMonthSpend        — SUM(transactions.amount WHERE amount > 0 AND date >= start_of_month)
  daysElapsed              — today.date - start_of_month + 1
  daysInMonth              — calendar days in current month
  goals[]                  — from savings_goals (Supabase)
  buckets[]                — from budget_categories (Supabase)

Computation:
  projectedMonthlySpend  = currentMonthSpend / daysElapsed * daysInMonth
  projectedSurplus       = confirmedMonthlyIncome - projectedMonthlySpend
  totalContributionNeeded = SUM(goal.monthly_contribution_needed for each active goal)
  shortfall              = totalContributionNeeded - projectedSurplus  (0 if surplus ≥ needed)

Per goal:
  monthsRemaining        = months between today and goal.target_date
  monthly_contribution   = (goal.target_amount - goal.current_amount) / monthsRemaining
  feasible               = projectedSurplus >= totalContributionNeeded

Output:
  { feasible: boolean, shortfall: number, projectedSurplus: number }
```

### Status Transitions

| Previous status | Feasible? | New status | Action |
|---|---|---|---|
| `on_track` | yes | `on_track` | no-op |
| `on_track` | no | `at_risk` | write goal_event, fire notification |
| `at_risk` | yes | `on_track` | write goal_event (back_on_track) |
| `at_risk` | no | `at_risk` | no-op (already notified) |
| any | current_amount ≥ target_amount | `completed` | write goal_event |

Re-notification is suppressed if the goal is already `at_risk` — the user only gets notified on the flip, not on every sync.

### Edge Cases

- **No target_date:** skip feasibility check. Goal is purely aspirational — show `monthly_contribution_needed` as advisory only.
- **Days elapsed = 0** (first day of month): use prior month's spend as baseline. If no prior data, skip.
- **confirmedMonthlyIncome = 0:** mark all goals `at_risk` with `shortfall = totalContributionNeeded`.
- **monthsRemaining ≤ 0:** goal is overdue — mark `at_risk`, suggest immediate lump-sum needed.

---

## 3. Suggestion Engine

Runs only when `shortfall > 0`. Produces an ordered list of budget cuts that sum to ≥ shortfall. Purely advisory — does not write anything until the user accepts.

### Bucket Eligibility

A bucket is eligible for a cut suggestion if:
- `is_goal = false` (don't cut other goal buckets)
- `monthly_floor < current_allocated_amount` (has slack above its floor)
- `target_pct > 0`

### Sort Order

```
1. priority_rank ASC NULLS LAST   — unranked buckets treated as lowest priority (cut first)
2. slack DESC                      — within same rank, cut the one with most headroom first
   where slack = allocated_amount - monthly_floor
```

### Cut Calculation

Walk the sorted list, cutting each bucket down toward its floor until shortfall is covered:

```
remaining_shortfall = shortfall
for each eligible bucket (sorted):
  available_cut = allocated_amount - monthly_floor
  cut = MIN(available_cut, remaining_shortfall)
  suggest: reduce bucket by cut (new_pct = (allocated_amount - cut) / income * 100)
  remaining_shortfall -= cut
  if remaining_shortfall <= 0: break
```

### Explanation Label (per suggestion)

```
if bucket.priority_rank is not null:
  "You ranked this #N — lowest priority"
else:
  "$X of headroom above your floor"
```

### Two Resolution Options

Both are computed and presented side-by-side:

**Option A — Cut budgets:**
The cut list above, totalling ≥ shortfall.

**Option B — Extend timeline:**
```
months_to_extend = CEIL(shortfall / (projectedSurplus / totalContributionNeeded * monthly_contribution))
```
Shown as: "Push your [goal] deadline back N months to [new date]."

If extending by > 12 months, suggest both options simultaneously and let the user decide.

---

## 4. Auto-Rebalance

Applies the suggestion engine's cuts directly to `budget_categories.target_pct` in Supabase without requiring the user to step through each suggestion manually.

### Flow

1. User taps "Auto-adjust budgets" on the at-risk prompt
2. Suggestion engine runs, produces cut list
3. App shows a confirmation sheet: "We'll make these N adjustments — you can undo any of them"
4. On confirm: write all `target_pct` updates to Supabase in a single batch
5. Write one `goal_event` of type `adjustment` with `trigger: 'sync'` and full snapshot
6. Show "Adjusted" badge on each modified bucket in the list

### Undo

Each `goal_event` snapshot contains old and new values. "Undo" restores the previous `target_pct` values and writes a new `goal_event` with `event_type: 'adjustment'` and `trigger: 'manual'` noting the revert.

---

## 5. Notification Flow

### Trigger

Fires when a goal transitions `on_track → at_risk`. Uses `expo-notifications` local push (already in the project for budget alerts).

### Notification content

```
Title: "[Goal name] is at risk"
Body:  "A recent charge may affect your timeline. Tap to review."
Data:  { screen: 'Plan', tab: 'goals', goalId: '...' }
```

### Deep-link handling

Tapping the notification opens `PlanScreen` on the Goals tab with the at-risk goal card scrolled into view and expanded.

### Suppression

- Already `at_risk`: no repeat notification until status recovers then drops again.
- Goal has no `target_date`: no notification (no timeline to be at risk of).
- App is foregrounded: show an in-app banner instead of a system notification (same pattern as budget alerts).

---

## 6. Transparency Log

Every goal card on the Goals tab has an expandable "History" section showing recent `goal_events`.

### Event display format

| event_type | Label |
|---|---|
| `at_risk` | "⚠️ Fell at risk — $X shortfall" |
| `back_on_track` | "✓ Back on track" |
| `adjustment` | "Adjusted N budgets — [auto / manual]" |
| `completed` | "✓ Goal reached" |

Each adjustment event expands to show per-bucket changes:
```
Dining        12% → 9%   −$156   "ranked lowest priority"
Entertainment  8% → 6%   −$104   "$120 headroom above floor"
```

Timestamp shown as relative (e.g., "2 days ago") with full date on tap.

---

## 7. UI Changes

### Goal card (Goals tab)

Current state: name, progress bar, % complete, months left.

New additions:
- **Status pill:** `On track` (green) / `At risk` (amber) / `Completed` (indigo)
- **Monthly contribution line:** "Needs $X/mo · Projected surplus $Y/mo"
- **At-risk prompt (inline, dismissable):** two buttons — "Adjust budgets" (opens suggestion sheet) and "Extend timeline"
- **History chevron:** expands to show recent goal_events

### Suggestion sheet (bottom sheet)

- Header: "To stay on track for [goal], we suggest:"
- List of bucket cuts with explanation labels
- Toggle: "Apply automatically" / "I'll do it manually"
- "Extend timeline instead" as a secondary action
- Confirm / Cancel

### Plan screen integration

At-risk goals get an amber indicator on the Goals tab pill so the user sees it before tapping in.

---

## 8. Backlog

- **Wellness score change explainer** (#36): same `goal_events` pattern applied to score deltas — what moved the score, by how much, concise per-factor breakdown.
- **Bucket drag-to-reorder** (#34): must land for `priority_rank` to be user-driven. Until then, all buckets are unranked and the suggestion engine falls back to slack-only ordering.
- **Budget treemap** (#35): above bucket list, tile area = target_pct, color = spend status.
- **Multi-goal conflict resolution:** if cutting budgets for Goal A makes Goal B unfeasible, surface the conflict explicitly rather than silently over-cutting.
- **Goal contribution crediting:** at end of each month, if surplus ≥ contribution_needed, increment `current_amount` by `monthly_contribution_needed` automatically.
