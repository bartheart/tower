# Bucket Priority Drag-to-Sort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace spend-ratio bucket sorting with user-controlled priority order, persisted as `priority_rank` in Supabase, with a long-press drag-to-reorder gesture in the Buckets tab.

**Architecture:** Three sequential changes — (1) fix `computeRedistribution` to use priority-only weights with a proportional fallback when ranks are null, (2) update `useBudgets` to sort by `priority_rank`, initialize ranks on first load, and expose `updateBucketRanks`, (3) replace the `budgets.map()` card list in `BucketsTab` with `DraggableFlatList` that fires `updateBucketRanks` on drop.

**Tech Stack:** React Native (Expo bare), TypeScript, Supabase JS v2, `react-native-draggable-flatlist` (new), `expo-haptics` (already installed), `react-native-reanimated` + `react-native-gesture-handler` (already installed).

---

## File Map

| File | Change |
|------|--------|
| `mobile/src/budget/redistributeOnDelete.ts` | Remove `spent`/`monthlyLimit` from interface; replace `ceilingScore` weight with priority-only; add proportional fallback for all-null case |
| `mobile/src/budget/__tests__/redistributeOnDelete.test.ts` | Full rewrite — old tests assert old spend-ratio behavior which is deleted |
| `mobile/src/budget/goalAllocator.ts` | Remove `spent`/`monthlyLimit` from `computeRedistribution` call |
| `mobile/src/hooks/useBudgets.ts` | Change sort; add rank-init in `loadCategories`; export `updateBucketRanks`; update `createBudget` to assign next rank; remove `spent`/`monthlyLimit` from `computeRedistribution` call |
| `mobile/src/screens/PlanScreen.tsx` | Replace `budgets.map()` with `DraggableFlatList` in `BucketsTab`; add `handleDragEnd`, `renderBucketItem`, `bucketCardDragging` style |
| `mobile/package.json` + `mobile/package-lock.json` | Add `react-native-draggable-flatlist` |

---

## Task 1: Rewrite `redistributeOnDelete.ts` — priority-only weights, proportional fallback

**Files:**
- Modify: `mobile/src/budget/redistributeOnDelete.ts`
- Modify: `mobile/src/budget/__tests__/redistributeOnDelete.test.ts`

