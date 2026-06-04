import { detectIncomeSources } from '../incomeDetector';
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
  accountId: string;
  date: string;
  pending?: boolean;
}) {
  return {
    amount: opts.amount,
    merchantName: opts.merchantName,
    accountId: opts.accountId,
    date: opts.date,
    pending: opts.pending ?? false,
  };
}

function makeAccount(opts: { plaidAccountId: string; type: string }) {
  return { plaidAccountId: opts.plaidAccountId, type: opts.type };
}

/**
 * Configures database.get so that:
 *   database.get('accounts').query().fetch() → accounts
 *   database.get('transactions').query(...).fetch() → transactions
 */
function setupDb(
  accounts: ReturnType<typeof makeAccount>[],
  transactions: ReturnType<typeof makeTxn>[],
) {
  mockDbGet.mockImplementation((table: string) => {
    const rows = table === 'accounts' ? accounts : transactions;
    return {
      query: jest.fn().mockReturnValue({
        fetch: jest.fn().mockResolvedValue(rows),
      }),
    };
  });
}

/**
 * Configures supabase.from so that:
 *   .from('income_sources').select().eq()  → existing rows
 *   .from('income_sources').upsert()       → resolved OK
 */
function setupSupabase(existingRows: object[] = []) {
  const upsert = jest.fn().mockResolvedValue({ data: null, error: null });
  const eq     = jest.fn().mockResolvedValue({ data: existingRows, error: null });
  const select = jest.fn().mockReturnValue({ eq });

  mockFrom.mockReturnValue({ select, eq, upsert });
  return { upsert, select, eq };
}

// ── detectFrequency (tested indirectly via detectIncomeSources) ───────────────
//
// incomeDetector.ts does NOT export detectFrequency, so we exercise it through
// the public API.  The "pure" frequency cases are covered by controlling the
// transaction dates passed into detectIncomeSources.

describe('detectFrequency (via detectIncomeSources)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('treats 12-18 day gaps as biweekly', async () => {
    const account = makeAccount({ plaidAccountId: 'acc-1', type: 'depository' });
    const txns = [
      makeTxn({ amount: -1500, merchantName: 'Acme Corp', accountId: 'acc-1', date: '2026-01-02' }),
      makeTxn({ amount: -1500, merchantName: 'Acme Corp', accountId: 'acc-1', date: '2026-01-16' }), // 14 days
      makeTxn({ amount: -1500, merchantName: 'Acme Corp', accountId: 'acc-1', date: '2026-01-30' }), // 14 days
    ];
    setupDb([account], txns);
    const { upsert } = setupSupabase();

    await detectIncomeSources();

    expect(upsert).toHaveBeenCalledTimes(1);
    const payload = upsert.mock.calls[0][0];
    expect(payload[0]).toMatchObject({ frequency: 'biweekly' });
  });

  it('treats 25-35 day gaps as monthly', async () => {
    const account = makeAccount({ plaidAccountId: 'acc-1', type: 'depository' });
    const txns = [
      makeTxn({ amount: -3000, merchantName: 'BigCo', accountId: 'acc-1', date: '2026-01-01' }),
      makeTxn({ amount: -3000, merchantName: 'BigCo', accountId: 'acc-1', date: '2026-02-01' }), // 31 days
      makeTxn({ amount: -3000, merchantName: 'BigCo', accountId: 'acc-1', date: '2026-03-01' }), // 28 days
    ];
    setupDb([account], txns);
    const { upsert } = setupSupabase();

    await detectIncomeSources();

    expect(upsert).toHaveBeenCalledTimes(1);
    const payload = upsert.mock.calls[0][0];
    expect(payload[0]).toMatchObject({ frequency: 'monthly' });
  });

  it('returns null (no upsert) for irregular gaps', async () => {
    const account = makeAccount({ plaidAccountId: 'acc-1', type: 'depository' });
    // Gaps: 10 days, then 25 days — not consistently biweekly or monthly
    const txns = [
      makeTxn({ amount: -1000, merchantName: 'Irregular', accountId: 'acc-1', date: '2026-01-01' }),
      makeTxn({ amount: -1000, merchantName: 'Irregular', accountId: 'acc-1', date: '2026-01-11' }), // 10 days
      makeTxn({ amount: -1000, merchantName: 'Irregular', accountId: 'acc-1', date: '2026-02-05' }), // 25 days
    ];
    setupDb([account], txns);
    const { upsert } = setupSupabase();

    await detectIncomeSources();

    expect(upsert).not.toHaveBeenCalled();
  });

  it('returns null when fewer than MIN_OCCURRENCES (3) dates exist', async () => {
    const account = makeAccount({ plaidAccountId: 'acc-1', type: 'depository' });
    const txns = [
      makeTxn({ amount: -1500, merchantName: 'OnlyTwo', accountId: 'acc-1', date: '2026-01-01' }),
      makeTxn({ amount: -1500, merchantName: 'OnlyTwo', accountId: 'acc-1', date: '2026-02-01' }),
    ];
    setupDb([account], txns);
    const { upsert } = setupSupabase();

    await detectIncomeSources();

    expect(upsert).not.toHaveBeenCalled();
  });
});

