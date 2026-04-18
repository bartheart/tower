import { computeScore, computeStatus } from '../useWellnessScore';
import { BudgetCategory } from '../useBudgets';

const makeBudget = (name: string, targetPct: number, spent: number): BudgetCategory => ({
  id: name, name, emoji: '💰', monthlyLimit: 500, color: '#6366f1', targetPct, spent,
});

describe('computeScore', () => {
  it('returns 100 when all categories are under budget', () => {
    const budgets = [
      makeBudget('Food', 15, 100),      // target $600 on $4000 income, spent $100 → under
      makeBudget('Transport', 10, 200), // target $400, spent $200 → under
    ];
    expect(computeScore(budgets, 4000)).toBe(100);
  });

  it('returns 0 when all categories are 100%+ over budget', () => {
    const budgets = [
      makeBudget('Food', 15, 1200),     // target $600, spent $1200 → 2× over → score 0
    ];
    expect(computeScore(budgets, 4000)).toBe(0);
  });

  it('returns 50 when a single category is 50% over', () => {
    const budgets = [
      makeBudget('Food', 100, 1500),    // target $1000, spent $1500 → 50% over → score 50
    ];
    expect(computeScore(budgets, 1000)).toBe(50);
  });

  it('ignores categories with null targetPct', () => {
    const budgets: BudgetCategory[] = [
      { id: '1', name: 'Food', emoji: '🍔', monthlyLimit: 400, color: '#22c55e', targetPct: null, spent: 9999 },
      makeBudget('Transport', 100, 200), // target $400, spent $200 → score 100
    ];
    expect(computeScore(budgets, 400)).toBe(100);
  });

  it('returns 0 when no categories have targetPct set', () => {
    const budgets: BudgetCategory[] = [
      { id: '1', name: 'Food', emoji: '🍔', monthlyLimit: 400, color: '#22c55e', targetPct: null, spent: 100 },
    ];
    expect(computeScore(budgets, 4000)).toBe(0);
  });
});

describe('computeStatus', () => {
  it('returns Excellent for score >= 85', () => {
    expect(computeStatus(85).label).toBe('Excellent');
    expect(computeStatus(100).label).toBe('Excellent');
  });
  it('returns Good for 70–84', () => {
    expect(computeStatus(70).label).toBe('Good');
    expect(computeStatus(84).label).toBe('Good');
  });
  it('returns Fair for 50–69', () => {
    expect(computeStatus(65).label).toBe('Fair');
  });
  it('returns At risk for < 50', () => {
    expect(computeStatus(0).label).toBe('At risk');
    expect(computeStatus(49).label).toBe('At risk');
  });
});
