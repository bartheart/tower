import { computeScore, computeStatus, computeScoreBreakdown } from '../useWellnessScore';
import { BudgetCategory } from '../useBudgets';

const makeBudget = (name: string, targetPct: number, spent: number): BudgetCategory => ({
  id: name, name, emoji: '💰', monthlyLimit: 500, color: '#6366f1', targetPct, spent,
  isGoal: false, goalId: null, monthlyFloor: 0, priorityRank: null, plaidCategory: null,
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

describe('computeScoreBreakdown', () => {
  it('returns [] when monthlyIncome is 0', () => {
    expect(computeScoreBreakdown([makeBudget('Food', 15, 100)], 0)).toEqual([]);
  });

  it('returns [] when no categories have targetPct > 0', () => {
    const b: BudgetCategory = { ...makeBudget('Food', 0, 100), targetPct: null };
    expect(computeScoreBreakdown([b], 1000)).toEqual([]);
  });

  it('returns catScore 100 and scoreDelta 0 for under-budget category', () => {
    const [f] = computeScoreBreakdown([makeBudget('Food', 100, 500)], 1000);
    expect(f.catScore).toBe(100);
    expect(f.scoreDelta).toBe(0);
  });

  it('returns catScore 50 and scoreDelta -50 for 50%-over single category', () => {
    // targetSpend = 1000, spent = 1500, ratio = 1.5
    // catScore = round((1 - 0.5) * 100) = 50
    // scoreDelta = round((50 - 100) * (100/100)) = -50
    const [f] = computeScoreBreakdown([makeBudget('Dining', 100, 1500)], 1000);
    expect(f.catScore).toBe(50);
    expect(f.scoreDelta).toBe(-50);
  });

  it('sorts worst catScore first', () => {
    const budgets = [
      makeBudget('Good', 50, 100),  // under budget → catScore 100
      makeBudget('Bad', 50, 900),   // way over → catScore 0
    ];
    const factors = computeScoreBreakdown(budgets, 1000);
    expect(factors[0].name).toBe('Bad');
    expect(factors[1].name).toBe('Good');
  });

  it('populates all fields correctly', () => {
    const b = makeBudget('Housing', 30, 270);
    // targetSpend = 1000 * 0.30 = 300; ratio = 0.9; catScore = 100; scoreDelta = 0
    const [f] = computeScoreBreakdown([b], 1000);
    expect(f.categoryId).toBe('Housing');
    expect(f.name).toBe('Housing');
    expect(f.color).toBe('#6366f1');
    expect(f.targetPct).toBe(30);
    expect(f.targetSpend).toBe(300);
    expect(f.actualSpend).toBe(270);
    expect(f.ratio).toBeCloseTo(0.9);
    expect(f.catScore).toBe(100);
    expect(f.scoreDelta).toBe(0);
  });

  it('splits scoreDelta proportionally across two categories', () => {
    const budgets = [
      makeBudget('A', 50, 1000),  // targetSpend 500, spent 1000 → 100% over → catScore 0
      makeBudget('B', 50, 100),   // under budget → catScore 100
    ];
    const factors = computeScoreBreakdown(budgets, 1000);
    const a = factors.find(f => f.name === 'A')!;
    const b = factors.find(f => f.name === 'B')!;
    expect(a.scoreDelta).toBe(-50);
    expect(b.scoreDelta).toBe(0);
  });
});
