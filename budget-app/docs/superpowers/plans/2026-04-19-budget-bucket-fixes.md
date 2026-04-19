# Budget Bucket Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix slider smoothness, the 80%-ceiling unallocated budget bug, smart priority-weighted redistribution on delete, and remove-confirmed-fixed-charge.

**Architecture:** All fixes are client-side TypeScript. One new pure utility (`computeRedistribution`) is shared by goal deletion and bucket deletion. No schema changes. All Supabase writes follow existing patterns in `useBudgets.ts` and `goalAllocator.ts`. `PlanScreen.tsx` is modified in-place following its existing style.

**Tech Stack:** React Native (Expo bare), Supabase JS v2, TypeScript, Jest + @testing-library/react-native.

---

## File Map

| File | Action | Role |
|---|---|---|
| `budget-app/mobile/src/budget/redistributeOnDelete.ts` | Create | Pure utility: computes weighted % redistribution on deletion |
| `budget-app/mobile/src/budget/__tests__/redistributeOnDelete.test.ts` | Create | Unit tests for redistributeOnDelete |
| `budget-app/mobile/src/budget/__tests__/goalAllocator.test.ts` | Create | Unit tests for updated previewGoalAllocation |
| `budget-app/mobile/src/budget/goalAllocator.ts` | Modify | Use unallocated-first in preview; smart redistribution in removeGoalAllocation |
| `budget-app/mobile/src/hooks/useBudgets.ts` | Modify | Unallocated-first when increasing; no redistribution when decreasing; new deleteBudgetWithRedistribution |
| `budget-app/mobile/src/screens/PlanScreen.tsx` | Modify | Smooth slider, sliderMax includes unallocated, remove confirmed fixed charge button, updated delete import |

---

## Task 1: `computeRedistribution` utility

**Files:**
- Create: `budget-app/mobile/src/budget/redistributeOnDelete.ts`
- Create: `budget-app/mobile/src/budget/__tests__/redistributeOnDelete.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `budget-app/mobile/src/budget/__tests__/redistributeOnDelete.test.ts`:

```typescript
import { computeRedistribution } from '../redistributeOnDelete';

test('distributes freed pct weighted by priority × ceiling', () => {
  // weight_a = (1/1) * (400/500) = 0.8
  // weight_b = (1/2) * (100/500) = 0.1
  // total = 0.9 → a gets 0.8/0.9, b gets 0.1/0.9
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, monthlyLimit: 500, spent: 400, priorityRank: 1 },
    { id: 'b', targetPct: 15, monthlyLimit: 500, spent: 100, priorityRank: 2 },
  ], 10);
  const a = result.find(r => r.id === 'a')!;
  const b = result.find(r => r.id === 'b')!;
  expect(a.newPct).toBeCloseTo(20 + 10 * (0.8 / 0.9), 1);
  expect(b.newPct).toBeCloseTo(15 + 10 * (0.1 / 0.9), 1);
});

test('falls back to priority-only when all spent = 0', () => {
  // a weight=1/1=1.0, b weight=1/2=0.5, total=1.5
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, monthlyLimit: 500, spent: 0, priorityRank: 1 },
    { id: 'b', targetPct: 15, monthlyLimit: 500, spent: 0, priorityRank: 2 },
  ], 10);
  const a = result.find(r => r.id === 'a')!;
  const b = result.find(r => r.id === 'b')!;
  expect(a.newPct).toBeCloseTo(20 + 10 * (1 / 1.5), 1);
  expect(b.newPct).toBeCloseTo(15 + 10 * (0.5 / 1.5), 1);
});

test('returns empty when all candidates are unranked (freed stays unallocated)', () => {
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, monthlyLimit: 500, spent: 400, priorityRank: null },
    { id: 'b', targetPct: 15, monthlyLimit: 500, spent: 100, priorityRank: null },
  ], 10);
  expect(result).toEqual([]);
});

test('unranked candidates are excluded from distribution', () => {
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, monthlyLimit: 500, spent: 400, priorityRank: 1 },
    { id: 'b', targetPct: 15, monthlyLimit: 500, spent: 100, priorityRank: null },
  ], 10);
  expect(result.find(r => r.id === 'b')).toBeUndefined();
  expect(result.find(r => r.id === 'a')).toBeDefined();
});

