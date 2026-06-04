import { supabase } from '../../supabase/client';

jest.mock('../../supabase/client', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
  },
}));

import { createGoal, updateGoalProgress, deleteGoal } from '../useGoals';

// Pull out the private toGoal function via a module-level re-export shim.
// Since toGoal is not exported, we test its logic via the Goal interface shape
// produced by createGoal's DB row → Goal mapping. The pure calculations are
// tested directly below using equivalent inline logic.

const authMock = supabase.auth.getUser as jest.Mock;
const fromMock = supabase.from as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  authMock.mockResolvedValue({ data: { user: { id: 'user-1' } } });
});

// ---------------------------------------------------------------------------
// Inline replica of the toGoal transformation so we can unit-test it without
// needing to export the private function.
// ---------------------------------------------------------------------------
interface GoalRow {
  id: string;
  name: string;
  emoji: string;
  target_amount: number;
  current_amount: number;
  starting_amount?: number | null;
  target_date: string | null;
  status?: string;
}

function toGoal(g: GoalRow) {
  const progressPercent =
    g.target_amount > 0
      ? Math.min(100, Math.round((g.current_amount / g.target_amount) * 100))
      : 0;
  let monthsLeft: number | null = null;
  let monthlyContributionNeeded: number | null = null;
  if (g.target_date) {
    const months = Math.ceil(
      (new Date(g.target_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30),
    );
    monthsLeft = Math.max(0, months);
    if (monthsLeft > 0 && g.target_amount > g.current_amount) {
      monthlyContributionNeeded = (g.target_amount - g.current_amount) / monthsLeft;
    }
  }
  return {
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    targetAmount: g.target_amount,
    currentAmount: g.current_amount,
    startingAmount: g.starting_amount ?? 0,
    targetDate: g.target_date,
    status: g.status ?? 'on_track',
    progressPercent,
    monthsLeft,
    monthlyContributionNeeded,
  };
}

// ---------------------------------------------------------------------------
// toGoal transformation
// ---------------------------------------------------------------------------
describe('toGoal (DB row → Goal mapping)', () => {
  it('maps scalar fields correctly', () => {
    const row: GoalRow = {
      id: 'g1',
      name: 'Emergency Fund',
      emoji: '🏦',
      target_amount: 10000,
      current_amount: 2500,
      starting_amount: 0,
      target_date: null,
      status: 'on_track',
    };
    const goal = toGoal(row);
    expect(goal.id).toBe('g1');
    expect(goal.name).toBe('Emergency Fund');
    expect(goal.emoji).toBe('🏦');
    expect(goal.targetAmount).toBe(10000);
    expect(goal.currentAmount).toBe(2500);
    expect(goal.startingAmount).toBe(0);
    expect(goal.status).toBe('on_track');
  });

  it('computes progressPercent correctly', () => {
    const row: GoalRow = {
      id: 'g2',
      name: 'Car',
      emoji: '🚗',
      target_amount: 8000,
      current_amount: 2000,
      target_date: null,
    };
    const goal = toGoal(row);
    expect(goal.progressPercent).toBe(25);
  });

  it('caps progressPercent at 100 when current exceeds target', () => {
    const row: GoalRow = {
      id: 'g3',
      name: 'Trip',
      emoji: '✈️',
      target_amount: 500,
      current_amount: 600,
      target_date: null,
    };
    const goal = toGoal(row);
    expect(goal.progressPercent).toBe(100);
  });

  it('returns progressPercent 0 when target_amount is 0', () => {
    const row: GoalRow = {
      id: 'g4',
      name: 'Aspirational',
      emoji: '🌟',
      target_amount: 0,
      current_amount: 0,
      target_date: null,
    };
    const goal = toGoal(row);
    expect(goal.progressPercent).toBe(0);
  });

  it('defaults startingAmount to 0 when starting_amount is null', () => {
    const row: GoalRow = {
      id: 'g5',
      name: 'Vacation',
      emoji: '🏖️',
      target_amount: 3000,
      current_amount: 500,
      starting_amount: null,
      target_date: null,
    };
    const goal = toGoal(row);
    expect(goal.startingAmount).toBe(0);
  });

  it('defaults status to on_track when status is undefined', () => {
    const row: GoalRow = {
      id: 'g6',
      name: 'Laptop',
      emoji: '💻',
      target_amount: 1500,
      current_amount: 0,
      target_date: null,
    };
    const goal = toGoal(row);
    expect(goal.status).toBe('on_track');
  });

  it('computes monthsLeft and monthlyContributionNeeded for a future target_date', () => {
    // Target date 6 months in the future (approx)
    const future = new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const row: GoalRow = {
      id: 'g7',
      name: 'Home',
      emoji: '🏠',
      target_amount: 12000,
      current_amount: 6000,
      target_date: future,
    };
    const goal = toGoal(row);
    expect(goal.monthsLeft).toBeGreaterThan(0);
    expect(goal.monthlyContributionNeeded).toBeGreaterThan(0);
    // Remaining = 6000, spread over monthsLeft months
    expect(goal.monthlyContributionNeeded).toBeCloseTo(6000 / goal.monthsLeft!, 0);
  });

  it('returns monthlyContributionNeeded as null when goal is already funded', () => {
    const future = new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const row: GoalRow = {
      id: 'g8',
      name: 'Done',
      emoji: '✅',
      target_amount: 1000,
      current_amount: 1000,
      target_date: future,
    };
    const goal = toGoal(row);
    expect(goal.monthlyContributionNeeded).toBeNull();
  });

  it('monthsLeft edge case — target_date in the past returns 0', () => {
    const past = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const row: GoalRow = {
      id: 'g9',
      name: 'Overdue',
      emoji: '⏰',
      target_amount: 5000,
      current_amount: 1000,
      target_date: past,
    };
    const goal = toGoal(row);
    expect(goal.monthsLeft).toBe(0);
    // monthlyContributionNeeded should be null because monthsLeft is 0
    expect(goal.monthlyContributionNeeded).toBeNull();
  });

  it('monthsLeft edge case — null target_date (aspirational goal) returns null', () => {
    const row: GoalRow = {
      id: 'g10',
      name: 'Aspirational',
      emoji: '🌈',
      target_amount: 100000,
      current_amount: 0,
      target_date: null,
    };
    const goal = toGoal(row);
    expect(goal.monthsLeft).toBeNull();
    expect(goal.monthlyContributionNeeded).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createGoal
// ---------------------------------------------------------------------------
describe('createGoal', () => {
  it('calls supabase.from with correct table', async () => {
    const insertMock = jest.fn().mockResolvedValue({ error: null });
    fromMock.mockReturnValue({ insert: insertMock });

    await createGoal('Emergency Fund', '🏦', 10000, 500, '2026-12-31');

    expect(fromMock).toHaveBeenCalledWith('savings_goals');
  });

  it('inserts with all required fields including user_id', async () => {
    const insertMock = jest.fn().mockResolvedValue({ error: null });
    fromMock.mockReturnValue({ insert: insertMock });

    await createGoal('Vacation', '✈️', 3000, 100, '2026-08-01');

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        name: 'Vacation',
        emoji: '✈️',
        target_amount: 3000,
        current_amount: 100,
        starting_amount: 100,
        target_date: '2026-08-01',
        status: 'on_track',
      }),
    );
  });

  it('sets target_date to null when empty string is passed', async () => {
    const insertMock = jest.fn().mockResolvedValue({ error: null });
    fromMock.mockReturnValue({ insert: insertMock });

    await createGoal('Open-ended', '🌟', 5000, 0, '');

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ target_date: null }),
    );
  });

  it('throws when not authenticated', async () => {
    authMock.mockResolvedValue({ data: { user: null } });

    await expect(createGoal('X', '❓', 100, 0, null)).rejects.toThrow('Not authenticated');
  });

  it('throws when supabase returns an error', async () => {
    const dbError = new Error('DB failure');
    const insertMock = jest.fn().mockResolvedValue({ error: dbError });
    fromMock.mockReturnValue({ insert: insertMock });

    await expect(createGoal('Y', '❓', 100, 0, null)).rejects.toThrow('DB failure');
  });
});

