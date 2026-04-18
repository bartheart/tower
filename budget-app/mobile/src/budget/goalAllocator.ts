/**
 * Goal Allocation Engine
 *
 * When a savings goal is added, it becomes a new budget bucket competing
 * for the income pie. This module computes how to carve out the required
 * targetPct from existing non-goal buckets, respecting each bucket's floor.
 *
 * Invariant: SUM(targetPct) across all budget_categories = 100 after every op.
 */

import { supabase } from '../supabase/client';
import { BudgetCategory } from '../hooks/useBudgets';

export interface AllocationPreview {
  goalTargetPct: number;
  monthlyContribution: number;
  cuts: Array<{ categoryId: string; name: string; oldPct: number; newPct: number; delta: number }>;
  feasible: boolean;
  shortfallPct: number; // 0 if feasible
}

export interface GoalInput {
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string; // ISO date string
}

function monthsUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  return Math.max(
    1,
    Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30))
  );
}

/**
 * Preview what would happen if this goal were added.
 * Does NOT write to the database.
 */
export function previewGoalAllocation(
  goal: GoalInput,
  categories: BudgetCategory[],
  confirmedMonthlyIncome: number
): AllocationPreview {
  if (confirmedMonthlyIncome <= 0) {
    return {
      goalTargetPct: 0,
      monthlyContribution: 0,
      cuts: [],
      feasible: false,
      shortfallPct: 100,
    };
  }

  const months = monthsUntil(goal.targetDate);
  const monthlyContribution = (goal.targetAmount - goal.currentAmount) / months;
  const goalTargetPct = (monthlyContribution / confirmedMonthlyIncome) * 100;

  // Only non-goal buckets can be cut
  const eligible = categories.filter(c => !c.isGoal && (c.targetPct ?? 0) > 0);

  // Compute available slack per bucket (above floor)
  const slacks = eligible.map(c => {
    const floorPct = (c.monthlyFloor / confirmedMonthlyIncome) * 100;
    const minPct = Math.max(floorPct, 1); // never below 1%
    const slack = Math.max(0, (c.targetPct ?? 0) - minPct);
    return { cat: c, slack, minPct };
  });

  const totalSlack = slacks.reduce((s, x) => s + x.slack, 0);

  if (totalSlack < goalTargetPct) {
    return {
      goalTargetPct,
      monthlyContribution,
      cuts: [],
      feasible: false,
      shortfallPct: goalTargetPct - totalSlack,
    };
  }

  // Distribute cut inversely weighted by targetPct (lower priority = bigger cut)
  // Iterate to handle floor caps
  let remaining = goalTargetPct;
  const cutMap = new Map<string, number>(slacks.map(x => [x.cat.id, 0]));
  let uncapped = slacks.filter(x => x.slack > 0);

  while (remaining > 0.001 && uncapped.length > 0) {
    const totalWeight = uncapped.reduce((s, x) => s + (1 / (x.cat.targetPct ?? 1)), 0);

    for (const entry of uncapped) {
      const weight = (1 / (entry.cat.targetPct ?? 1)) / totalWeight;
      const rawCut = weight * remaining;
      const alreadyCut = cutMap.get(entry.cat.id) ?? 0;
      const maxAdditionalCut = entry.slack - alreadyCut;
      const actualCut = Math.min(rawCut, maxAdditionalCut);
      cutMap.set(entry.cat.id, alreadyCut + actualCut);
    }

    const distributed = [...cutMap.values()].reduce((s, v) => s + v, 0);
    remaining = goalTargetPct - distributed;

    // Remove fully-capped buckets from next round
    uncapped = uncapped.filter(x => {
      const cut = cutMap.get(x.cat.id) ?? 0;
      return cut < x.slack - 0.001;
    });
  }

  const cuts = slacks
    .map(x => {
      const cut = cutMap.get(x.cat.id) ?? 0;
      const oldPct = x.cat.targetPct ?? 0;
      const newPct = Math.round((oldPct - cut) * 100) / 100;
      return {
        categoryId: x.cat.id,
        name: x.cat.name,
        oldPct,
        newPct,
        delta: Math.round(-cut * 100) / 100,
      };
    })
    .filter(c => Math.abs(c.delta) > 0.001);

  return { goalTargetPct, monthlyContribution, cuts, feasible: true, shortfallPct: 0 };
}

/**
 * Commits a goal allocation to Supabase:
 * 1. Creates savings_goal row
 * 2. Creates budget_category row (is_goal=true)
 * 3. Updates all affected bucket targetPcts
 * 4. Links goal ↔ category
 *
 * Returns the new goal id.
 */
export async function commitGoalAllocation(
  goal: GoalInput,
  preview: AllocationPreview,
  color: string = '#6366f1'
): Promise<string> {
  if (!preview.feasible) throw new Error('Allocation not feasible');

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // 1. Create goal row (without linked_category_id yet)
  const { data: goalRow, error: goalError } = await supabase
    .from('savings_goals')
    .insert({
      user_id: user.id,
      name: goal.name,
      emoji: '🎯',
      target_amount: goal.targetAmount,
      current_amount: goal.currentAmount,
      target_date: goal.targetDate,
      monthly_contribution: preview.monthlyContribution,
    })
    .select('id')
    .single();

  if (goalError || !goalRow) throw goalError ?? new Error('Failed to create goal');

  // 2. Create budget_category for this goal
  const { data: catRow, error: catError } = await supabase
    .from('budget_categories')
    .insert({
      user_id: user.id,
      name: goal.name,
      emoji: '🎯',
      monthly_limit: preview.monthlyContribution,
      monthly_floor: 0,
      color,
      target_pct: Math.round(preview.goalTargetPct * 100) / 100,
      is_goal: true,
      goal_id: goalRow.id,
    })
    .select('id')
    .single();

  if (catError || !catRow) throw catError ?? new Error('Failed to create goal category');

  // 3. Update affected buckets + link goal ↔ category in parallel
  const updates = preview.cuts.map(cut =>
    supabase
      .from('budget_categories')
      .update({ target_pct: cut.newPct })
      .eq('id', cut.categoryId)
  );

  const linkGoal = supabase
    .from('savings_goals')
    .update({ linked_category_id: catRow.id })
    .eq('id', goalRow.id);

  await Promise.all([...updates, linkGoal]);

  return goalRow.id;
}

/**
 * Removes a goal and redistributes its targetPct back to non-goal buckets,
 * proportional to their current targetPct.
 */
export async function removeGoalAllocation(
  goalId: string,
  categories: BudgetCategory[]
): Promise<void> {
  // Find the goal's budget category
  const goalCat = categories.find(c => c.goalId === goalId);
  if (!goalCat) return;

  const freedPct = goalCat.targetPct ?? 0;

  // Redistribute to non-goal buckets proportionally
  const eligible = categories.filter(c => !c.isGoal && (c.targetPct ?? 0) > 0);
  const totalEligiblePct = eligible.reduce((s, c) => s + (c.targetPct ?? 0), 0);

  const updates = eligible.map(c => {
    const share = totalEligiblePct > 0 ? (c.targetPct ?? 0) / totalEligiblePct : 1 / eligible.length;
    const newPct = Math.round(((c.targetPct ?? 0) + freedPct * share) * 100) / 100;
    return supabase
      .from('budget_categories')
      .update({ target_pct: newPct })
      .eq('id', c.id);
  });

  const deleteCategory = supabase
    .from('budget_categories')
    .delete()
    .eq('goal_id', goalId);

  const deleteGoal = supabase
    .from('savings_goals')
    .delete()
    .eq('id', goalId);

  await Promise.all([...updates, deleteCategory, deleteGoal]);
}