test('returns empty when freedPct is 0', () => {
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, monthlyLimit: 500, spent: 400, priorityRank: 1 },
  ], 0);
  expect(result).toEqual([]);
});

test('clamps ceilingScore at 1 when spent > monthlyLimit', () => {
  // spent(600) > limit(500) → ceilingScore clamped to 1
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, monthlyLimit: 500, spent: 600, priorityRank: 1 },
    { id: 'b', targetPct: 15, monthlyLimit: 500, spent: 400, priorityRank: 1 },
  ], 10);
  // weight_a = 1*1=1, weight_b = 1*0.8=0.8, total=1.8
  const a = result.find(r => r.id === 'a')!;
  const b = result.find(r => r.id === 'b')!;
  expect(a.newPct).toBeCloseTo(20 + 10 * (1 / 1.8), 1);
  expect(b.newPct).toBeCloseTo(15 + 10 * (0.8 / 1.8), 1);
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd budget-app/mobile
npx jest src/budget/__tests__/redistributeOnDelete.test.ts --no-coverage 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module '../redistributeOnDelete'`

- [ ] **Step 3: Implement the utility**

Create `budget-app/mobile/src/budget/redistributeOnDelete.ts`:

```typescript
export interface RedistributionCandidate {
  id: string;
  targetPct: number;
  monthlyLimit: number;
  spent: number;
  priorityRank: number | null;
}

export interface RedistributionResult {
  id: string;
  newPct: number;
}

/**
 * Distributes freedPct among candidates weighted by priority rank × ceiling proximity.
 *
 * Weight formula per candidate:
 *   priorityScore = 1 / rank  (null rank → excluded, receives nothing)
 *   ceilingScore  = clamp(spent / monthlyLimit, 0, 1)
 *   weight        = priorityScore × ceilingScore
 *
 * Fallback when all weights = 0 (no spend data): use priority-only.
 * If still all zero (all unranked): return [] — freed % stays unallocated.
 */
