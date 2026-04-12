import { supabase } from '../../supabase/client';

jest.mock('../../supabase/client', () => ({
  supabase: {
    from: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockResolvedValue({ error: null }),
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
  },
}));

import { updateBudget } from '../useBudgets';

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