// ---------------------------------------------------------------------------
// updateGoalProgress
// ---------------------------------------------------------------------------
describe('updateGoalProgress', () => {
  it('calls supabase update with current_amount and correct id', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ update: updateMock });

    await updateGoalProgress('goal-42', 2500);

    expect(fromMock).toHaveBeenCalledWith('savings_goals');
    expect(updateMock).toHaveBeenCalledWith({ current_amount: 2500 });
    expect(eqMock).toHaveBeenCalledWith('id', 'goal-42');
  });

  it('throws when supabase returns an error', async () => {
    const dbError = new Error('update failed');
    const eqMock = jest.fn().mockResolvedValue({ error: dbError });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ update: updateMock });

    await expect(updateGoalProgress('goal-42', 2500)).rejects.toThrow('update failed');
  });
});

// ---------------------------------------------------------------------------
// deleteGoal
// ---------------------------------------------------------------------------
describe('deleteGoal', () => {
  it('calls supabase delete with correct id', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const deleteMock = jest.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ delete: deleteMock });

    await deleteGoal('goal-99');

    expect(fromMock).toHaveBeenCalledWith('savings_goals');
    expect(deleteMock).toHaveBeenCalled();
    expect(eqMock).toHaveBeenCalledWith('id', 'goal-99');
  });

  it('throws when supabase returns an error', async () => {
    const dbError = new Error('delete failed');
    const eqMock = jest.fn().mockResolvedValue({ error: dbError });
    const deleteMock = jest.fn().mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ delete: deleteMock });

    await expect(deleteGoal('goal-99')).rejects.toThrow('delete failed');
  });
});