### Background
`RedistributionCandidate` currently includes `spent` and `monthlyLimit` used for `ceilingScore`. Both are removed — the weight formula becomes `1 / priorityRank` only. The previous fallback ("all unranked → return []") is replaced with proportional-`targetPct` distribution so freed budget is never silently dropped (fixes #43). All 8 existing tests assert the old spend-ratio behavior and must be replaced.

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `mobile/src/budget/__tests__/redistributeOnDelete.test.ts`:

```typescript
import { computeRedistribution } from '../redistributeOnDelete';

test('distributes freed pct by priority rank — rank 1 gets more than rank 2', () => {
  // weight_a = 1/1 = 1.0, weight_b = 1/2 = 0.5, total = 1.5
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, priorityRank: 1 },
    { id: 'b', targetPct: 15, priorityRank: 2 },
  ], 10);
  const a = result.find(r => r.id === 'a')!;
  const b = result.find(r => r.id === 'b')!;
  expect(a.newPct).toBeCloseTo(20 + 10 * (1 / 1.5), 1);
  expect(b.newPct).toBeCloseTo(15 + 10 * (0.5 / 1.5), 1);
});

test('single ranked candidate gets all of freed pct', () => {
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, priorityRank: 1 },
  ], 10);
  expect(result).toHaveLength(1);
  expect(result[0].newPct).toBeCloseTo(30, 1);
});

test('unranked candidates are excluded when ranked candidates exist', () => {
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, priorityRank: 1 },
    { id: 'b', targetPct: 15, priorityRank: null },
  ], 10);
  expect(result.find(r => r.id === 'b')).toBeUndefined();
  const a = result.find(r => r.id === 'a')!;
  expect(a.newPct).toBeCloseTo(30, 1);
});

test('all unranked: distributes proportionally to existing targetPct', () => {
  // a has 20%, b has 10% — total 30%; a gets 2/3 of freed, b gets 1/3
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, priorityRank: null },
    { id: 'b', targetPct: 10, priorityRank: null },
  ], 9);
  const a = result.find(r => r.id === 'a')!;
  const b = result.find(r => r.id === 'b')!;
  expect(a.newPct).toBeCloseTo(20 + 9 * (20 / 30), 1);
  expect(b.newPct).toBeCloseTo(10 + 9 * (10 / 30), 1);
});

test('all unranked with all zero targetPct returns empty', () => {
  const result = computeRedistribution([
    { id: 'a', targetPct: 0, priorityRank: null },
    { id: 'b', targetPct: 0, priorityRank: null },
  ], 10);
  expect(result).toEqual([]);
});

test('returns empty when freedPct is 0', () => {
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, priorityRank: 1 },
  ], 0);
  expect(result).toEqual([]);
});

test('returns empty when freedPct is negative', () => {
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, priorityRank: 1 },
  ], -5);
  expect(result).toEqual([]);
});

test('returns empty when candidates array is empty', () => {
  expect(computeRedistribution([], 10)).toEqual([]);
});

test('equal ranks share freed pct equally', () => {
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, priorityRank: 1 },
    { id: 'b', targetPct: 15, priorityRank: 1 },
  ], 10);
  const a = result.find(r => r.id === 'a')!;
  const b = result.find(r => r.id === 'b')!;
  expect(a.newPct).toBeCloseTo(25, 1);
  expect(b.newPct).toBeCloseTo(20, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd mobile && npx jest redistributeOnDelete --no-coverage 2>&1 | tail -20
```

Expected: multiple FAIL assertions (old interface has `monthlyLimit`/`spent`, old behavior expected).

- [ ] **Step 3: Rewrite `redistributeOnDelete.ts`**

Replace the entire file:

```typescript
export interface RedistributionCandidate {
  id: string;
  targetPct: number;
  priorityRank: number | null;
}

export interface RedistributionResult {
  id: string;
  newPct: number;
}

/**
 * Distributes freedPct among candidates weighted by priority rank.
 *
 * Weight formula: weight = 1 / priorityRank  (rank 1 = highest priority)
 * Candidates with null rank are excluded when any ranked candidate exists.
 *
 * Fallback when ALL candidates are unranked: distribute proportionally to
 * existing targetPct so freed budget is never silently dropped.
 * If all targetPct values are also 0: return [] (nothing to weight against).
 *
 * Note: spend ratio (ceilingScore) was intentionally removed — high spend
 * does not imply a bucket should receive more budget during redistribution.
 * See issue #44 for spend-based recommendations (separate feature).
 */
export function computeRedistribution(
  candidates: RedistributionCandidate[],
  freedPct: number,
): RedistributionResult[] {
  if (freedPct <= 0 || candidates.length === 0) return [];

  const withWeights = candidates.map(c => ({
    c,
    weight: c.priorityRank != null ? 1 / c.priorityRank : 0,
  }));

  const totalWeight = withWeights.reduce((s, x) => s + x.weight, 0);

  if (totalWeight === 0) {
    // All unranked — distribute proportionally to existing targetPct
    const totalPct = candidates.reduce((s, c) => s + c.targetPct, 0);
    if (totalPct === 0) return [];
    return candidates.map(c => ({
      id: c.id,
      newPct: Math.round((c.targetPct + freedPct * (c.targetPct / totalPct)) * 100) / 100,
    }));
  }

  return withWeights
    .filter(x => x.weight > 0)
    .map(x => ({
      id: x.c.id,
      newPct: Math.round((x.c.targetPct + freedPct * (x.weight / totalWeight)) * 100) / 100,
    }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd mobile && npx jest redistributeOnDelete --no-coverage 2>&1 | tail -10
```

Expected: `Tests: 9 passed, 9 total`

- [ ] **Step 5: Update callers to drop removed fields**

In `mobile/src/hooks/useBudgets.ts`, find the `deleteBudgetWithRedistribution` function (~line 209). Update the `candidates` map:

```typescript
// Before:
const candidates = allCategories
  .filter(c => c.id !== id && !c.isGoal && (c.targetPct ?? 0) > 0)
  .map(c => ({
    id: c.id,
    targetPct: c.targetPct ?? 0,
    monthlyLimit: c.monthlyLimit,
    spent: c.spent,
    priorityRank: c.priorityRank,
  }));

// After:
const candidates = allCategories
  .filter(c => c.id !== id && !c.isGoal && (c.targetPct ?? 0) > 0)
  .map(c => ({
    id: c.id,
    targetPct: c.targetPct ?? 0,
    priorityRank: c.priorityRank,
  }));
```

In `mobile/src/budget/goalAllocator.ts`, find the `removeGoalAllocation` function (~line 228). Update the `candidates` map:

```typescript
// Before:
const candidates = categories
  .filter(c => !c.isGoal && (c.targetPct ?? 0) > 0)
  .map(c => ({
    id: c.id,
    targetPct: c.targetPct ?? 0,
    monthlyLimit: c.monthlyLimit,
    spent: c.spent,
    priorityRank: c.priorityRank,
  }));

// After:
const candidates = categories
  .filter(c => !c.isGoal && (c.targetPct ?? 0) > 0)
  .map(c => ({
    id: c.id,
    targetPct: c.targetPct ?? 0,
    priorityRank: c.priorityRank,
  }));
```

- [ ] **Step 6: Run full test suite**

```bash
cd mobile && npx jest --no-coverage 2>&1 | tail -10
```

Expected: all tests pass (goalAllocator tests may need updating if they pass `spent`/`monthlyLimit` — fix any TypeScript errors).

- [ ] **Step 7: Commit**

```bash
git add mobile/src/budget/redistributeOnDelete.ts \
        mobile/src/budget/__tests__/redistributeOnDelete.test.ts \
        mobile/src/hooks/useBudgets.ts \
        mobile/src/budget/goalAllocator.ts
git commit -m "fix: redistribution uses priority-only weights; proportional fallback when all unranked

Removes ceilingScore (spent/monthlyLimit ratio) from weight formula — spend
ratio is not a signal that a bucket should receive more budget (see #44).
All-null-rank fallback now distributes proportional to targetPct instead of
returning [] silently (fixes #43). Rewrites 9 unit tests.
"
```

---

## Task 2: Update `useBudgets.ts` — sort by priority, init ranks, `updateBucketRanks`, next rank on create

**Files:**
- Modify: `mobile/src/hooks/useBudgets.ts`

### Background
Four changes in one file:
1. **Sort**: replace spend-ratio sort with `priority_rank ASC NULLS LAST`.
2. **Init**: if all ranks are null on first load, fetch by `created_at` and batch-write ranks 1…N.
3. **Export**: add `updateBucketRanks(orderedIds)` — called by drag handler on drop.
4. **Create**: `createBudget` queries the current max rank and assigns `max + 1`.

No unit tests are written for these (they are thin Supabase wrappers, same pattern as the existing `createBudget`/`deleteBudget` which have no tests). The behavior is verified by the drag-to-sort integration (Task 3) and manual testing.

- [ ] **Step 1: Change sort in `useBudgets`**

In `mobile/src/hooks/useBudgets.ts`, find the sort line inside the `useMemo` (~line 84):

```typescript
// Before:
result.sort((a, b) => (b.spent / b.monthlyLimit) - (a.spent / a.monthlyLimit));

// After:
result.sort((a, b) => {
  if (a.priorityRank == null && b.priorityRank == null) return 0;
  if (a.priorityRank == null) return 1;   // nulls last
  if (b.priorityRank == null) return -1;
  return a.priorityRank - b.priorityRank;
});
```

- [ ] **Step 2: Add rank initialization inside `loadCategories`**

Replace the existing `loadCategories` callback (currently ~lines 41–50):

```typescript
const loadCategories = useCallback(async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { data } = await supabase
    .from('budget_categories')
    .select('*')
    .eq('user_id', user.id)
    .order('priority_rank', { ascending: true, nullsFirst: false });
  if (!data) return;

  // One-time rank initialization: if every row has null priority_rank,
  // assign ranks 1…N ordered by created_at (oldest = highest priority).
  const allNull = data.every(c => c.priority_rank == null);
  if (allNull && data.length > 0) {
    const { data: ordered } = await supabase
      .from('budget_categories')
      .select('id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });
    if (ordered) {
      await Promise.all(
        ordered.map((row, index) =>
          supabase
            .from('budget_categories')
            .update({ priority_rank: index + 1 })
            .eq('id', row.id)
        )
      );
      // Reload now that ranks are set
      const { data: ranked } = await supabase
        .from('budget_categories')
        .select('*')
        .eq('user_id', user.id)
        .order('priority_rank', { ascending: true, nullsFirst: false });
      if (ranked) { setCategories(ranked); return; }
    }
  }

  setCategories(data);
}, []);
```

- [ ] **Step 3: Export `updateBucketRanks`**

Add after the `deleteBudgetWithRedistribution` export (end of `useBudgets.ts`):

```typescript
/**
 * Batch-update priority_rank for all buckets based on the new display order.
 * Called after a drag-to-reorder gesture completes. Assigns rank 1…N.
 */
export async function updateBucketRanks(orderedIds: string[]): Promise<void> {
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from('budget_categories')
        .update({ priority_rank: index + 1 })
        .eq('id', id)
    )
  );
}
```

- [ ] **Step 4: Update `createBudget` to assign next rank**

Replace the existing `createBudget` function (~lines 91–108):

```typescript
export async function createBudget(
  name: string,
  emoji: string,
  monthlyLimit: number,
  color: string,
  plaidCategory?: string,
  targetPct?: number,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // New bucket always joins at the bottom (lowest priority).
  const { data: existing } = await supabase
    .from('budget_categories')
    .select('priority_rank')
    .eq('user_id', user.id)
    .order('priority_rank', { ascending: false })
    .limit(1);
  const nextRank = (existing?.[0]?.priority_rank ?? 0) + 1;

  const row: Record<string, unknown> = {
    user_id: user.id, name, emoji, monthly_limit: monthlyLimit,
    color, priority_rank: nextRank,
  };
  if (plaidCategory) row.plaid_category = plaidCategory;
  if (targetPct != null) row.target_pct = targetPct;
  const { error } = await supabase.from('budget_categories').insert(row);
  if (error) throw error;
}
```

- [ ] **Step 5: Add `updateBucketRanks` to the import in `PlanScreen.tsx`**

In `mobile/src/screens/PlanScreen.tsx` line 9, add `updateBucketRanks` to the import:

```typescript
// Before:
import { useBudgets, createBudget, updateBudget, deleteBudget, deleteBudgetWithRedistribution, rebalanceBucketPct } from '../hooks/useBudgets';

// After:
import { useBudgets, createBudget, updateBudget, deleteBudget, deleteBudgetWithRedistribution, rebalanceBucketPct, updateBucketRanks } from '../hooks/useBudgets';
```

- [ ] **Step 6: Run full test suite**

```bash
cd mobile && npx jest --no-coverage 2>&1 | tail -10
```

Expected: all tests pass (no tests cover the new functions directly; existing tests should remain green).

- [ ] **Step 7: Commit**

```bash
git add mobile/src/hooks/useBudgets.ts mobile/src/screens/PlanScreen.tsx
git commit -m "feat: sort buckets by priority_rank, init ranks on first load, updateBucketRanks

- useBudgets sorts by priority_rank ASC (nulls last) instead of spend ratio
- loadCategories initializes ranks 1..N by created_at if all null (one-time)
- new export: updateBucketRanks(orderedIds) for drag-to-sort persistence
- createBudget assigns priority_rank = max(existing) + 1 so new buckets land last
"
```

---

## Task 3: Install DraggableFlatList and wire into `BucketsTab`

**Files:**
- Modify: `mobile/package.json` (via npm install)
- Modify: `mobile/src/screens/PlanScreen.tsx`

### Background
`BucketsTab` currently renders bucket cards with `budgets.map(b => <TouchableOpacity ...>)`. This section is replaced with `DraggableFlatList`. Key constraints:
- `scrollEnabled={false}` — the outer `ScrollView` in `PlanScreen` handles page scrolling; `DraggableFlatList` must not scroll itself
- `activationDistance={5}` — prevents accidental drag activation during normal scroll
- Haptic feedback on lift (`onDragBegin`) and drop (`onDragEnd`)
- On drop: update Supabase optimistically; revert on failure

`expo-haptics`, `react-native-reanimated`, and `react-native-gesture-handler` are already installed — no additional native build step needed.

- [ ] **Step 1: Install `react-native-draggable-flatlist`**

```bash
cd mobile && npm install react-native-draggable-flatlist
```

Expected: package added to `package.json`, no peer dependency warnings (reanimated + gesture-handler already present).

- [ ] **Step 2: Add imports to `PlanScreen.tsx`**

At the top of `mobile/src/screens/PlanScreen.tsx`, add two imports after the existing React Native imports:

```typescript
import DraggableFlatList, { ScaleDecorator, RenderItemParams } from 'react-native-draggable-flatlist';
import * as Haptics from 'expo-haptics';
```

- [ ] **Step 3: Add `handleDragEnd` and `renderBucketItem` inside `BucketsTab`**

Inside the `BucketsTab` function body, add these after `allocatedTotal` (~line 791), before the `return`:

```typescript
const handleDragEnd = useCallback(async ({ data }: { data: typeof budgets }) => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  try {
    await updateBucketRanks(data.map(b => b.id));
  } catch {
    Alert.alert('Error', 'Could not save order. Try again.');
    onReload();
  }
}, [onReload]);

const renderBucketItem = useCallback(({ item: b, drag, isActive }: RenderItemParams<typeof budgets[number]>) => {
  const pct = b.targetPct ?? 0;
  const allocationAmt = confirmedMonthlyIncome > 0 ? confirmedMonthlyIncome * pct / 100 : b.monthlyLimit;
  const isHighlighted = b.id === highlightId || b.id === selectedTreemapId;

  return (
    <ScaleDecorator activeScale={1.04}>
      <TouchableOpacity
        style={[s.bucketCard, isHighlighted && s.bucketCardHighlighted, isActive && s.bucketCardDragging]}
        onPress={() => setDetailBudget(b)}
        onLongPress={drag}
        delayLongPress={400}
        activeOpacity={0.75}
        onLayout={e => { bucketYOffsets.current[b.id] = e.nativeEvent.layout.y; }}
      >
        <View style={[s.bucketAccentBar, { backgroundColor: b.color }]} />
        <View style={{ flex: 1 }}>
          <View style={s.bucketCardRow}>
            <Text style={s.bucketCardName}>{b.name}{b.isGoal ? '  ·  Goal' : ''}</Text>
            <Text style={s.bucketPctDisplay}>{pct > 0 ? `${pct}%` : '—'}</Text>
          </View>
          <Text style={s.bucketCardSub}>
            {allocationAmt > 0 ? fmt(allocationAmt) : '—'}/mo
            {b.monthlyFloor > 0 ? `  ·  floor ${fmt(b.monthlyFloor)}` : ''}
          </Text>
        </View>
        <Text style={s.chevron}>›</Text>
      </TouchableOpacity>
    </ScaleDecorator>
  );
}, [confirmedMonthlyIncome, highlightId, selectedTreemapId]);
```

- [ ] **Step 4: Replace `budgets.map()` with `DraggableFlatList`**

In `BucketsTab`'s return block, find the conditional render block (~lines 809–840):

```typescript
// Before:
{budgets.length === 0 ? (
  <Text style={s.emptyHint}>No budgets yet. Add one below.</Text>
) : (
  budgets.map(b => {
    // ... TouchableOpacity card
  })
)}
```

Replace with:

```typescript
{budgets.length === 0 ? (
  <Text style={s.emptyHint}>No budgets yet. Add one below.</Text>
) : (
  <DraggableFlatList
    data={budgets}
    keyExtractor={b => b.id}
    renderItem={renderBucketItem}
    onDragBegin={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}
    onDragEnd={handleDragEnd}
    scrollEnabled={false}
    activationDistance={5}
  />
)}
```

- [ ] **Step 5: Add `bucketCardDragging` style**

In the `StyleSheet.create` call at the bottom of `PlanScreen.tsx`, add after `bucketCardHighlighted`:

```typescript
bucketCardDragging: {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.5,
  shadowRadius: 16,
  elevation: 12,
  borderColor: 'rgba(99,102,241,0.6)',
  borderWidth: 1.5,
},
```

- [ ] **Step 6: Run full test suite**

```bash
cd mobile && npx jest --no-coverage 2>&1 | tail -10
```

Expected: all tests pass. (`DraggableFlatList` is mocked by the RN testing environment; no new test failures expected.)

- [ ] **Step 7: Manual smoke test**

Start the app. In the Buckets tab:
1. Verify buckets appear in creation order (oldest at top) on first load.
2. Long-press a bucket card for ~400ms — it should lift with a scale-up effect and haptic pulse.
3. Drag it to a new position and release — second haptic, card settles into new slot.
4. Kill and reopen the app — verify the order persisted.
5. Add a new bucket — verify it appears at the bottom.
6. Delete a bucket — verify freed % is redistributed to remaining buckets (check the treemap allocations).

- [ ] **Step 8: Commit**

```bash
git add mobile/src/screens/PlanScreen.tsx mobile/package.json mobile/package-lock.json
git commit -m "feat: drag-to-reorder bucket cards persists priority_rank in real time

Long-press any bucket card to lift and drag. Drop fires updateBucketRanks
which batch-writes priority_rank 1..N to Supabase. Haptic feedback on lift
and drop. DraggableFlatList with scrollEnabled=false to avoid gesture
conflict with outer ScrollView.
"
```
