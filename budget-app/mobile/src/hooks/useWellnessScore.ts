import { useMemo } from 'react';
import Transaction from '../db/models/Transaction';
import { BudgetCategory } from './useBudgets';

export interface ScoreFactor {
  categoryId: string;
  name: string;
  color: string;
  targetPct: number;
  targetSpend: number;
  actualSpend: number;
  ratio: number;
  catScore: number;    // 0–100 integer
  scoreDelta: number;  // always <= 0 — 0 means on-track, negative = over-budget cost
                       // = round((catScore - 100) × (targetPct / totalAllocatedPct))
}

export interface WellnessResult {
  score: number;        // 0–100, integer
  history: number[];    // daily scores oldest-first, length = periodDays
  delta: number;        // today's score minus score 7 days ago (positive = improving)
  status: string;       // 'Excellent' | 'Good' | 'Fair' | 'At risk'
  statusColor: string;
  factors: ScoreFactor[];  // sorted worst catScore first
}

export function computeStatus(score: number): { label: string; color: string } {
  if (score >= 85) return { label: 'Excellent', color: '#4ade80' };
  if (score >= 70) return { label: 'Good',      color: '#f59e0b' };
  if (score >= 50) return { label: 'Fair',       color: '#fb923c' };
  return               { label: 'At risk',      color: '#ef4444' };
}

/**
 * Compute a 0–100 wellness score.
 *
 * For each budget category that has a targetPct set:
 *   target_spend = income × (targetPct / 100)
 *   ratio        = actual_spend / target_spend
 *   cat_score    = clamp(1 - max(0, ratio - 1), 0, 1)
 *                  = 1.0 when at or under budget
 *                  = 0.5 when 50% over budget
 *                  = 0.0 when 100% or more over budget
 *
 * Global score = weighted average of cat_score × targetPct, normalised to 100.
 */
export function computeScore(
  budgets: BudgetCategory[],
  monthlyIncome: number
): number {
  const eligible = budgets.filter(b => b.targetPct != null && b.targetPct > 0);
  if (eligible.length === 0 || monthlyIncome <= 0) return 0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const b of eligible) {
    const pct = b.targetPct!;
    const targetSpend = monthlyIncome * (pct / 100);
    const ratio = targetSpend > 0 ? b.spent / targetSpend : 0;
    const catScore = Math.max(0, Math.min(1, 1 - Math.max(0, ratio - 1)));
    weightedSum += catScore * pct;
    totalWeight += pct;
  }

  return Math.round((weightedSum / totalWeight) * 100);
}

/**
 * Compute a breakdown of the wellness score by category, exposing per-category
 * contributions to the global score.
 */
export function computeScoreBreakdown(
  budgets: BudgetCategory[],
  monthlyIncome: number
): ScoreFactor[] {
  if (monthlyIncome <= 0) return [];
  const eligible = budgets.filter(b => b.targetPct != null && b.targetPct > 0);
  if (eligible.length === 0) return [];

  const totalAllocatedPct = eligible.reduce((s, b) => s + b.targetPct!, 0);

  return eligible
    .map(b => {
      const pct = b.targetPct!;
      const targetSpend = monthlyIncome * (pct / 100);
      const ratio = targetSpend > 0 ? b.spent / targetSpend : 0;
      const catScore = Math.round(
        Math.max(0, Math.min(1, 1 - Math.max(0, ratio - 1))) * 100
      );
      const scoreDelta = Math.round((catScore - 100) * (pct / totalAllocatedPct));
      return {
        categoryId: b.id,
        name: b.name,
        color: b.color,
        targetPct: pct,
        targetSpend,
        actualSpend: b.spent,
        ratio,
        catScore,
        scoreDelta,
      };
    })
    .sort((a, b) => a.catScore - b.catScore);
}

/**
 * Compute the score for transactions up to and including `upToDate` (YYYY-MM-DD).
 * Used to build sparkline history.
 */
function scoreUpTo(
  allTransactions: Transaction[],
  budgets: BudgetCategory[],
  monthlyIncome: number,
  upToDate: string
): number {
  const filtered = allTransactions.filter(t => t.date <= upToDate && t.amount > 0 && !t.pending);
  const spendMap = new Map<string, number>();
  for (const txn of filtered) {
    const l1 = txn.categoryL1;
    const l2 = txn.categoryL2;
    spendMap.set(l1, (spendMap.get(l1) ?? 0) + txn.amount);
    if (l2 && l2 !== l1) spendMap.set(l2, (spendMap.get(l2) ?? 0) + txn.amount);
  }
  const budgetsWithSpend = budgets.map(b => ({ ...b, spent: spendMap.get(b.name) ?? 0 }));
  return computeScore(budgetsWithSpend, monthlyIncome);
}

export function useWellnessScore(
  transactions: Transaction[],
  budgets: BudgetCategory[],
  monthlyIncome: number,
  periodDays: number = 7
): WellnessResult {
  return useMemo(() => {
    const today = new Date();
    const history: number[] = [];

    for (let i = periodDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      history.push(scoreUpTo(transactions, budgets, monthlyIncome, dateStr));
    }

    const score = history[history.length - 1] ?? 0;
    const delta = history.length >= 7
      ? score - (history[history.length - 7] ?? 0)
      : 0;

    const { label: status, color: statusColor } = computeStatus(score);
    const factors = computeScoreBreakdown(budgets, monthlyIncome);
    return { score, history, delta, status, statusColor, factors };
  }, [transactions, budgets, monthlyIncome, periodDays]);
}
