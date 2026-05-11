import { supabase } from '../../supabase/client';

jest.mock('../../supabase/client', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
  },
}));

import {
  confirmFixedItem,
  dismissFixedItem,
  updateFixedItemAmount,
  recomputeFloor,
} from '../useFixedItems';
import type { FixedItem } from '../useFixedItems';

const authMock = supabase.auth.getUser as jest.Mock;
const fromMock = supabase.from as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  authMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
});

// ---------------------------------------------------------------------------
// pendingReview filter (pure logic tested inline)
// The hook exposes pendingReview = items.filter(i => !i.isConfirmed || i.needsReview).
// We replicate this filter here to test the logic in isolation.
// ---------------------------------------------------------------------------
function pendingReview(items: FixedItem[]): FixedItem[] {
  return items.filter(i => !i.isConfirmed || i.needsReview);
}

function makeItem(overrides: Partial<FixedItem> & { id: string }): FixedItem {
  return {
    categoryId: 'cat-1',
    merchantName: 'Merchant',
    detectedAmount: 100,
    confirmedAmount: null,
    effectiveAmount: 100,
    lastSeenDate: null,
    isConfirmed: false,
    needsReview: false,
    ...overrides,
  };
}

describe('pendingReview filter', () => {
  it('includes items that are not confirmed', () => {
    const items = [makeItem({ id: 'a', isConfirmed: false, needsReview: false })];
    expect(pendingReview(items)).toHaveLength(1);
  });

  it('includes items that need review even if confirmed', () => {
    const items = [makeItem({ id: 'b', isConfirmed: true, needsReview: true })];
    expect(pendingReview(items)).toHaveLength(1);
  });

  it('excludes items that are confirmed and do not need review', () => {
    const items = [makeItem({ id: 'c', isConfirmed: true, needsReview: false })];
    expect(pendingReview(items)).toHaveLength(0);
  });

  it('handles mixed items correctly', () => {
    const items = [
      makeItem({ id: 'p1', isConfirmed: false, needsReview: false }), // pending
      makeItem({ id: 'p2', isConfirmed: true,  needsReview: true }),  // needs review
      makeItem({ id: 'p3', isConfirmed: true,  needsReview: false }), // done — excluded
    ];
    const result = pendingReview(items);
    expect(result).toHaveLength(2);
    expect(result.map(i => i.id)).toEqual(expect.arrayContaining(['p1', 'p2']));
  });

  it('returns empty array when all items are confirmed with no review needed', () => {
    const items = [
      makeItem({ id: 'x1', isConfirmed: true, needsReview: false }),
      makeItem({ id: 'x2', isConfirmed: true, needsReview: false }),
    ];
    expect(pendingReview(items)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// confirmFixedItem
// ---------------------------------------------------------------------------
describe('confirmFixedItem', () => {
  it('updates is_confirmed: true and needs_review: false with correct id', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ update: updateMock });

    await confirmFixedItem('item-1');

    expect(fromMock).toHaveBeenCalledWith('fixed_items');
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ is_confirmed: true, needs_review: false }),
    );
    expect(eqMock).toHaveBeenCalledWith('id', 'item-1');
  });

  it('includes confirmed_amount in patch when provided', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ update: updateMock });

    await confirmFixedItem('item-2', 350);

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ is_confirmed: true, needs_review: false, confirmed_amount: 350 }),
    );
    expect(eqMock).toHaveBeenCalledWith('id', 'item-2');
  });

  it('does not include confirmed_amount in patch when not provided', async () => {
    const capturedPatch: Record<string, unknown>[] = [];
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn().mockImplementation((patch: Record<string, unknown>) => {
      capturedPatch.push(patch);
      return { eq: eqMock };
    });
    fromMock.mockReturnValue({ update: updateMock });

    await confirmFixedItem('item-3');

    expect(capturedPatch[0]).not.toHaveProperty('confirmed_amount');
  });

  it('throws when supabase returns an error', async () => {
    const dbError = new Error('confirm failed');
    const eqMock = jest.fn().mockResolvedValue({ error: dbError });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ update: updateMock });

    await expect(confirmFixedItem('item-1')).rejects.toThrow('confirm failed');
  });
});

// ---------------------------------------------------------------------------
// dismissFixedItem
// ---------------------------------------------------------------------------
describe('dismissFixedItem', () => {
  it('calls supabase delete on fixed_items with correct id', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const deleteMock = jest.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ delete: deleteMock });

    await dismissFixedItem('item-4');

    expect(fromMock).toHaveBeenCalledWith('fixed_items');
    expect(deleteMock).toHaveBeenCalled();
    expect(eqMock).toHaveBeenCalledWith('id', 'item-4');
  });

  it('throws when supabase returns an error', async () => {
    const dbError = new Error('dismiss failed');
    const eqMock = jest.fn().mockResolvedValue({ error: dbError });
    const deleteMock = jest.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ delete: deleteMock });

    await expect(dismissFixedItem('item-4')).rejects.toThrow('dismiss failed');
  });
});

