import { runFeasibilityCheck, GoalStatus } from '../feasibilityEngine';

const baseInput = {
  confirmedMonthlyIncome: 5000,
  currentMonthSpend: 1500,
  daysElapsed: 15,
  daysInMonth: 30,
  goals: [
    {
      id: 'g1',
      targetAmount: 6000,
      currentAmount: 1000,
      startingAmount: 1000,
      targetDate: '2026-10-01',
      status: 'on_track' as GoalStatus,
    },
  ],
};

test('marks goal on_track when surplus covers contribution', () => {
  // projectedSpend = 1500/15*30 = 3000, surplus = 5000-3000 = 2000
  // monthsLeft ≈ 6, contribution = (6000-1000)/6 ≈ 834
  const results = runFeasibilityCheck(baseInput);
  expect(results[0].newStatus).toBe('on_track');
  expect(results[0].shortfall).toBe(0);
});

test('marks goal at_risk when surplus < total contributions needed', () => {
  const result = runFeasibilityCheck({
    ...baseInput,
    confirmedMonthlyIncome: 2000, // surplus = 2000-3000 = negative → shortfall
  });
  expect(result[0].newStatus).toBe('at_risk');
  expect(result[0].shortfall).toBeGreaterThan(0);
});

test('marks goal completed when currentAmount >= targetAmount', () => {
  const result = runFeasibilityCheck({
    ...baseInput,
    goals: [{ ...baseInput.goals[0], currentAmount: 6000 }],
  });
  expect(result[0].newStatus).toBe('completed');
});

test('skips feasibility check for goals with no targetDate', () => {
  const result = runFeasibilityCheck({
    ...baseInput,
    goals: [{ ...baseInput.goals[0], targetDate: null }],
  });
  expect(result[0].newStatus).toBe('on_track'); // unchanged
  expect(result[0].shortfall).toBe(0);
});

test('marks all goals at_risk when income is zero', () => {
  const result = runFeasibilityCheck({ ...baseInput, confirmedMonthlyIncome: 0 });
  expect(result[0].newStatus).toBe('at_risk');
});

test('uses prior month spend when daysElapsed is 0', () => {
  const result = runFeasibilityCheck({
    ...baseInput,
    currentMonthSpend: 0,
    daysElapsed: 0,
    priorMonthSpend: 2000,
  });
  expect(result[0].newStatus).toBe('on_track'); // surplus = 5000-2000=3000 > contribution
});

test('marks goal at_risk when overdue (monthsLeft <= 0)', () => {
  const result = runFeasibilityCheck({
    ...baseInput,
    goals: [{ ...baseInput.goals[0], targetDate: '2025-01-01' }], // past date
  });
  expect(result[0].newStatus).toBe('at_risk');
});

test('status stays at_risk if already at_risk and still infeasible', () => {
  const result = runFeasibilityCheck({
    ...baseInput,
    confirmedMonthlyIncome: 500,
    goals: [{ ...baseInput.goals[0], status: 'at_risk' as GoalStatus }],
  });
  expect(result[0].previousStatus).toBe('at_risk');
  expect(result[0].newStatus).toBe('at_risk');
  expect(result[0].statusChanged).toBe(false);
});