// ── detectIncomeSources ───────────────────────────────────────────────────────

describe('detectIncomeSources', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('upserts a recurring monthly deposit as an income source', async () => {
    const account = makeAccount({ plaidAccountId: 'acc-1', type: 'depository' });
    const txns = [
      makeTxn({ amount: -2000, merchantName: 'Initech', accountId: 'acc-1', date: '2026-01-15' }),
      makeTxn({ amount: -2000, merchantName: 'Initech', accountId: 'acc-1', date: '2026-02-15' }),
      makeTxn({ amount: -2000, merchantName: 'Initech', accountId: 'acc-1', date: '2026-03-15' }),
    ];
    setupDb([account], txns);
    const { upsert } = setupSupabase();

    await detectIncomeSources();

    expect(upsert).toHaveBeenCalledTimes(1);
    const [rows] = upsert.mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: 'user-1',
      name: 'Initech',
      frequency: 'monthly',
      is_confirmed: false,
    });
  });

  it('does NOT upsert non-recurring deposits', async () => {
    const account = makeAccount({ plaidAccountId: 'acc-1', type: 'depository' });
    // Only one occurrence — not recurring
    const txns = [
      makeTxn({ amount: -500, merchantName: 'OneTime', accountId: 'acc-1', date: '2026-01-10' }),
    ];
    setupDb([account], txns);
    const { upsert } = setupSupabase();

    await detectIncomeSources();

    expect(upsert).not.toHaveBeenCalled();
  });

  it('excludes positive-amount (debit) transactions', async () => {
    const account = makeAccount({ plaidAccountId: 'acc-1', type: 'depository' });
    // Positive amounts are debits in Plaid convention — should be ignored
    const txns = [
      makeTxn({ amount: 100, merchantName: 'Starbucks', accountId: 'acc-1', date: '2026-01-05' }),
      makeTxn({ amount: 100, merchantName: 'Starbucks', accountId: 'acc-1', date: '2026-02-05' }),
      makeTxn({ amount: 100, merchantName: 'Starbucks', accountId: 'acc-1', date: '2026-03-05' }),
    ];
    setupDb([account], txns);
    const { upsert } = setupSupabase();

    await detectIncomeSources();

    expect(upsert).not.toHaveBeenCalled();
  });

  it('ignores merchants with fewer than 3 occurrences', async () => {
    const account = makeAccount({ plaidAccountId: 'acc-1', type: 'depository' });
    const txns = [
      makeTxn({ amount: -1000, merchantName: 'Sporadic', accountId: 'acc-1', date: '2026-01-01' }),
      makeTxn({ amount: -1000, merchantName: 'Sporadic', accountId: 'acc-1', date: '2026-02-01' }),
    ];
    setupDb([account], txns);
    const { upsert } = setupSupabase();

    await detectIncomeSources();

    expect(upsert).not.toHaveBeenCalled();
  });

  it('upserts with correct user_id, name, frequency, and amount_monthly', async () => {
    const account = makeAccount({ plaidAccountId: 'acc-1', type: 'depository' });
    const txns = [
      makeTxn({ amount: -2000, merchantName: 'MonthlyCo', accountId: 'acc-1', date: '2026-01-01' }),
      makeTxn({ amount: -2000, merchantName: 'MonthlyCo', accountId: 'acc-1', date: '2026-02-01' }),
      makeTxn({ amount: -2000, merchantName: 'MonthlyCo', accountId: 'acc-1', date: '2026-03-01' }),
    ];
    setupDb([account], txns);
    const { upsert } = setupSupabase();

    await detectIncomeSources();

    const [rows] = upsert.mock.calls[0];
    expect(rows[0]).toMatchObject({
      user_id: 'user-1',
      name: 'MonthlyCo',
      frequency: 'monthly',
      amount_monthly: 2000,
      source_account_id: 'acc-1',
      is_confirmed: false,
    });
  });

  it('annualises biweekly pay correctly (avgAmount * 26/12)', async () => {
    const account = makeAccount({ plaidAccountId: 'acc-1', type: 'depository' });
    // Biweekly paycheck: $1000 every ~14 days
    const txns = [
      makeTxn({ amount: -1000, merchantName: 'BiweeklyPayroll', accountId: 'acc-1', date: '2026-01-02' }),
      makeTxn({ amount: -1000, merchantName: 'BiweeklyPayroll', accountId: 'acc-1', date: '2026-01-16' }),
      makeTxn({ amount: -1000, merchantName: 'BiweeklyPayroll', accountId: 'acc-1', date: '2026-01-30' }),
    ];
    setupDb([account], txns);
    const { upsert } = setupSupabase();

    await detectIncomeSources();

    const [rows] = upsert.mock.calls[0];
    // 1000 * (26/12) = 2166.67, rounded to 2 decimals
    expect(rows[0].amount_monthly).toBeCloseTo(2166.67, 1);
    expect(rows[0].frequency).toBe('biweekly');
  });

  it('does not upsert confirmed income sources (skips them)', async () => {
    const account = makeAccount({ plaidAccountId: 'acc-1', type: 'depository' });
    const txns = [
      makeTxn({ amount: -2000, merchantName: 'ConfirmedCo', accountId: 'acc-1', date: '2026-01-01' }),
      makeTxn({ amount: -2000, merchantName: 'ConfirmedCo', accountId: 'acc-1', date: '2026-02-01' }),
      makeTxn({ amount: -2000, merchantName: 'ConfirmedCo', accountId: 'acc-1', date: '2026-03-01' }),
    ];
    setupDb([account], txns);
    // Return an existing confirmed row for this merchant
    const { upsert } = setupSupabase([
      {
        id: 'src-1',
        name: 'ConfirmedCo',
        source_account_id: 'acc-1',
        is_confirmed: true,
      },
    ]);

    await detectIncomeSources();

    expect(upsert).not.toHaveBeenCalled();
  });

  it('does nothing when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { upsert } = setupSupabase();

    await detectIncomeSources();

    expect(upsert).not.toHaveBeenCalled();
  });

  it('does nothing when there are no depository accounts', async () => {
    // Only credit accounts — no depository
    const account = makeAccount({ plaidAccountId: 'acc-1', type: 'credit' });
    const txns = [
      makeTxn({ amount: -2000, merchantName: 'AnyCo', accountId: 'acc-1', date: '2026-01-01' }),
      makeTxn({ amount: -2000, merchantName: 'AnyCo', accountId: 'acc-1', date: '2026-02-01' }),
      makeTxn({ amount: -2000, merchantName: 'AnyCo', accountId: 'acc-1', date: '2026-03-01' }),
    ];
    setupDb([account], txns);
    const { upsert } = setupSupabase();

    await detectIncomeSources();

    expect(upsert).not.toHaveBeenCalled();
  });

  it('upsert is called with correct onConflict option', async () => {
    const account = makeAccount({ plaidAccountId: 'acc-1', type: 'depository' });
    const txns = [
      makeTxn({ amount: -1500, merchantName: 'ConflictCo', accountId: 'acc-1', date: '2026-01-01' }),
      makeTxn({ amount: -1500, merchantName: 'ConflictCo', accountId: 'acc-1', date: '2026-02-01' }),
      makeTxn({ amount: -1500, merchantName: 'ConflictCo', accountId: 'acc-1', date: '2026-03-01' }),
    ];
    setupDb([account], txns);
    const { upsert } = setupSupabase();

    await detectIncomeSources();

    expect(upsert).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        onConflict: 'user_id,name,source_account_id',
        ignoreDuplicates: false,
      }),
    );
  });

  it('groups by normalized merchant so punctuation differences collapse', async () => {
    const account = makeAccount({ plaidAccountId: 'acc-1', type: 'depository' });
    // "Acme, Inc." and "Acme Inc" should normalize to the same key
    const txns = [
      makeTxn({ amount: -1200, merchantName: 'Acme, Inc.', accountId: 'acc-1', date: '2026-01-01' }),
      makeTxn({ amount: -1200, merchantName: 'Acme Inc',   accountId: 'acc-1', date: '2026-02-01' }),
      makeTxn({ amount: -1200, merchantName: 'Acme Inc',   accountId: 'acc-1', date: '2026-03-01' }),
    ];
    setupDb([account], txns);
    const { upsert } = setupSupabase();

    await detectIncomeSources();

    // They should collapse into a single group and produce one upsert row
    expect(upsert).toHaveBeenCalledTimes(1);
    const [rows] = upsert.mock.calls[0];
    expect(rows).toHaveLength(1);
  });
});
