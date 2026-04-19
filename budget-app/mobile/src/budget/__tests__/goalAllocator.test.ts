// Mock the supabase client so the module can load in Jest without real env vars
jest.mock('../../supabase/client', () => ({
  supabase: {
    from: jest.fn(),
    auth: { getUser: jest.fn() },
  },
}));

import { previewGoalAllocation } from '../goalAllocator';
import type { BudgetCategory } from '../../hooks/useBudgets';

function makeBucket(overrides: Partial<BudgetCategory> & { id: string }): BudgetCategory {
  return {
    name: 'Test', emoji: '💰', monthlyLimit: 500, monthlyFloor: 0,
    color: '#6366f1', targetPct: 20, isGoal: false, goalId: null,
    priorityRank: null, plaidCategory: null, spent: 0,
    ...overrides,
  };
}

// Use a fixed offset of exactly 6×30 days so monthsUntil() returns ceil(180/30)=6
// regardless of calendar month lengths. This keeps assertions on goalTargetPct stable.
const futureDate = (() => {
  const d = new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000);
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