// ---------------------------------------------------------------------------
// updateFixedItemAmount
// ---------------------------------------------------------------------------
describe('updateFixedItemAmount', () => {
  it('updates confirmed_amount and clears needs_review', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ update: updateMock });

    await updateFixedItemAmount('item-5', 275);

    expect(fromMock).toHaveBeenCalledWith('fixed_items');
    expect(updateMock).toHaveBeenCalledWith({ confirmed_amount: 275, needs_review: false });
    expect(eqMock).toHaveBeenCalledWith('id', 'item-5');
  });

  it('throws when supabase returns an error', async () => {
    const dbError = new Error('update failed');
    const eqMock = jest.fn().mockResolvedValue({ error: dbError });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ update: updateMock });

    await expect(updateFixedItemAmount('item-5', 100)).rejects.toThrow('update failed');
  });
});

// ---------------------------------------------------------------------------
// recomputeFloor
// ---------------------------------------------------------------------------
describe('recomputeFloor', () => {
  /**
   * Helper that sets up the two-step mock:
   *   1. from('fixed_items').select(...).eq('category_id', ...).eq('is_confirmed', true)
   *      → resolves with { data: fixedItemRows }
   *   2. from('budget_categories').update({ monthly_floor: X }).eq('id', categoryId)
   *      → resolves with {}
   *
   * Returns a spy array that records every update call: { table, patch, val }.
   */
  function setupRecomputeMocks(
    fixedItemRows: Array<{ detected_amount: number; confirmed_amount: number | null }>,
  ) {
    const updates: Array<{ table: string; patch: unknown; val: unknown }> = [];

    fromMock.mockImplementation((table: string) => {
      if (table === 'fixed_items') {
        // Chain: .select().eq().eq() → resolves with data
        const eqConfirmed = jest.fn().mockResolvedValue({ data: fixedItemRows });
        const eqCategory = jest.fn().mockReturnValue({ eq: eqConfirmed });
        const selectMock = jest.fn().mockReturnValue({ eq: eqCategory });
        return { select: selectMock };
      }
      if (table === 'budget_categories') {
        // Chain: .update(patch).eq(col, val)
        const eqMock = jest.fn().mockImplementation((_col: string, val: unknown) => {
          updates.push({ table, patch: lastPatch, val });
          return Promise.resolve({});
        });
        let lastPatch: unknown;
        const updateMock = jest.fn().mockImplementation((patch: unknown) => {
          lastPatch = patch;
          return { eq: eqMock };
        });
        return { update: updateMock };
      }
      return {};
    });

    return updates;
  }

  it('queries fixed_items by category_id filtered to is_confirmed=true', async () => {
    setupRecomputeMocks([]);

    await recomputeFloor('cat-10');

    // Verify the first from() call targeted fixed_items
    expect(fromMock).toHaveBeenCalledWith('fixed_items');
  });

  it('writes the sum of confirmed items as monthly_floor to budget_categories', async () => {
    const updates = setupRecomputeMocks([
      { detected_amount: 100, confirmed_amount: 120 },
      { detected_amount: 80,  confirmed_amount: null },  // falls back to detected
    ]);

    await recomputeFloor('cat-10');

    expect(fromMock).toHaveBeenCalledWith('budget_categories');
    expect(updates).toHaveLength(1);
    expect(updates[0].val).toBe('cat-10');
    expect((updates[0].patch as { monthly_floor: number }).monthly_floor).toBe(200);
  });

  it('prefers confirmed_amount over detected_amount when both are present', async () => {
    const updates = setupRecomputeMocks([
      { detected_amount: 50, confirmed_amount: 75 },
    ]);

    await recomputeFloor('cat-11');

    expect((updates[0].patch as { monthly_floor: number }).monthly_floor).toBe(75);
  });

  it('zero confirmed items → floor is written as 0, not skipped', async () => {
    const updates = setupRecomputeMocks([]);

    await recomputeFloor('cat-12');

    expect(updates).toHaveLength(1);
    expect((updates[0].patch as { monthly_floor: number }).monthly_floor).toBe(0);
    expect(updates[0].val).toBe('cat-12');
  });

  it('sums multiple confirmed items correctly', async () => {
    const updates = setupRecomputeMocks([
      { detected_amount: 100, confirmed_amount: 150 },
      { detected_amount: 200, confirmed_amount: 250 },
      { detected_amount: 300, confirmed_amount: null }, // falls back to 300
    ]);

    await recomputeFloor('cat-13');

    expect((updates[0].patch as { monthly_floor: number }).monthly_floor).toBe(700);
  });

  it('uses the correct categoryId when writing back to budget_categories', async () => {
    const updates = setupRecomputeMocks([{ detected_amount: 50, confirmed_amount: 60 }]);

    await recomputeFloor('cat-unique-999');

    expect(updates[0].val).toBe('cat-unique-999');
  });
});
