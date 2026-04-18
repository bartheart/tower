// Mock transitive imports that require native modules / env vars
jest.mock('../../supabase/client', () => ({
  supabase: { auth: { getUser: jest.fn() } },
}));
jest.mock('../../db', () => ({
  database: { get: jest.fn() },
}));
jest.mock('../../auth/AuthContext', () => ({
  useAuth: jest.fn().mockReturnValue({ user: null }),
}));

import { getWeekRange, currentMonthRange } from '../useTransactions';

describe('getWeekRange', () => {
  it('returns Monday as start for a Wednesday', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T12:00:00Z'));
    const { start, end } = getWeekRange();
    expect(start).toBe('2026-04-13'); // Monday
    expect(end).toBe('2026-04-19');   // Sunday
    jest.useRealTimers();
  });

  it('returns Monday as start when today is Sunday', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-19T12:00:00Z'));
    const { start, end } = getWeekRange();
    expect(start).toBe('2026-04-13');
    expect(end).toBe('2026-04-19');
    jest.useRealTimers();
  });
});

describe('currentMonthRange', () => {
  it('returns first and last day of the current month', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T12:00:00Z'));
    const { start, end } = currentMonthRange();
    expect(start).toBe('2026-04-01');
    expect(end).toBe('2026-04-30');
    jest.useRealTimers();
  });
});
