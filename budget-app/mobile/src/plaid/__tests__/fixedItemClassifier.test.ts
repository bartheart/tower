import { detectFixedItems } from '../fixedItemClassifier';
import { supabase } from '../../supabase/client';
import { database } from '../../db';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../supabase/client', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
  },
}));

jest.mock('../../db', () => ({
  database: {
    get: jest.fn(),
    write: jest.fn(async (fn: () => Promise<void>) => fn()),
  },
}));

// ── Typed mock handles ────────────────────────────────────────────────────────

const mockGetUser = supabase.auth.getUser as jest.Mock;
const mockFrom    = supabase.from as jest.Mock;
const mockDbGet   = database.get as jest.Mock;

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeTxn(opts: {
  amount: number;
  merchantName: string;
  categoryL1: string;
  date: string;
  pending?: boolean;
}) {
  return {
    amount: opts.amount,
    merchantName: opts.merchantName,
    categoryL1: opts.categoryL1,
    date: opts.date,
    pending: opts.pending ?? false,
  };
}

/**
 * Wires database.get('transactions').query().fetch() to return the given list.
 * The classifier does NOT pass any Q.where filters, so one mock level suffices.
 */
function setupDb(transactions: ReturnType<typeof makeTxn>[]) {
  mockDbGet.mockReturnValue({
    query: jest.fn().mockReturnValue({
      fetch: jest.fn().mockResolvedValue(transactions),
    }),
  });
}

/**
 * Configures all supabase.from() calls:
 *   .from('budget_categories').select().eq() → categories
 *   .from('fixed_items').select().eq()       → existingItems
 *   .from('fixed_items').upsert()            → captured for assertions
 */
function setupSupabase(
  categories: { id: string; name: string }[],
  existingItems: object[] = [],
) {
  const upsert = jest.fn().mockResolvedValue({ data: null, error: null });

  mockFrom.mockImplementation((table: string) => {
    if (table === 'budget_categories') {
      const eq = jest.fn().mockResolvedValue({ data: categories, error: null });
      return { select: jest.fn().mockReturnValue({ eq }) };
    }
    if (table === 'fixed_items') {
      const eq = jest.fn().mockResolvedValue({ data: existingItems, error: null });
      return { select: jest.fn().mockReturnValue({ eq }), upsert };
    }
    return { select: jest.fn(), upsert };
  });

  return { upsert };
}

// ── detectFixedItems ──────────────────────────────────────────────────────────

