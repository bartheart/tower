import { supabase } from '../../supabase/client';

jest.mock('../../supabase/client', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
  },
}));

import {
  confirmIncomeSource,
  dismissIncomeSource,
  addManualIncomeSource,
  updateIncomeSource,
  deleteIncomeSource,
} from '../useIncome';

const authMock = supabase.auth.getUser as jest.Mock;
const fromMock = supabase.from as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  authMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
});

// ---------------------------------------------------------------------------
// confirmedMonthlyIncome calculation (pure logic tested inline)
// The hook uses useMemo; we replicate the logic here as a pure function.
// ---------------------------------------------------------------------------
interface IncomeSourceLike {
  amountMonthly: number;
  isConfirmed: boolean;
}

function confirmedMonthlyIncome(sources: IncomeSourceLike[]): number {
  return sources.filter(s => s.isConfirmed).reduce((sum, s) => sum + s.amountMonthly, 0);
}

describe('confirmedMonthlyIncome (pure calculation)', () => {
  it('sums only confirmed sources', () => {
    const sources: IncomeSourceLike[] = [
      { amountMonthly: 3000, isConfirmed: true },
      { amountMonthly: 1500, isConfirmed: true },
      { amountMonthly: 800,  isConfirmed: false }, // excluded
    ];
    expect(confirmedMonthlyIncome(sources)).toBe(4500);
  });

  it('excludes unconfirmed sources from total', () => {
    const sources: IncomeSourceLike[] = [
      { amountMonthly: 2000, isConfirmed: false },
      { amountMonthly: 500,  isConfirmed: false },
    ];
    expect(confirmedMonthlyIncome(sources)).toBe(0);
  });

  it('returns 0 when there are no confirmed sources', () => {
    expect(confirmedMonthlyIncome([])).toBe(0);
  });

  it('handles a single confirmed source', () => {
    const sources: IncomeSourceLike[] = [{ amountMonthly: 4200, isConfirmed: true }];
    expect(confirmedMonthlyIncome(sources)).toBe(4200);
  });

  it('accumulates fractional amounts correctly', () => {
    const sources: IncomeSourceLike[] = [
      { amountMonthly: 1234.56, isConfirmed: true },
      { amountMonthly: 765.44, isConfirmed: true },
    ];
    expect(confirmedMonthlyIncome(sources)).toBeCloseTo(2000, 2);
  });
});

// ---------------------------------------------------------------------------
// confirmIncomeSource
// ---------------------------------------------------------------------------
describe('confirmIncomeSource', () => {
  it('calls supabase update with is_confirmed: true on income_sources table', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ update: updateMock });

    await confirmIncomeSource('src-1');

    expect(fromMock).toHaveBeenCalledWith('income_sources');
    expect(updateMock).toHaveBeenCalledWith({ is_confirmed: true });
    expect(eqMock).toHaveBeenCalledWith('id', 'src-1');
  });

  it('throws when supabase returns an error', async () => {
    const dbError = new Error('confirm failed');
    const eqMock = jest.fn().mockResolvedValue({ error: dbError });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ update: updateMock });

    await expect(confirmIncomeSource('src-1')).rejects.toThrow('confirm failed');
  });

  it('uses the correct id when multiple sources exist', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ update: updateMock });

    await confirmIncomeSource('src-abc-123');

    expect(eqMock).toHaveBeenCalledWith('id', 'src-abc-123');
  });
});

// ---------------------------------------------------------------------------
// dismissIncomeSource
// ---------------------------------------------------------------------------
describe('dismissIncomeSource', () => {
  it('calls supabase delete on income_sources table with correct id', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const deleteMock = jest.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ delete: deleteMock });

    await dismissIncomeSource('src-2');

    expect(fromMock).toHaveBeenCalledWith('income_sources');
    expect(deleteMock).toHaveBeenCalled();
    expect(eqMock).toHaveBeenCalledWith('id', 'src-2');
  });

  it('throws when supabase returns an error', async () => {
    const dbError = new Error('dismiss failed');
    const eqMock = jest.fn().mockResolvedValue({ error: dbError });
    const deleteMock = jest.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ delete: deleteMock });

    await expect(dismissIncomeSource('src-2')).rejects.toThrow('dismiss failed');
  });
});

// ---------------------------------------------------------------------------
// addManualIncomeSource
// ---------------------------------------------------------------------------
describe('addManualIncomeSource', () => {
  it('inserts a manual confirmed income source with correct fields', async () => {
    const insertMock = jest.fn().mockResolvedValue({ error: null });
    fromMock.mockReturnValue({ insert: insertMock });

    await addManualIncomeSource('Freelance', 2500);

    expect(fromMock).toHaveBeenCalledWith('income_sources');
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        name: 'Freelance',
        amount_monthly: 2500,
        frequency: 'manual',
        is_confirmed: true,
      }),
    );
  });

  it('throws when not authenticated', async () => {
    authMock.mockResolvedValue({ data: { user: null } });

    await expect(addManualIncomeSource('Side Hustle', 500)).rejects.toThrow('Not authenticated');
  });

  it('throws when supabase returns an error', async () => {
    const dbError = new Error('insert failed');
    const insertMock = jest.fn().mockResolvedValue({ error: dbError });
    fromMock.mockReturnValue({ insert: insertMock });

    await expect(addManualIncomeSource('Job', 3000)).rejects.toThrow('insert failed');
  });
});

// ---------------------------------------------------------------------------
// updateIncomeSource
// ---------------------------------------------------------------------------
describe('updateIncomeSource', () => {
  it('sends only provided fields — name only', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ update: updateMock });

    await updateIncomeSource('src-3', { name: 'New Name' });

    expect(updateMock).toHaveBeenCalledWith({ name: 'New Name' });
    expect(updateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ amount_monthly: expect.anything() }),
    );
    expect(eqMock).toHaveBeenCalledWith('id', 'src-3');
  });

  it('sends only provided fields — amountMonthly only', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ update: updateMock });

    await updateIncomeSource('src-4', { amountMonthly: 4500 });

    expect(updateMock).toHaveBeenCalledWith({ amount_monthly: 4500 });
    expect(eqMock).toHaveBeenCalledWith('id', 'src-4');
  });

  it('sends both fields when both are provided', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ update: updateMock });

    await updateIncomeSource('src-5', { name: 'Salary', amountMonthly: 6000 });

    expect(updateMock).toHaveBeenCalledWith({ name: 'Salary', amount_monthly: 6000 });
  });

  it('throws when supabase returns an error', async () => {
    const dbError = new Error('update failed');
    const eqMock = jest.fn().mockResolvedValue({ error: dbError });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ update: updateMock });

    await expect(updateIncomeSource('src-5', { name: 'X' })).rejects.toThrow('update failed');
  });
});

// ---------------------------------------------------------------------------
// deleteIncomeSource
// ---------------------------------------------------------------------------
describe('deleteIncomeSource', () => {
  it('calls supabase delete on income_sources with correct id', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const deleteMock = jest.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ delete: deleteMock });

    await deleteIncomeSource('src-6');

    expect(fromMock).toHaveBeenCalledWith('income_sources');
    expect(deleteMock).toHaveBeenCalled();
    expect(eqMock).toHaveBeenCalledWith('id', 'src-6');
  });

  it('throws when supabase returns an error', async () => {
    const dbError = new Error('delete failed');
    const eqMock = jest.fn().mockResolvedValue({ error: dbError });
    const deleteMock = jest.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ delete: deleteMock });

    await expect(deleteIncomeSource('src-6')).rejects.toThrow('delete failed');
  });
});
