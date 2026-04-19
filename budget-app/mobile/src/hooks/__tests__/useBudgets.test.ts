import { supabase } from '../../supabase/client';
import type { BudgetCategory } from '../useBudgets';

jest.mock('../../supabase/client', () => ({
  supabase: {
    from: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockResolvedValue({ error: null }),
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
  },
}));

import { updateBudget, rebalanceBucketPct, deleteBudgetWithRedistribution } from '../useBudgets';

describe('updateBudget', () => {
  it('sends target_pct and monthly_limit to supabase', async () => {
    const fromMock = supabase.from as jest.Mock;
    const updateMock = jest.fn().mockReturnThis();
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    fromMock.mockReturnValue({ update: updateMock, eq: eqMock });
    updateMock.mockReturnValue({ eq: eqMock });

    await updateBudget('abc', { monthlyLimit: 500, targetPct: 15 });

    expect(fromMock).toHaveBeenCalledWith('budget_categories');
    expect(updateMock).toHaveBeenCalledWith({ monthly_limit: 500, target_pct: 15 });
    expect(eqMock).toHaveBeenCalledWith('id', 'abc');
  });

  it('only sends provided fields', async () => {
    const fromMock = supabase.from as jest.Mock;
    const updateMock = jest.fn().mockReturnThis();
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    fromMock.mockReturnValue({ update: updateMock, eq: eqMock });
    updateMock.mockReturnValue({ eq: eqMock });

    await updateBudget('abc', { targetPct: 10 });

    expect(updateMock).toHaveBeenCalledWith({ target_pct: 10 });
  });
});

function bucket(overrides: Partial<BudgetCategory> & { id: string }): BudgetCategory {
  return {
    name: 'X', emoji: '💰', monthlyLimit: 500, monthlyFloor: 0,
    color: '#000', targetPct: 20, isGoal: false, goalId: null,
    priorityRank: null, plaidCategory: null, spent: 0,
    ...overrides,
  };
}

describe('rebalanceBucketPct — increasing into unallocated', () => {
  it('only updates target bucket when delta fits in unallocated space', async () => {
    // total = 60%, unallocated = 40%, delta = 10% — all from unallocated
    const cats = [
      bucket({ id: 'target', targetPct: 30 }),
      bucket({ id: 'other',  targetPct: 30 }),
    ];
    const updates: Array<{ patch: unknown; val: unknown }> = [];
    const fromMock = supabase.from as jest.Mock;
    fromMock.mockImplementation(() => ({
      update: (patch: unknown) => ({
        eq: (_: string, val: unknown) => {
          updates.push({ patch, val });
          return Promise.resolve({ error: null });
        },
      }),
    }));

    await rebalanceBucketPct('target', 40, cats, 2500);

    expect(updates).toHaveLength(1);
    expect(updates[0].val).toBe('target');
    expect((updates[0].patch as { target_pct: number }).target_pct).toBeCloseTo(40, 1);
  });
});

describe('rebalanceBucketPct — decreasing', () => {
  it('only updates the target bucket, others unchanged', async () => {
    const cats = [
      bucket({ id: 'target', targetPct: 30 }),
      bucket({ id: 'other',  targetPct: 30 }),
    ];
    const updates: Array<{ val: unknown }> = [];
    const fromMock = supabase.from as jest.Mock;
    fromMock.mockImplementation(() => ({
      update: () => ({
        eq: (_: string, val: unknown) => {
          updates.push({ val });
          return Promise.resolve({ error: null });
        },
      }),
    }));

    await rebalanceBucketPct('target', 20, cats, 2500);

    expect(updates).toHaveLength(1);
    expect(updates[0].val).toBe('target');
  });
});

describe('deleteBudgetWithRedistribution', () => {
  it('deletes bucket and updates ranked remaining buckets', async () => {
    const cats = [
      bucket({ id: 'del',  targetPct: 10, priorityRank: null, spent: 0 }),
      bucket({ id: 'keep', targetPct: 30, priorityRank: 1, spent: 300, monthlyLimit: 500 }),
    ];
    const ops: Array<{ op: string; table: string; patch?: unknown; val: unknown }> = [];
    const fromMock = supabase.from as jest.Mock;
    fromMock.mockImplementation((table: string) => ({
      delete: () => ({
        eq: (_: string, val: unknown) => {
          ops.push({ op: 'delete', table, val });
          return Promise.resolve({ error: null });
        },
      }),
      update: (patch: unknown) => ({
        eq: (_: string, val: unknown) => {
          ops.push({ op: 'update', table, patch, val });
          return Promise.resolve({ error: null });
        },
      }),
    }));

    await deleteBudgetWithRedistribution('del', cats);

    const del = ops.find(o => o.op === 'delete');
    const upd = ops.find(o => o.op === 'update');
    expect(del?.val).toBe('del');
    expect(upd).toBeDefined();
    // 'keep' is the only ranked candidate, so it receives all 10% freed from 'del': 30 + 10 = 40
    expect((upd?.patch as { target_pct: number }).target_pct).toBeCloseTo(40, 1);
  });
});
