import { getWeekRange, currentMonthRange } from '../useTransactions';

describe('getWeekRange', () => {
  it('returns Monday as start for a Wednesday', () => {
    // Wednesday 2026-04-15
    jest.useFakeTimers().setSystemTime(new Date('2026-04-15T12:00:00Z'));
    const { start, end } = getWeekRange();
    expect(start).toBe('2026-04-13'); // Monday
    expect(end).toBe('2026-04-19');   // Sunday
    jest.useRealTimers();
  });

  it('returns Monday as start when today is Sunday', () => {
    // Sunday 2026-04-19
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