export function computeRedistribution(
  candidates: RedistributionCandidate[],
  freedPct: number,
): RedistributionResult[] {
  if (freedPct <= 0 || candidates.length === 0) return [];

  const withWeights = candidates.map(c => {
    const priorityScore = c.priorityRank != null ? 1 / c.priorityRank : 0;
    const ceilingScore = c.monthlyLimit > 0 ? Math.min(1, c.spent / c.monthlyLimit) : 0;
    return { c, weight: priorityScore * ceilingScore };
  });

  let totalWeight = withWeights.reduce((s, x) => s + x.weight, 0);

  // Fallback: no spend data yet — use priority-only
  if (totalWeight === 0) {
    const priorityOnly = candidates.map(c => ({
      c,
      weight: c.priorityRank != null ? 1 / c.priorityRank : 0,
    }));
    totalWeight = priorityOnly.reduce((s, x) => s + x.weight, 0);
    // All unranked — leave freed % as unallocated
    if (totalWeight === 0) return [];
    return priorityOnly
      .filter(x => x.weight > 0)
      .map(x => ({
        id: x.c.id,
        newPct: Math.round((x.c.targetPct + freedPct * (x.weight / totalWeight)) * 100) / 100,
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

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd budget-app/mobile
npx jest src/budget/__tests__/redistributeOnDelete.test.ts --no-coverage 2>&1 | tail -10
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add budget-app/mobile/src/budget/redistributeOnDelete.ts \
        budget-app/mobile/src/budget/__tests__/redistributeOnDelete.test.ts
git commit -m "feat: add computeRedistribution utility — priority × ceiling weighted redistribution"
```

---

## Task 2: Update `goalAllocator.ts`

**Files:**
- Modify: `budget-app/mobile/src/budget/goalAllocator.ts`
- Create: `budget-app/mobile/src/budget/__tests__/goalAllocator.test.ts`

Two changes:
1. `previewGoalAllocation`: consume unallocated budget first before cutting from other buckets.
2. `removeGoalAllocation`: replace proportional redistribution with `computeRedistribution`.

- [ ] **Step 1: Write the failing tests**

Create `budget-app/mobile/src/budget/__tests__/goalAllocator.test.ts`:

```typescript
import { previewGoalAllocation } from '../goalAllocator';
import type { BudgetCategory } from '../../hooks/useBudgets';

// Minimal BudgetCategory factory
function makeBucket(overrides: Partial<BudgetCategory> & { id: string }): BudgetCategory {
  return {
    name: 'Test',
    emoji: '💰',
    monthlyLimit: 500,
    monthlyFloor: 0,
    color: '#6366f1',
    targetPct: 20,
    isGoal: false,
    goalId: null,
    priorityRank: null,
    plaidCategory: null,
    spent: 0,
    ...overrides,
  };
}

const futureDate = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() + 6);
  return d.toISOString().split('T')[0];
})();

test('uses unallocated budget first — no cuts when unallocated >= goalTargetPct', () => {
  // income=2500, goal needs $200/mo = 8%, total allocated = 60% → unallocated = 40%
  // 8% <= 40%, so no cuts from other buckets
  const buckets = [
    makeBucket({ id: 'a', targetPct: 40 }),
    makeBucket({ id: 'b', targetPct: 20 }),
  ];
  const goal = { name: 'Trip', targetAmount: 1200, startingAmount: 0, targetDate: futureDate };
  const preview = previewGoalAllocation(goal, buckets, 2500);
  expect(preview.feasible).toBe(true);
  expect(preview.cuts).toHaveLength(0);
});

test('cuts only the shortfall after consuming unallocated', () => {
  // income=2500, goal needs $500/mo = 20%, total allocated = 90% → unallocated = 10%
  // needFromOthers = 20% - 10% = 10%
  const buckets = [
    makeBucket({ id: 'a', targetPct: 50, monthlyFloor: 0 }),
    makeBucket({ id: 'b', targetPct: 40, monthlyFloor: 0 }),
  ];
  const goal = { name: 'Trip', targetAmount: 3000, startingAmount: 0, targetDate: futureDate };
  const preview = previewGoalAllocation(goal, buckets, 2500);
  expect(preview.feasible).toBe(true);
  // Total cuts should sum to ~10% (not 20%)
  const totalCut = preview.cuts.reduce((s, c) => s + Math.abs(c.delta), 0);
  expect(totalCut).toBeCloseTo(10, 0);
});

test('infeasible when unallocated + slack < goalTargetPct', () => {
  // income=2500, goal needs $1000/mo = 40%, total allocated = 90% → unallocated = 10%
  // buckets at floor so slack=0, needFromOthers=30%, totalSlack=0 → infeasible
  const buckets = [
    makeBucket({ id: 'a', targetPct: 50, monthlyFloor: 1250 }), // floor = 50%, slack=0
    makeBucket({ id: 'b', targetPct: 40, monthlyFloor: 1000 }), // floor = 40%, slack=0
  ];
  const goal = { name: 'Trip', targetAmount: 6000, startingAmount: 0, targetDate: futureDate };
  const preview = previewGoalAllocation(goal, buckets, 2500);
  expect(preview.feasible).toBe(false);
  expect(preview.shortfallPct).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd budget-app/mobile
npx jest src/budget/__tests__/goalAllocator.test.ts --no-coverage 2>&1 | tail -5
```

Expected: FAIL — first test fails because unallocated isn't consumed first.

- [ ] **Step 3: Update `previewGoalAllocation` in `goalAllocator.ts`**

Add the import at the top of `goalAllocator.ts` (after existing imports):
```typescript
import { computeRedistribution } from './redistributeOnDelete';
```

Replace the body of `previewGoalAllocation` from after `const goalTargetPct = ...` through to the end of the function with:

```typescript
  // How much of goalTargetPct can be covered by unallocated income?
  const totalAllocated = categories.reduce((s, c) => s + (c.targetPct ?? 0), 0);
  const unallocated = Math.max(0, 100 - totalAllocated);
  const needFromOthers = Math.max(0, goalTargetPct - unallocated);

  // If nothing needs to come from others, no cuts required
  if (needFromOthers <= 0.001) {
    return { goalTargetPct, monthlyContribution, cuts: [], feasible: true, shortfallPct: 0 };
  }

  // Only non-goal buckets can be cut
  const eligible = categories.filter(c => !c.isGoal && (c.targetPct ?? 0) > 0);

  // Compute available slack per bucket (above floor)
  const slacks = eligible.map(c => {
    const floorPct = (c.monthlyFloor / confirmedMonthlyIncome) * 100;
    const minPct = Math.max(floorPct, 1); // never below 1%
    const slack = Math.max(0, (c.targetPct ?? 0) - minPct);
    return { cat: c, slack, minPct };
  });

  const totalSlack = slacks.reduce((s, x) => s + x.slack, 0);

  if (totalSlack < needFromOthers) {
    return {
      goalTargetPct,
      monthlyContribution,
      cuts: [],
      feasible: false,
      shortfallPct: needFromOthers - totalSlack,
    };
  }

  // Distribute cut inversely weighted by targetPct (lower priority = bigger cut)
  let remaining = needFromOthers;
  const cutMap = new Map<string, number>(slacks.map(x => [x.cat.id, 0]));
  let uncapped = slacks.filter(x => x.slack > 0);

  while (remaining > 0.001 && uncapped.length > 0) {
    const totalWeight = uncapped.reduce((s, x) => s + (1 / (x.cat.targetPct ?? 1)), 0);

    for (const entry of uncapped) {
      const weight = (1 / (entry.cat.targetPct ?? 1)) / totalWeight;
      const rawCut = weight * remaining;
      const alreadyCut = cutMap.get(entry.cat.id) ?? 0;
      const maxAdditionalCut = entry.slack - alreadyCut;
      const actualCut = Math.min(rawCut, maxAdditionalCut);
      cutMap.set(entry.cat.id, alreadyCut + actualCut);
    }

    const distributed = [...cutMap.values()].reduce((s, v) => s + v, 0);
    remaining = needFromOthers - distributed;

    uncapped = uncapped.filter(x => {
      const cut = cutMap.get(x.cat.id) ?? 0;
      return cut < x.slack - 0.001;
    });
  }

  const cuts = slacks
    .map(x => {
      const cut = cutMap.get(x.cat.id) ?? 0;
      const oldPct = x.cat.targetPct ?? 0;
      const newPct = Math.round((oldPct - cut) * 100) / 100;
      return {
        categoryId: x.cat.id,
        name: x.cat.name,
        oldPct,
        newPct,
        delta: Math.round(-cut * 100) / 100,
      };
    })
    .filter(c => Math.abs(c.delta) > 0.001);

  return { goalTargetPct, monthlyContribution, cuts, feasible: true, shortfallPct: 0 };
```

- [ ] **Step 4: Update `removeGoalAllocation` in `goalAllocator.ts`**

Replace the body of `removeGoalAllocation` (keep the function signature and the `goalCat` lookup):

```typescript
export async function removeGoalAllocation(
  goalId: string,
  categories: BudgetCategory[]
): Promise<void> {
  const goalCat = categories.find(c => c.goalId === goalId);
  if (!goalCat) return;

  const freedPct = goalCat.targetPct ?? 0;

  const candidates = categories
    .filter(c => !c.isGoal && (c.targetPct ?? 0) > 0)
    .map(c => ({
      id: c.id,
      targetPct: c.targetPct ?? 0,
      monthlyLimit: c.monthlyLimit,
      spent: c.spent,
      priorityRank: c.priorityRank,
    }));

  const redistributed = computeRedistribution(candidates, freedPct);

  const deleteCategory = supabase
    .from('budget_categories')
    .delete()
    .eq('goal_id', goalId);

  const deleteGoal = supabase
    .from('savings_goals')
    .delete()
    .eq('id', goalId);

  await Promise.all([
    deleteCategory,
    deleteGoal,
    ...redistributed.map(r =>
      supabase.from('budget_categories').update({ target_pct: r.newPct }).eq('id', r.id)
    ),
  ]);
}
```

- [ ] **Step 5: Run tests**

```bash
cd budget-app/mobile
npx jest src/budget/__tests__/ --no-coverage 2>&1 | tail -10
```

Expected: all tests PASS (both files).

- [ ] **Step 6: Commit**

```bash
git add budget-app/mobile/src/budget/goalAllocator.ts \
        budget-app/mobile/src/budget/__tests__/goalAllocator.test.ts
git commit -m "fix: goalAllocator uses unallocated budget first; smart redistribution on goal delete"
```

---

## Task 3: Update `useBudgets.ts`

**Files:**
- Modify: `budget-app/mobile/src/hooks/useBudgets.ts`
- Modify: `budget-app/mobile/src/hooks/__tests__/useBudgets.test.ts`

Two changes:
1. `rebalanceBucketPct`: when increasing, consume unallocated first; when decreasing, only update target bucket (do not redistribute to others).
2. New export `deleteBudgetWithRedistribution` that uses `computeRedistribution`.

- [ ] **Step 1: Write the failing tests**

Open `budget-app/mobile/src/hooks/__tests__/useBudgets.test.ts`. The file already has `import { updateBudget } from '../useBudgets'` — add `rebalanceBucketPct` and `deleteBudgetWithRedistribution` to that same import line so it reads:

```typescript
import { updateBudget, rebalanceBucketPct, deleteBudgetWithRedistribution } from '../useBudgets';
```

Then append the following to the end of the file (do NOT add a second import line):

```typescript
import type { BudgetCategory } from '../useBudgets';

function mockFrom(impl: (table: string) => any) {
  (supabase.from as jest.Mock).mockImplementation(impl);
}

function bucket(overrides: Partial<BudgetCategory> & { id: string }): BudgetCategory {
  return {
    name: 'X', emoji: '💰', monthlyLimit: 500, monthlyFloor: 0,
    color: '#000', targetPct: 20, isGoal: false, goalId: null,
    priorityRank: null, plaidCategory: null, spent: 0,
    ...overrides,
  };
}

describe('rebalanceBucketPct — increasing', () => {
  it('consumes unallocated first without touching other buckets', async () => {
    // total = 60%, unallocated = 40%, delta = 10% — all from unallocated
    const cats = [
      bucket({ id: 'target', targetPct: 30 }),
      bucket({ id: 'other',  targetPct: 30 }),
    ];
    const updates: any[] = [];
    mockFrom(() => ({
      update: (patch: any) => ({ eq: (col: string, val: string) => { updates.push({ patch, val }); return Promise.resolve({ error: null }); } }),
    }));

    await rebalanceBucketPct('target', 40, cats, 2500);

    // only 'target' should be updated
    expect(updates).toHaveLength(1);
    expect(updates[0].val).toBe('target');
    expect(updates[0].patch.target_pct).toBeCloseTo(40, 1);
  });
});

describe('rebalanceBucketPct — decreasing', () => {
  it('only updates the target bucket, leaving others unchanged', async () => {
    const cats = [
      bucket({ id: 'target', targetPct: 30 }),
      bucket({ id: 'other',  targetPct: 30 }),
    ];
    const updates: any[] = [];
    mockFrom(() => ({
      update: (patch: any) => ({ eq: (_: string, val: string) => { updates.push({ patch, val }); return Promise.resolve({ error: null }); } }),
    }));

    await rebalanceBucketPct('target', 20, cats, 2500);

    expect(updates).toHaveLength(1);
    expect(updates[0].val).toBe('target');
  });
});

describe('deleteBudgetWithRedistribution', () => {
  it('deletes the bucket and redistributes freed pct to ranked buckets', async () => {
    const cats = [
      bucket({ id: 'del',  targetPct: 10, priorityRank: null, spent: 0 }),
      bucket({ id: 'keep', targetPct: 30, priorityRank: 1, spent: 300, monthlyLimit: 500 }),
    ];
    const ops: any[] = [];
    mockFrom((table: string) => ({
      delete: () => ({ eq: (_: string, val: string) => { ops.push({ op: 'delete', table, val }); return Promise.resolve({ error: null }); } }),
      update: (patch: any) => ({ eq: (_: string, val: string) => { ops.push({ op: 'update', table, patch, val }); return Promise.resolve({ error: null }); } }),
    }));

    await deleteBudgetWithRedistribution('del', cats);

    const del = ops.find(o => o.op === 'delete');
    const upd = ops.find(o => o.op === 'update');
    expect(del?.val).toBe('del');
    expect(upd?.patch.target_pct).toBeGreaterThan(30);
  });
});
```

- [ ] **Step 2: Run to confirm new tests fail**

```bash
cd budget-app/mobile
npx jest src/hooks/__tests__/useBudgets.test.ts --no-coverage 2>&1 | tail -10
```

Expected: new tests FAIL (functions don't exist yet / old behaviour).

- [ ] **Step 3: Add import to `useBudgets.ts`**

At the top of `budget-app/mobile/src/hooks/useBudgets.ts`, add after the existing imports:

```typescript
import { computeRedistribution } from '../budget/redistributeOnDelete';
```

- [ ] **Step 4: Rewrite `rebalanceBucketPct` in `useBudgets.ts`**

Replace the entire `rebalanceBucketPct` function with:

```typescript
export async function rebalanceBucketPct(
  id: string,
  newPct: number,
  allCategories: BudgetCategory[],
  monthlyIncome: number,
): Promise<void> {
  const current = allCategories.find(c => c.id === id);
  if (!current) return;

  const oldPct = current.targetPct ?? 0;
  const delta = newPct - oldPct;
  if (Math.abs(delta) < 0.01) return;

  const updates: Array<{ id: string; newPct: number }> = [
    { id, newPct: Math.round(newPct * 100) / 100 },
  ];

  if (delta > 0) {
    // Consume unallocated budget first, then cut from others only if needed
    const totalAllocated = allCategories.reduce((s, c) => s + (c.targetPct ?? 0), 0);
    const unallocated = Math.max(0, 100 - totalAllocated);
    const fromOthers = Math.max(0, delta - unallocated);

    if (fromOthers > 0.001) {
      const others = allCategories.filter(c => c.id !== id && !c.isGoal && (c.targetPct ?? 0) > 0);
      const slacks = others.map(c => {
        const floorPct = monthlyIncome > 0 ? (c.monthlyFloor / monthlyIncome) * 100 : 0;
        const minPct = Math.max(floorPct, 1);
        return { cat: c, slack: Math.max(0, (c.targetPct ?? 0) - minPct) };
      });

      let remaining = fromOthers;
      const cutMap = new Map(slacks.map(x => [x.cat.id, 0]));
      let uncapped = slacks.filter(x => x.slack > 0);

      while (remaining > 0.001 && uncapped.length > 0) {
        const totalWeight = uncapped.reduce((s, x) => s + (1 / (x.cat.targetPct ?? 1)), 0);
        for (const entry of uncapped) {
          const weight = (1 / (entry.cat.targetPct ?? 1)) / totalWeight;
          const alreadyCut = cutMap.get(entry.cat.id) ?? 0;
          const actual = Math.min(weight * remaining, entry.slack - alreadyCut);
          cutMap.set(entry.cat.id, alreadyCut + actual);
        }
        const distributed = [...cutMap.values()].reduce((s, v) => s + v, 0);
        remaining = fromOthers - distributed;
        uncapped = uncapped.filter(x => (cutMap.get(x.cat.id) ?? 0) < x.slack - 0.001);
      }

      for (const [otherId, cut] of cutMap) {
        if (Math.abs(cut) > 0.001) {
          const cat = allCategories.find(c => c.id === otherId)!;
          updates.push({ id: otherId, newPct: Math.round(((cat.targetPct ?? 0) - cut) * 100) / 100 });
        }
      }
    }
    // If delta <= unallocated, only the target bucket is updated (no other changes needed)
  }
  // Decreasing: only update target bucket — freed % stays unallocated

  await Promise.all(
    updates.map(u =>
      supabase.from('budget_categories').update({ target_pct: u.newPct }).eq('id', u.id),
    ),
  );
}
```

- [ ] **Step 5: Add `deleteBudgetWithRedistribution` to `useBudgets.ts`**

Add this function after `deleteBudget`:

```typescript
export async function deleteBudgetWithRedistribution(
  id: string,
  allCategories: BudgetCategory[],
): Promise<void> {
  const target = allCategories.find(c => c.id === id);
  const freedPct = target?.targetPct ?? 0;

  const candidates = allCategories
    .filter(c => c.id !== id && !c.isGoal && (c.targetPct ?? 0) > 0)
    .map(c => ({
      id: c.id,
      targetPct: c.targetPct ?? 0,
      monthlyLimit: c.monthlyLimit,
      spent: c.spent,
      priorityRank: c.priorityRank,
    }));

  const redistributed = computeRedistribution(candidates, freedPct);

  await Promise.all([
    supabase.from('budget_categories').delete().eq('id', id),
    ...redistributed.map(r =>
      supabase.from('budget_categories').update({ target_pct: r.newPct }).eq('id', r.id)
    ),
  ]);
}
```

- [ ] **Step 6: Run all tests**

```bash
cd budget-app/mobile
npx jest --no-coverage 2>&1 | tail -15
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add budget-app/mobile/src/hooks/useBudgets.ts \
        budget-app/mobile/src/hooks/__tests__/useBudgets.test.ts
git commit -m "fix: rebalanceBucketPct uses unallocated-first; add deleteBudgetWithRedistribution"
```

---

## Task 4: Fix `PercentSlider` and `sliderMax` in `PlanScreen.tsx`

**Files:**
- Modify: `budget-app/mobile/src/screens/PlanScreen.tsx` (lines 59–113 for slider, lines 519–530 for sliderMax, lines 561–574 for handleDelete)

- [ ] **Step 1: Replace `PercentSlider` function (lines 59–113)**

Replace the entire `PercentSlider` function with:

```typescript
function PercentSlider({
  value, min, max, step = 0.5, onChange,
}: {
  value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const widthRef = useRef(0);
  const trackPageXRef = useRef(0);
  const trackRef = useRef<View>(null);
  // propsRef is updated every render so PanResponder callbacks always see fresh props
  const propsRef = useRef({ min, max, step, onChange });
  propsRef.current = { min, max, step, onChange };

  const computeValue = (absoluteX: number) => {
    const { min: mn, max: mx, step: st, onChange: cb } = propsRef.current;
    const w = widthRef.current;
    if (w <= 0) return;
    const x = absoluteX - trackPageXRef.current;
    const raw = mn + (Math.max(0, Math.min(w, x)) / w) * (mx - mn);
    cb(Math.max(mn, Math.min(mx, Math.round(raw / st) * st)));
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (_, gestureState) => {
        // Re-measure on each grant to handle scroll offsets
        trackRef.current?.measure((_x, _y, _w, _h, pageX) => {
          trackPageXRef.current = pageX;
          computeValue(gestureState.x0);
        });
      },
      onPanResponderMove: (_, gestureState) => {
        computeValue(gestureState.moveX);
      },
    })
  ).current;

  const fraction = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  const thumbX = trackWidth > 0 ? fraction * trackWidth : 0;

  return (
    <View
      ref={trackRef}
      style={ss.sliderTrack}
      onLayout={e => {
        const w = e.nativeEvent.layout.width;
        widthRef.current = w;
        setTrackWidth(w);
        // Cache pageX on layout too, so first tap is accurate even before a grant
        trackRef.current?.measure((_x, _y, _w, _h, pageX) => {
          trackPageXRef.current = pageX;
        });
      }}
      {...pan.panHandlers}
    >
      <View style={[ss.sliderFill, { width: thumbX }]} />
      {trackWidth > 0 && (
        <View style={[ss.sliderThumb, { left: thumbX - THUMB_R }]} />
      )}
    </View>
  );
}
```

- [ ] **Step 2: Fix `sliderMax` in `BucketDetailModal` (around line 529)**

Find:
```typescript
  const sliderMax = Math.min(100, (budget?.targetPct ?? 0) + othersSlack);
```

Replace with:
```typescript
  const allocatedTotal = allBudgets.reduce((s, b) => s + (b.targetPct ?? 0), 0);
  const unallocated = Math.max(0, 100 - allocatedTotal);
  const sliderMax = Math.min(100, (budget?.targetPct ?? 0) + othersSlack + unallocated);
```

- [ ] **Step 3: Update `handleDelete` in `BucketDetailModal` to use `deleteBudgetWithRedistribution`**

Update the import at the top of `PlanScreen.tsx`. Find:
```typescript
import { useBudgets, createBudget, updateBudget, deleteBudget, rebalanceBucketPct } from '../hooks/useBudgets';
```

Replace with:
```typescript
import { useBudgets, createBudget, updateBudget, deleteBudget, deleteBudgetWithRedistribution, rebalanceBucketPct } from '../hooks/useBudgets';
```

Then find the `handleDelete` function inside `BucketDetailModal` (around line 561):
```typescript
  const handleDelete = () => {
    if (!budget) return;
    Alert.alert(`Delete "${budget.name}"?`, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await deleteBudget(budget.id);
          onDeleted();
          onClose();
        },
      },
    ]);
  };