describe('detectFixedItems', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('upserts when the same merchant appears for 3+ consecutive months within 5% variance', async () => {
    setupDb([
      makeTxn({ amount: 15.99, merchantName: 'Netflix', categoryL1: 'Entertainment', date: '2026-01-15' }),
      makeTxn({ amount: 15.99, merchantName: 'Netflix', categoryL1: 'Entertainment', date: '2026-02-15' }),
      makeTxn({ amount: 15.99, merchantName: 'Netflix', categoryL1: 'Entertainment', date: '2026-03-15' }),
    ]);
    const { upsert } = setupSupabase([{ id: 'cat-1', name: 'Entertainment' }]);

    await detectFixedItems();

    expect(upsert).toHaveBeenCalledTimes(1);
    const [rows] = upsert.mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: 'user-1',
      category_id: 'cat-1',
      merchant_name: 'Netflix',
      detected_amount: 15.99,
      is_confirmed: false,
    });
  });

  it('upserts when the same merchant appears for exactly 2 consecutive months (MIN_MONTHS=2)', async () => {
    // The implementation sets MIN_MONTHS = 2, so 2 consecutive months is the threshold.
    setupDb([
      makeTxn({ amount: 9.99, merchantName: 'Spotify', categoryL1: 'Entertainment', date: '2026-01-10' }),
      makeTxn({ amount: 9.99, merchantName: 'Spotify', categoryL1: 'Entertainment', date: '2026-02-10' }),
    ]);
    const { upsert } = setupSupabase([{ id: 'cat-1', name: 'Entertainment' }]);

    await detectFixedItems();

    expect(upsert).toHaveBeenCalledTimes(1);
    const [rows] = upsert.mock.calls[0];
    expect(rows[0]).toMatchObject({
      merchant_name: 'Spotify',
      detected_amount: 9.99,
      is_confirmed: false,
    });
  });

  it('does NOT upsert when the merchant appears in only 1 month', async () => {
    // A single calendar month never satisfies MIN_MONTHS = 2.
    setupDb([
      makeTxn({ amount: 9.99, merchantName: 'SingleMonth', categoryL1: 'Entertainment', date: '2026-01-05' }),
      makeTxn({ amount: 9.99, merchantName: 'SingleMonth', categoryL1: 'Entertainment', date: '2026-01-19' }),
    ]);
    const { upsert } = setupSupabase([{ id: 'cat-1', name: 'Entertainment' }]);

    await detectFixedItems();

    expect(upsert).not.toHaveBeenCalled();
  });

  it('does NOT upsert when amount variance exceeds 5% between months', async () => {
    // Month 1: $10, Month 2: $11 (10% variance — above threshold)
    setupDb([
      makeTxn({ amount: 10.00, merchantName: 'VaryingCo', categoryL1: 'Utilities', date: '2026-01-05' }),
      makeTxn({ amount: 11.00, merchantName: 'VaryingCo', categoryL1: 'Utilities', date: '2026-02-05' }),
      makeTxn({ amount: 10.00, merchantName: 'VaryingCo', categoryL1: 'Utilities', date: '2026-03-05' }),
    ]);
    const { upsert } = setupSupabase([{ id: 'cat-2', name: 'Utilities' }]);

    await detectFixedItems();

    expect(upsert).not.toHaveBeenCalled();
  });

  it('upserts with correct user_id, category_id, merchant_name, and detected_amount fields', async () => {
    setupDb([
      makeTxn({ amount: 50.00, merchantName: 'GymBrand', categoryL1: 'Health', date: '2026-01-01' }),
      makeTxn({ amount: 50.00, merchantName: 'GymBrand', categoryL1: 'Health', date: '2026-02-01' }),
      makeTxn({ amount: 50.00, merchantName: 'GymBrand', categoryL1: 'Health', date: '2026-03-01' }),
    ]);
    const { upsert } = setupSupabase([{ id: 'cat-health', name: 'Health' }]);

    await detectFixedItems();

    const [rows, options] = upsert.mock.calls[0];
    expect(rows[0]).toMatchObject({
      user_id: 'user-1',
      category_id: 'cat-health',
      merchant_name: 'GymBrand',
      detected_amount: 50.00,
      is_confirmed: false,
      needs_review: false,
    });
    expect(rows[0]).toHaveProperty('last_seen_date', '2026-03-01');
    // Verify the conflict target
    expect(options).toMatchObject({
      onConflict: 'user_id,category_id,merchant_name',
      ignoreDuplicates: false,
    });
  });

  it('handles a zero-amount transaction without divide-by-zero error', async () => {
    // Zero amounts should be treated as non-qualifying (variance check against 0 baseline
    // would divide by zero); the function must not throw.
    setupDb([
      makeTxn({ amount: 0, merchantName: 'ZeroCharge', categoryL1: 'Utilities', date: '2026-01-01' }),
      makeTxn({ amount: 0, merchantName: 'ZeroCharge', categoryL1: 'Utilities', date: '2026-02-01' }),
      makeTxn({ amount: 0, merchantName: 'ZeroCharge', categoryL1: 'Utilities', date: '2026-03-01' }),
    ]);
    const { upsert } = setupSupabase([{ id: 'cat-2', name: 'Utilities' }]);

    // Should resolve without throwing
    await expect(detectFixedItems()).resolves.toBeUndefined();
    // Zero-amount items should not be upserted (NaN variance check will fail)
    expect(upsert).not.toHaveBeenCalled();
  });

  it('does not upsert when the category is unknown', async () => {
    setupDb([
      makeTxn({ amount: 20, merchantName: 'MysteryBrand', categoryL1: 'UnknownCategory', date: '2026-01-01' }),
      makeTxn({ amount: 20, merchantName: 'MysteryBrand', categoryL1: 'UnknownCategory', date: '2026-02-01' }),
      makeTxn({ amount: 20, merchantName: 'MysteryBrand', categoryL1: 'UnknownCategory', date: '2026-03-01' }),
    ]);
    const { upsert } = setupSupabase([{ id: 'cat-1', name: 'Entertainment' }]); // no match

    await detectFixedItems();

    expect(upsert).not.toHaveBeenCalled();
  });

  it('does nothing when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { upsert } = setupSupabase([{ id: 'cat-1', name: 'Entertainment' }]);

    await detectFixedItems();

    expect(upsert).not.toHaveBeenCalled();
  });

  it('does nothing when there are no budget categories', async () => {
    setupDb([
      makeTxn({ amount: 10, merchantName: 'SomeBrand', categoryL1: 'Entertainment', date: '2026-01-01' }),
    ]);
    const { upsert } = setupSupabase([]); // empty categories

    await detectFixedItems();

    expect(upsert).not.toHaveBeenCalled();
  });

  it('skips pending transactions', async () => {
    setupDb([
      makeTxn({ amount: 9.99, merchantName: 'Hulu', categoryL1: 'Entertainment', date: '2026-01-10', pending: true }),
      makeTxn({ amount: 9.99, merchantName: 'Hulu', categoryL1: 'Entertainment', date: '2026-02-10', pending: true }),
      makeTxn({ amount: 9.99, merchantName: 'Hulu', categoryL1: 'Entertainment', date: '2026-03-10', pending: true }),
    ]);
    const { upsert } = setupSupabase([{ id: 'cat-1', name: 'Entertainment' }]);

    await detectFixedItems();

    expect(upsert).not.toHaveBeenCalled();
  });

  it('excludes negative-amount (credit) transactions from debit analysis', async () => {
    setupDb([
      makeTxn({ amount: -10, merchantName: 'Refund', categoryL1: 'Utilities', date: '2026-01-01' }),
      makeTxn({ amount: -10, merchantName: 'Refund', categoryL1: 'Utilities', date: '2026-02-01' }),
      makeTxn({ amount: -10, merchantName: 'Refund', categoryL1: 'Utilities', date: '2026-03-01' }),
    ]);
    const { upsert } = setupSupabase([{ id: 'cat-2', name: 'Utilities' }]);

    await detectFixedItems();

    expect(upsert).not.toHaveBeenCalled();
  });

  it('sets needs_review=true for a confirmed item whose amount has drifted >5%', async () => {
    setupDb([
      makeTxn({ amount: 15.99, merchantName: 'Netflix', categoryL1: 'Entertainment', date: '2026-01-15' }),
      makeTxn({ amount: 15.99, merchantName: 'Netflix', categoryL1: 'Entertainment', date: '2026-02-15' }),
      // Price hike — more than 5% above confirmed amount (10)
      makeTxn({ amount: 15.99, merchantName: 'Netflix', categoryL1: 'Entertainment', date: '2026-03-15' }),
    ]);
    const confirmedItem = {
      id: 'fi-1',
      merchant_name: 'Netflix',
      category_id: 'cat-1',
      detected_amount: 10.00,
      confirmed_amount: 10.00,
      is_confirmed: true,
    };
    const { upsert } = setupSupabase(
      [{ id: 'cat-1', name: 'Entertainment' }],
      [confirmedItem],
    );

    await detectFixedItems();

    expect(upsert).toHaveBeenCalledTimes(1);
    const [rows] = upsert.mock.calls[0];
    expect(rows[0]).toMatchObject({
      id: 'fi-1',
      needs_review: true,
      detected_amount: 15.99,
    });
    // is_confirmed must NOT be set to false
    expect(rows[0].is_confirmed).toBeUndefined();
  });

  it('does NOT set needs_review for a confirmed item within 5% variance', async () => {
    // Confirmed at $15.99, new detected $16.19 (~1.25% drift — within threshold)
    setupDb([
      makeTxn({ amount: 16.19, merchantName: 'Netflix', categoryL1: 'Entertainment', date: '2026-01-15' }),
      makeTxn({ amount: 16.19, merchantName: 'Netflix', categoryL1: 'Entertainment', date: '2026-02-15' }),
      makeTxn({ amount: 16.19, merchantName: 'Netflix', categoryL1: 'Entertainment', date: '2026-03-15' }),
    ]);
    const confirmedItem = {
      id: 'fi-1',
      merchant_name: 'Netflix',
      category_id: 'cat-1',
      detected_amount: 15.99,
      confirmed_amount: 15.99,
      is_confirmed: true,
    };
    const { upsert } = setupSupabase(
      [{ id: 'cat-1', name: 'Entertainment' }],
      [confirmedItem],
    );

    await detectFixedItems();

    expect(upsert).toHaveBeenCalledTimes(1);
    const [rows] = upsert.mock.calls[0];
    // needs_review should NOT be set to true
    expect(rows[0].needs_review).not.toBe(true);
  });

  it('handles non-consecutive months by resetting the consecutive counter', async () => {
    // Jan, Feb, then Apr (gap — March skipped) — only 2 consecutive max
    setupDb([
      makeTxn({ amount: 12.00, merchantName: 'Gappy', categoryL1: 'Utilities', date: '2026-01-05' }),
      makeTxn({ amount: 12.00, merchantName: 'Gappy', categoryL1: 'Utilities', date: '2026-02-05' }),
      // March missing
      makeTxn({ amount: 12.00, merchantName: 'Gappy', categoryL1: 'Utilities', date: '2026-04-05' }),
    ]);
    const { upsert } = setupSupabase([{ id: 'cat-2', name: 'Utilities' }]);

    await detectFixedItems();

    expect(upsert).not.toHaveBeenCalled();
  });

  it('upserts multiple independent fixed items in one call', async () => {
    setupDb([
      makeTxn({ amount: 9.99,  merchantName: 'Spotify', categoryL1: 'Entertainment', date: '2026-01-10' }),
      makeTxn({ amount: 9.99,  merchantName: 'Spotify', categoryL1: 'Entertainment', date: '2026-02-10' }),
      makeTxn({ amount: 9.99,  merchantName: 'Spotify', categoryL1: 'Entertainment', date: '2026-03-10' }),
      makeTxn({ amount: 50.00, merchantName: 'GymBrand', categoryL1: 'Health',        date: '2026-01-01' }),
      makeTxn({ amount: 50.00, merchantName: 'GymBrand', categoryL1: 'Health',        date: '2026-02-01' }),
      makeTxn({ amount: 50.00, merchantName: 'GymBrand', categoryL1: 'Health',        date: '2026-03-01' }),
    ]);
    const { upsert } = setupSupabase([
      { id: 'cat-1', name: 'Entertainment' },
      { id: 'cat-2', name: 'Health' },
    ]);

    await detectFixedItems();

    expect(upsert).toHaveBeenCalledTimes(1);
    const [rows] = upsert.mock.calls[0];
    expect(rows).toHaveLength(2);
    const merchantNames = rows.map((r: { merchant_name: string }) => r.merchant_name);
    expect(merchantNames).toContain('Spotify');
    expect(merchantNames).toContain('GymBrand');
  });
});
