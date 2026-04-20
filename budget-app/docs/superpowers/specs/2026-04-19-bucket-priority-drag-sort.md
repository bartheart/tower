# Bucket Priority Drag-to-Sort Design Spec

## Overview

Budget buckets are displayed in manually set priority order. The user long-presses any bucket card to lift and drag it to a new position. Dropping persists the new order to Supabase as `priority_rank` integers in real time. List order is the single source of truth for redistribution priority — spend ratio is no longer used as a redistribution weight.

## Motivation

The existing redistribution logic (`computeRedistribution`) weighted freed budget using a combination of `priorityRank × ceilingScore` where `ceilingScore = spent / monthlyLimit`. This is flawed: a high spend ratio on a discretionary bucket (e.g. Eating Out) does not mean it should receive more budget during redistribution — it may be a bucket the user is actively trying to cut. Spend-ratio signals belong in a separate recommendation layer (see issue #44), not in the auto-redistribution path. Priority rank, set explicitly by the user, is the correct and only signal for redistribution weighting.

This change also resolves issue #43: when all `priority_rank` values are `null`, `computeRedistribution` returned `[]` silently. The new fallback distributes freed budget equally (proportional to existing `targetPct`) when no ranks are set.

---

## Data Model

No DB migration required. `priority_rank INTEGER` already exists on `budget_categories` and is already mapped to `BudgetCategory.priorityRank`.

### Rank semantics
- `priority_rank = 1` → highest priority (top of list)
- Ranks are dense integers: 1, 2, 3 … N
- `null` → unranked (treated as lowest priority in UI sort; equal-weight in redistribution fallback)

### Sort order change
`useBudgets` currently sorts by `(b.spent / b.monthlyLimit) DESC`. This is replaced by `priority_rank ASC NULLS LAST`, with a secondary sort by `created_at ASC` for nulls (so unranked buckets appear in creation order at the bottom).

### Initialization
On first load, if **all** `priority_rank` values for the user's buckets are `null`:
- Fetch buckets ordered by `created_at ASC` from Supabase
- Assign ranks 1…N
- Batch-write ranks to Supabase
- This is a one-time migration per user; subsequent loads will have ranks set

### New buckets
`createBudget` assigns `priority_rank = max(existing ranks) + 1` so new buckets always join at the bottom (lowest priority).

---

## Interaction Design

### Trigger
Long-press any bucket card for ~400ms → card lifts (scale 1.04, elevated shadow, subtle indigo border). No separate "edit mode" or drag handles needed.

### During drag
- Lifted card: `scale(1.04)`, `box-shadow` elevated, `opacity: 0.95`
- A thin 2px indigo line (`#6366f1`) marks the current drop target position between cards
- Other cards shift to make room as the dragged card moves

### On drop
1. Update local state immediately (optimistic — list reorders instantly)
2. Compute new ranks: new position in list = new rank (1-indexed)
3. Batch-write all rank updates to Supabase in parallel (`Promise.all`)
4. If DB write fails: revert to previous order, show `Alert.alert('Error', 'Could not save order. Try again.')`

### Haptics
- `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)` on lift
- `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)` on drop

### Goal buckets
Goal buckets are draggable and ranked alongside regular buckets. Priority applies to all bucket types — goal contributions compete with regular budget allocations in the same redistribution pool.

---

## Component Changes

### `BucketsTab` in `PlanScreen.tsx`

Replace the current `budgets.map(b => <TouchableOpacity ...>)` rendering with `DraggableFlatList` from `react-native-draggable-flatlist`.

```typescript
import DraggableFlatList, { ScaleDecorator, RenderItemParams } from 'react-native-draggable-flatlist';

// Inside BucketsTab:
const handleDragEnd = useCallback(async ({ data }: { data: BudgetCategory[] }) => {
  const previous = budgets; // snapshot for rollback
  // optimistic update handled by parent reload after DB write
  try {
    await updateBucketRanks(data.map(b => b.id));
  } catch {
    Alert.alert('Error', 'Could not save order. Try again.');
    onReload(); // revert by reloading from DB
  }
}, [budgets, onReload]);

const renderBucketItem = useCallback(({ item: b, drag, isActive }: RenderItemParams<BudgetCategory>) => {
  const pct = b.targetPct ?? 0;
  const allocationAmt = confirmedMonthlyIncome > 0 ? confirmedMonthlyIncome * pct / 100 : b.monthlyLimit;
  const isHighlighted = b.id === highlightId || b.id === selectedTreemapId;

  return (
    <ScaleDecorator activeScale={1.04}>
      <TouchableOpacity
        key={b.id}
        style={[s.bucketCard, isHighlighted && s.bucketCardHighlighted, isActive && s.bucketCardDragging]}
        onPress={() => setDetailBudget(b)}
        onLongPress={drag}
        delayLongPress={400}
        activeOpacity={0.75}
        onLayout={e => { bucketYOffsets.current[b.id] = e.nativeEvent.layout.y; }}
      >
        {/* existing card content unchanged */}
      </TouchableOpacity>
    </ScaleDecorator>
  );
}, [confirmedMonthlyIncome, highlightId, selectedTreemapId]);
```

`DraggableFlatList` replaces the wrapping `View` + `.map()`:

```tsx
<DraggableFlatList
  data={budgets}
  keyExtractor={b => b.id}
  renderItem={renderBucketItem}
  onDragEnd={handleDragEnd}
  activationDistance={5}
/>
```

Add `bucketCardDragging` style:
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

### `useBudgets.ts`

**Sort change:** Replace spend-ratio sort with priority-rank sort:
```typescript
// Before:
result.sort((a, b) => (b.spent / b.monthlyLimit) - (a.spent / a.monthlyLimit));

// After:
result.sort((a, b) => {
  if (a.priorityRank == null && b.priorityRank == null) return 0;
  if (a.priorityRank == null) return 1;  // nulls last
  if (b.priorityRank == null) return -1;
  return a.priorityRank - b.priorityRank;
});
```

**New export `updateBucketRanks`:**
```typescript
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

**Initialization helper `initBucketRanksIfNeeded`:**
```typescript
export async function initBucketRanksIfNeeded(categories: BudgetCategory[]): Promise<boolean> {
  // Returns true if ranks were initialized (caller should reload)
  if (categories.length === 0) return false;
  if (categories.some(c => c.priorityRank != null)) return false;

  // All null — fetch by created_at to get stable creation order
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from('budget_categories')
    .select('id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });
  if (!data) return false;

  await Promise.all(
    data.map((row, index) =>
      supabase
        .from('budget_categories')
        .update({ priority_rank: index + 1 })
        .eq('id', row.id)
    )
  );
  return true;
}
```

Called inside `useBudgets` after the initial load:
```typescript
useEffect(() => {
  loadCategories().then(async () => {
    // categories state may not be updated yet — check raw data
  });
}, [loadCategories]);
```

Actually, `initBucketRanksIfNeeded` is called inside `loadCategories` after data is fetched:
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

  // One-time rank initialization for users with no ranks set
  const allNull = data.every(c => c.priority_rank == null);
  if (allNull && data.length > 0) {
    // Fetch by created_at for stable initial order
    const { data: ordered } = await supabase
      .from('budget_categories')
      .select('id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });
    if (ordered) {
      await Promise.all(
        ordered.map((row, index) =>
          supabase.from('budget_categories').update({ priority_rank: index + 1 }).eq('id', row.id)
        )
      );
      // Reload with ranks now set
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

**`createBudget` update** — assign next rank:
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

  // Determine next rank
  const { data: existing } = await supabase
    .from('budget_categories')
    .select('priority_rank')
    .eq('user_id', user.id)
    .order('priority_rank', { ascending: false })
    .limit(1);
  const nextRank = (existing?.[0]?.priority_rank ?? 0) + 1;

  const row: Record<string, unknown> = {
    user_id: user.id, name, emoji, monthly_limit: monthlyLimit, color, priority_rank: nextRank,
  };
  if (plaidCategory) row.plaid_category = plaidCategory;
  if (targetPct != null) row.target_pct = targetPct;
  const { error } = await supabase.from('budget_categories').insert(row);
  if (error) throw error;
}
```

---

## Redistribution Logic Change

### `redistributeOnDelete.ts` — remove spend ratio, fix null fallback

**Before:**
```typescript
const priorityScore = c.priorityRank != null ? 1 / c.priorityRank : 0;
const ceilingScore  = c.monthlyLimit > 0 ? Math.max(0, Math.min(1, c.spent / c.monthlyLimit)) : 0;
return { c, weight: priorityScore * ceilingScore };
```

**After:**
```typescript
// Weight is purely priority-based. Spend ratio is not used here — high spend on a bucket
// does not mean it should receive more budget (see issue #44 for spend-based recommendations).
const priorityScore = c.priorityRank != null ? 1 / c.priorityRank : 0;
return { c, weight: priorityScore };
```

**Fallback change** — when all weights are 0 (all ranks null), distribute proportional to existing `targetPct` instead of returning `[]`:
```typescript
if (totalWeight === 0) {
  // All unranked — distribute proportionally to existing targetPct
  const totalPct = candidates.reduce((s, c) => s + c.targetPct, 0);
  if (totalPct === 0) return []; // nothing to weight against
  return candidates.map(c => ({
    id: c.id,
    newPct: Math.round((c.targetPct + freedPct * (c.targetPct / totalPct)) * 100) / 100,
  }));
}
```

This resolves issue #43: freed budget is never silently dropped when no priority ranks are set.

---

## Dependency

Install `react-native-draggable-flatlist`:
```bash
npm install react-native-draggable-flatlist
```

Peer dependencies `react-native-reanimated` and `react-native-gesture-handler` are already installed in this Expo bare project.

---

## Files Changed

| File | Change |
|------|--------|
| `mobile/src/hooks/useBudgets.ts` | Sort by `priority_rank`, init ranks on first load, `updateBucketRanks` export, next-rank in `createBudget` |
| `mobile/src/budget/redistributeOnDelete.ts` | Remove `ceilingScore`, fix null-rank fallback to proportional distribution |
| `mobile/src/screens/PlanScreen.tsx` | Replace `budgets.map()` with `DraggableFlatList` in `BucketsTab`, add `handleDragEnd`, `renderBucketItem`, `bucketCardDragging` style |
| `mobile/package.json` + `package-lock.json` | Add `react-native-draggable-flatlist` |

---

## ScrollView / FlatList Nesting

`DraggableFlatList` is a `FlatList` under the hood. Nesting a `FlatList` inside a `ScrollView` causes gesture conflicts on React Native — the outer scroll and inner drag fight for touch events.

The `BucketsTab` content is currently rendered inside PlanScreen's outer `ScrollView` (which also holds the tab bar and income/goals tabs). To resolve the conflict, `DraggableFlatList` must be rendered with `scrollEnabled={false}` so the outer `ScrollView` handles vertical scrolling, and the drag gesture handler takes over only during a long-press. `react-native-draggable-flatlist` supports this via the `dragHitSlop` and `activationDistance` props — setting `scrollEnabled={false}` and `activationDistance={5}` prevents accidental drag activation during normal scrolling.

```tsx
<DraggableFlatList
  data={budgets}
  keyExtractor={b => b.id}
  renderItem={renderBucketItem}
  onDragEnd={handleDragEnd}
  scrollEnabled={false}      // outer ScrollView handles scrolling
  activationDistance={5}     // prevents accidental drags during normal scroll
/>
```

---

## Out of Scope

- Spend-ratio as a recommendation signal (issue #44 — separate feature)
- Animated treemap tile reordering when priority changes (treemap already reflects any order)
- Priority rank display badge on cards (not needed — position in list is self-evident)
- Swipe-to-delete (existing long-press-to-delete is unchanged for goal cards; regular buckets already have delete in detail modal)