```

Replace with:
```typescript
  const handleDelete = () => {
    if (!budget) return;
    Alert.alert(`Delete "${budget.name}"?`, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await deleteBudgetWithRedistribution(budget.id, allBudgets);
          onDeleted();
          onClose();
        },
      },
    ]);
  };
```

- [ ] **Step 4: Run tests**

```bash
cd budget-app/mobile
npx jest --no-coverage 2>&1 | tail -15
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add budget-app/mobile/src/screens/PlanScreen.tsx
git commit -m "fix: smooth PercentSlider using gestureState.moveX; sliderMax includes unallocated budget"
```

---

## Task 5: Remove confirmed fixed charge button

**Files:**
- Modify: `budget-app/mobile/src/screens/PlanScreen.tsx` (BucketDetailModal fixed charges section, lines 666–692)

- [ ] **Step 1: Add `handleRemoveConfirmedFixed` handler**

Inside `BucketDetailModal`, after the existing `handleDismissFixed` function (around line 590), add:

```typescript
  const handleRemoveConfirmedFixed = (fi: FixedItem) => {
    Alert.alert(
      'Remove fixed charge?',
      `${fi.merchantName} will no longer count toward this bucket's floor.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            await dismissFixedItem(fi.id);
            await recomputeFloor(fi.categoryId);
            onReloadFixed();
            const newFloor = fixedItems
              .filter(x => x.id !== fi.id && x.isConfirmed && !x.needsReview)
              .reduce((s, x) => s + x.effectiveAmount, 0);
            setFloorInput(String(Math.round(newFloor)));
          },
        },
      ]
    );
  };
```

- [ ] **Step 2: Update the confirmed fixed item row to show a remove button**

Find the confirmed chip section inside the `fixedItems.map` (around line 676):

```tsx
                {fi.isConfirmed && !fi.needsReview ? (
                  <View style={s.confirmedChip}>
                    <Text style={s.confirmedChipText}>Fixed</Text>
                  </View>
                ) : (
```

Replace with:

```tsx
                {fi.isConfirmed && !fi.needsReview ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={s.confirmedChip}>
                      <Text style={s.confirmedChipText}>Fixed</Text>
                    </View>
                    <TouchableOpacity onPress={() => handleRemoveConfirmedFixed(fi)}>
                      <Text style={{ color: '#ef4444', fontSize: 16, fontWeight: '600' }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
```

- [ ] **Step 3: Run tests**

```bash
cd budget-app/mobile
npx jest --no-coverage 2>&1 | tail -15
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add budget-app/mobile/src/screens/PlanScreen.tsx
git commit -m "feat: add remove button for confirmed fixed charges in BucketDetailModal"
```

---

## Task 6: Final check + push

- [ ] **Step 1: Full test suite**

```bash
cd budget-app/mobile
npx jest --no-coverage 2>&1 | tail -20
```

Expected: all tests PASS, no failures.

- [ ] **Step 2: TypeScript check**

```bash
cd budget-app/mobile
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors in modified files.

- [ ] **Step 3: Push branch**

```bash
git push origin feat/budget-bucket-fixes
```

PR #39 (`bartheart/tower#39`) will update automatically.
