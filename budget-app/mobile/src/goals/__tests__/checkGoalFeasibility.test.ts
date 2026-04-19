import { checkGoalFeasibility } from '../checkGoalFeasibility';

// Mock Supabase
const mockGoals = [
  {
    id: 'g1', name: 'Emergency Fund', target_amount: 6000, current_amount: 1000,
    starting_amount: 1000, target_date: '2026-10-01', status: 'on_track',
  },
];
const mockIncome = [{ amount_monthly: 5000, is_confirmed: true }];
const mockBuckets = [
  { id: 'b1', name: 'Dining', target_pct: 12, monthly_floor: 0, monthly_limit: 600, priority_rank: null, is_goal: false },
];

const mockSupabaseFrom = jest.fn();
jest.mock('../../supabase/client', () => ({
  supabase: {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    from: (...args: any[]) => mockSupabaseFrom(...args),
  },
}));

// Mock WatermelonDB
jest.mock('../../db', () => ({ database: { get: jest.fn() } }));
import { database } from '../../db';

// Mock engines + notifications
jest.mock('../feasibilityEngine', () => ({
  runFeasibilityCheck: jest.fn().mockReturnValue([
    { goalId: 'g1', previousStatus: 'on_track', newStatus: 'at_risk', statusChanged: true,
      projectedSurplus: 100, shortfall: 400, monthlyContributionNeeded: 500, monthsLeft: 6 },
  ]),
}));
jest.mock('../goalNotifications', () => ({
  fireGoalAtRiskNotification: jest.fn(),
  clearGoalAtRiskKey: jest.fn(),
}));
jest.mock('../goalEvents', () => ({ writeGoalEvent: jest.fn() }));

import { fireGoalAtRiskNotification } from '../goalNotifications';
import { writeGoalEvent } from '../goalEvents';

beforeEach(() => {
  jest.clearAllMocks();
  mockSupabaseFrom.mockImplementation((table: string) => {
    if (table === 'savings_goals') return {
      select: () => ({ eq: () => ({ data: mockGoals, error: null }) }),
      update: () => ({ eq: () => ({ error: null }) }),
    };
    if (table === 'income_sources') return { select: () => ({ eq: () => ({ data: mockIncome, error: null }) }) };
    if (table === 'budget_categories') return { select: () => ({ eq: () => ({ data: mockBuckets, error: null }) }) };
    return { update: () => ({ eq: () => ({ error: null }) }) };
  });
  (database.get as jest.Mock).mockReturnValue({
    query: jest.fn().mockReturnValue({ fetch: jest.fn().mockResolvedValue([
      { amount: 500, pending: false, categoryL1: 'Dining', categoryL2: '' },
    ]) }),
  });
});

test('fires at-risk notification when goal flips at_risk', async () => {
  await checkGoalFeasibility('u1');
  expect(fireGoalAtRiskNotification).toHaveBeenCalledWith('Emergency Fund', 'g1');
});

test('writes goal_event when status changes', async () => {
  await checkGoalFeasibility('u1');
  expect(writeGoalEvent).toHaveBeenCalledWith(expect.objectContaining({
    goalId: 'g1', eventType: 'at_risk', trigger: 'sync',
  }));
});

test('does not fire notification when goal was already at_risk', async () => {
  const { runFeasibilityCheck } = require('../feasibilityEngine');
  runFeasibilityCheck.mockReturnValueOnce([
    { goalId: 'g1', previousStatus: 'at_risk', newStatus: 'at_risk', statusChanged: false,
      projectedSurplus: 100, shortfall: 400, monthlyContributionNeeded: 500, monthsLeft: 6 },
  ]);
  await checkGoalFeasibility('u1');
  expect(fireGoalAtRiskNotification).not.toHaveBeenCalled();
});
