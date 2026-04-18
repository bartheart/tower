import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { checkBudgetAlerts } from '../budgetAlerts';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn().mockResolvedValue('notif-id'),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

jest.mock('../../supabase/client', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
  },
}));

jest.mock('../../db', () => ({
  database: {
    get: jest.fn(),
  },
}));

import { supabase } from '../../supabase/client';
import { database } from '../../db';

const mockSchedule = Notifications.scheduleNotificationAsync as jest.Mock;
const mockGetItem = SecureStore.getItemAsync as jest.Mock;
const mockSetItem = SecureStore.setItemAsync as jest.Mock;
const mockGetUser = supabase.auth.getUser as jest.Mock;
const mockFrom = supabase.from as jest.Mock;
const mockDbGet = database.get as jest.Mock;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTransaction(opts: {
  amount: number;
  categoryL1: string;
  categoryL2?: string;
  pending?: boolean;
  date?: string;
}) {
  return {
    amount: opts.amount,
    categoryL1: opts.categoryL1,
    categoryL2: opts.categoryL2 ?? null,
    pending: opts.pending ?? false,
    date: opts.date ?? '2026-04-10', // current month by default
  };
}

function setupSupabase(categories: { id: string; name: string; monthly_limit: number }[]) {
  const select = jest.fn().mockReturnThis();
  const eq = jest.fn().mockResolvedValue({ data: categories, error: null });
  mockFrom.mockReturnValue({ select, eq });
}

function setupDb(transactions: ReturnType<typeof makeTransaction>[]) {
  const fetch = jest.fn().mockResolvedValue(transactions);
  const queryChain = { fetch };
  const query = jest.fn().mockReturnValue(queryChain);
  mockDbGet.mockReturnValue({ query });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  mockGetItem.mockResolvedValue(null); // no prior alerts
  mockSetItem.mockResolvedValue(undefined);
});

test('fires a notification when spending is at 80% of monthly limit', async () => {
  setupSupabase([{ id: 'cat-1', name: 'Food and Drink', monthly_limit: 500 }]);
  setupDb([makeTransaction({ amount: 400, categoryL1: 'Food and Drink' })]);

  await checkBudgetAlerts('user-1');

  expect(mockSchedule).toHaveBeenCalledTimes(1);
  expect(mockSchedule).toHaveBeenCalledWith(expect.objectContaining({
    content: expect.objectContaining({
      title: 'Budget Alert',
      body: expect.stringContaining('Food and Drink'),
      data: expect.objectContaining({ type: 'budget_alert', categoryId: 'cat-1' }),
    }),
    trigger: null,
  }));
});

test('does not fire a notification when spending is below 80%', async () => {
  setupSupabase([{ id: 'cat-1', name: 'Food and Drink', monthly_limit: 500 }]);
  setupDb([makeTransaction({ amount: 350, categoryL1: 'Food and Drink' })]);

  await checkBudgetAlerts('user-1');

  expect(mockSchedule).not.toHaveBeenCalled();
});

test('does not re-notify if already alerted this month', async () => {
  setupSupabase([{ id: 'cat-1', name: 'Food and Drink', monthly_limit: 500 }]);
  setupDb([makeTransaction({ amount: 450, categoryL1: 'Food and Drink' })]);
  mockGetItem.mockResolvedValue('sent');

  await checkBudgetAlerts('user-1');

  expect(mockSchedule).not.toHaveBeenCalled();
});

test('records notification in SecureStore after firing', async () => {
  setupSupabase([{ id: 'cat-1', name: 'Food and Drink', monthly_limit: 500 }]);
  setupDb([makeTransaction({ amount: 400, categoryL1: 'Food and Drink' })]);

  await checkBudgetAlerts('user-1');

  expect(mockSetItem).toHaveBeenCalledWith(
    expect.stringContaining('cat-1'),
    'sent',
  );
});

test('skips pending transactions when calculating spend', async () => {
  setupSupabase([{ id: 'cat-1', name: 'Food and Drink', monthly_limit: 500 }]);
  setupDb([
    makeTransaction({ amount: 400, categoryL1: 'Food and Drink', pending: true }),
    makeTransaction({ amount: 100, categoryL1: 'Food and Drink' }),
  ]);

  await checkBudgetAlerts('user-1');

  expect(mockSchedule).not.toHaveBeenCalled();
});

test('fires separate notifications for each over-threshold category', async () => {
  setupSupabase([
    { id: 'cat-1', name: 'Food and Drink', monthly_limit: 500 },
    { id: 'cat-2', name: 'Entertainment', monthly_limit: 200 },
  ]);
  setupDb([
    makeTransaction({ amount: 400, categoryL1: 'Food and Drink' }),
    makeTransaction({ amount: 180, categoryL1: 'Entertainment' }),
  ]);

  await checkBudgetAlerts('user-1');

  expect(mockSchedule).toHaveBeenCalledTimes(2);
});

test('does nothing when user is not authenticated', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });

  await checkBudgetAlerts('user-1');

  expect(mockSchedule).not.toHaveBeenCalled();
});
