# Budget Bucket Fixes — Design Spec

**Goal:** Fix four interrelated bugs and small features in the budget buckets screen: slider smoothness, unallocated income gap, smart redistribution on delete, and removing confirmed fixed charges.

**Architecture:** All fixes are client-side. No schema changes. One new shared utility (`computeRedistributionWeights`) used by both goal deletion and bucket deletion. All existing patterns (Supabase I/O in hooks, PanResponder in PlanScreen) are preserved.

**Tech Stack:** React Native (Expo), Supabase JS v2, TypeScript.

---

## Table of Contents

1. [Slider Smoothness Fix](#1-slider-smoothness-fix)
2. [Unallocated Budget Gap Fix](#2-unallocated-budget-gap-fix)
3. [Smart Redistribution on Delete](#3-smart-redistribution-on-delete)
4. [Remove Confirmed Fixed Charge](#4-remove-confirmed-fixed-charge)

---

## 1. Slider Smoothness Fix

### Problem

`PercentSlider` reads `locationX` from `onPanResponderMove` events. `locationX` is relative to the view that received the touch, which can change as the thumb moves over child views — causing the position to jump.

### Fix

Store the track's absolute screen position (`pageX`) at grant time using `onLayout` + `measure`. On every move event, use `gestureState.moveX` (absolute screen X) minus the stored `pageX` to compute position.

### Implementation

`PercentSlider` in `PlanScreen.tsx`:

```
onPanResponderGrant: store trackPageX = track.measure().pageX
onPanResponderMove: x = gestureState.moveX - trackPageX
                   raw = min + (clamp(x, 0, trackWidth) / trackWidth) * (max - min)
                   value = clamp(round(raw / step) * step, min, max)
                   onChange(value)
```

`trackPageX` is stored in a ref (updated on layout). The `View` ref is obtained via `useRef<View>()` and `ref.measure(...)` called inside `onPanResponderGrant`.

### Behaviour contract

- Dragging is continuous and never jumps
- Value is always clamped to `[min, max]`
- Snapping to `step` is preserved
- On tap (grant with no move), value is set to the tapped position immediately

---

## 2. Unallocated Budget Gap Fix

### Problem

Both `sliderMax` in `BucketDetailModal` and `rebalanceBucketPct` in `useBudgets.ts` and `previewGoalAllocation` in `goalAllocator.ts` only look at slack inside *existing* bucket allocations. If the sum of all `targetPct` values is less than 100 (e.g. 80%), the remaining 20% is inaccessible — sliders cap early and new goals cut from existing buckets unnecessarily.

### Fix in `PlanScreen.tsx` — `sliderMax`

```
unallocated = max(0, 100 - sum(allBudgets.map(b => b.targetPct ?? 0)))
sliderMax   = min(100, (budget.targetPct ?? 0) + othersSlack + unallocated)
```

`othersSlack` computation is unchanged (slack from other non-goal buckets above their floors).

### Fix in `useBudgets.ts` — `rebalanceBucketPct`

When **increasing** (`delta > 0`):

```
unallocated = max(0, 100 - sum(all targetPcts))
fromUnallocated = min(unallocated, delta)
fromOthers = delta - fromUnallocated
```

Apply `fromUnallocated` directly to the target bucket (no other buckets touched).
Apply `fromOthers` to others using the existing proportional cut logic (respecting floors).

When **decreasing** (`delta < 0`):

The freed percentage is left as unallocated — it is NOT redistributed to other buckets. The user is intentionally pulling money out; redistribution is their choice via the slider of another bucket.

### Fix in `goalAllocator.ts` — `previewGoalAllocation`

```
unallocated = max(0, 100 - sum(all categories targetPct))
needFromOthers = max(0, goalTargetPct - unallocated)
```

Only cut `needFromOthers` from eligible non-goal buckets (existing logic). If `needFromOthers <= 0`, no cuts are needed. The `cuts` array is empty and `feasible = true`.

The preview returned must reflect this: if `unallocated >= goalTargetPct`, cuts is `[]` and the goal is fully funded from unallocated budget.

---

## 3. Smart Redistribution on Delete

### Problem

- `removeGoalAllocation` redistributes freed % purely proportional to `targetPct` — ignores priority and real spend patterns.
- `deleteBudget` does not redistribute at all — the freed % simply disappears into the unallocated pool with no hint to the user.

### Shared Utility: `computeRedistributionWeights`

New function in `budget-app/mobile/src/budget/redistributeOnDelete.ts`:

```typescript
export interface RedistributionCandidate {
  id: string;
  targetPct: number;
  monthlyLimit: number;
  spent: number;          // current month spend
  priorityRank: number | null;
}

export interface RedistributionResult {
  id: string;
  newPct: number;
}

export function computeRedistribution(
  candidates: RedistributionCandidate[],
  freedPct: number,
): RedistributionResult[]
```

**Weight formula per candidate:**

```
priorityScore = rank != null ? 1 / rank : 0       // null = lowest, doesn't receive
ceilingScore  = monthlyLimit > 0 ? clamp(spent / monthlyLimit, 0, 1) : 0
weight        = priorityScore * ceilingScore
```

**Fallback:** If `sum(weights) === 0` (no spend data yet), fall back to `weight = 1 / rank` (priority-only, unranked excluded). If still all zero (all remaining buckets are unranked), freed % stays unallocated — no silent redistribution.

**Distribution:**

```
totalWeight = sum(weights)
for each candidate:
  share  = weight / totalWeight
  newPct = round((targetPct + freedPct * share) * 100) / 100
```

Result is an array of `{ id, newPct }` for the caller to write to Supabase.

### `removeGoalAllocation` — updated

Replace the current proportional redistribution with `computeRedistribution`. Pass the non-goal, non-deleted buckets as candidates with their current `spent` values.

Caller (`GoalCard.handleDelete` in `PlanScreen.tsx`) already passes `budgets` which includes `spent` — no interface change needed.

### `deleteBudget` — updated

Rename to `deleteBudgetWithRedistribution(id, allCategories)` in `useBudgets.ts`. Steps:

1. Find the deleted bucket's `targetPct` (the freed amount).
2. Run `computeRedistribution` on remaining non-goal, non-deleted buckets.
3. Batch-update all affected `target_pct` values in Supabase.
4. Delete the bucket row.

The existing `deleteBudget(id)` call site in `BucketDetailModal.handleDelete` is updated to pass `allBudgets`.

---

## 4. Remove Confirmed Fixed Charge

### Problem

Confirmed fixed items in `BucketDetailModal` show a "Fixed" chip but have no way to be removed. Only unconfirmed items have a Dismiss button.

### Fix

Add a small remove button (✕) to the right of confirmed fixed item rows in `BucketDetailModal`. Tapping it shows an `Alert.alert` confirmation:

```
"Remove fixed charge?"
"[merchantName] will no longer count toward this bucket's floor."
[Cancel] [Remove]
```

On confirm:
1. Call `dismissFixedItem(fi.id)` — deletes the row (function already exists in `useFixedItems.ts`)
2. Call `recomputeFloor(fi.categoryId)` — recomputes `monthly_floor` from remaining confirmed items
3. Call `onReloadFixed()` — refreshes the fixed items list
4. Update `floorInput` state to reflect the new floor value

No new exports needed. No schema changes.

---

## Edge Cases

| Scenario | Behaviour |
|---|---|
| All buckets at their floors, unallocated = 0 | Slider max = current pct (can't increase) |
| Goal needs more than unallocated + all slack | `feasible = false`, shortfall shown to user |
| Deleted bucket has no priority rank | Not included in redistribution (freed % stays unallocated) |
| Deleted bucket is a goal | `removeGoalAllocation` path, not `deleteBudgetWithRedistribution` |
| All remaining buckets have zero spend | Redistribution falls back to priority-only; if all unranked, freed % stays unallocated |
| Last fixed item removed from a bucket | Floor recomputes to 0; slider min drops accordingly |
| Removing last fixed charge when floor input was manually edited | Floor input resets to 0 after recompute |
