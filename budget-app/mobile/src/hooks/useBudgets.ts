import { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '../supabase/client';
import Transaction from '../db/models/Transaction';

export interface BudgetCategory {
  id: string;
  name: string;
  emoji: string;
  monthlyLimit: number;
  monthlyFloor: number;      // sum of confirmed fixed_items for this category
  color: string;
  targetPct: number | null;  // % of income; null = not set / excluded from wellness score
  isGoal: boolean;
  goalId: string | null;
  priorityRank: number | null;
  plaidCategory: string | null; // Plaid categoryL1/L2 label for spend matching; null = use name
  spent: number;
}

interface SupabaseBudget {
  id: string;
  name: string;
  emoji: string;
  monthly_limit: number;
  monthly_floor: number;
  color: string;
  target_pct: number | null;
  is_goal: boolean;
  goal_id: string | null;
  priority_rank: number | null;
  plaid_category: string | null;
}

export function useBudgets(transactions: Transaction[]): {
  budgets: BudgetCategory[];
  reload: () => void;
} {
  const [categories, setCategories] = useState<SupabaseBudget[]>([]);

  const loadCategories = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('budget_categories')
      .select('*')
      .eq('user_id', user.id)
      .order('name');
    if (data) setCategories(data);
  }, []);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  const budgets = useMemo(() => {
    // Build spend map keyed by both categoryL1 and categoryL2 so budgets
    // named either "Food and Drink" or "Groceries" both get correct spend.
    const spendMap = new Map<string, number>();
    for (const txn of transactions) {
      if (txn.amount <= 0 || txn.pending) continue;
      const l1 = txn.categoryL1;
      const l2 = txn.categoryL2;
      spendMap.set(l1, (spendMap.get(l1) ?? 0) + txn.amount);
      if (l2 && l2 !== l1) {
        spendMap.set(l2, (spendMap.get(l2) ?? 0) + txn.amount);
      }
    }

    const result: BudgetCategory[] = categories.map(cat => ({
      id: cat.id,
      name: cat.name,
      emoji: cat.emoji,
      monthlyLimit: cat.monthly_limit,
      monthlyFloor: cat.monthly_floor ?? 0,
      color: cat.color,
      targetPct: cat.target_pct ?? null,
      isGoal: cat.is_goal ?? false,
      goalId: cat.goal_id ?? null,
      priorityRank: cat.priority_rank ?? null,
      plaidCategory: cat.plaid_category ?? null,
      // If a Plaid category key is set, use it for spend matching; otherwise fall back to name.
      spent: spendMap.get(cat.plaid_category ?? cat.name) ?? 0,
    }));

    result.sort((a, b) => (b.spent / b.monthlyLimit) - (a.spent / a.monthlyLimit));
    return result;
  }, [categories, transactions]);

  return { budgets, reload: loadCategories };
}

export async function createBudget(
  name: string,
  emoji: string,
  monthlyLimit: number,
  color: string,
  plaidCategory?: string,
  targetPct?: number,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const row: Record<string, unknown> = {
    user_id: user.id, name, emoji, monthly_limit: monthlyLimit, color,
  };
  if (plaidCategory) row.plaid_category = plaidCategory;
  if (targetPct != null) row.target_pct = targetPct;
  const { error } = await supabase.from('budget_categories').insert(row);
  if (error) throw error;
}

export async function updateBudget(
  id: string,
  fields: { monthlyLimit?: number; targetPct?: number; monthlyFloor?: number }
): Promise<void> {
  const patch: Record<string, number> = {};
  if (fields.monthlyLimit !== undefined) patch.monthly_limit = fields.monthlyLimit;
  if (fields.targetPct !== undefined) patch.target_pct = fields.targetPct;
  if (fields.monthlyFloor !== undefined) patch.monthly_floor = fields.monthlyFloor;
  const { error } = await supabase
    .from('budget_categories')
    .update(patch)
    .eq('id', id);
  if (error) throw error;
}

export async function deleteBudget(id: string): Promise<void> {
  const { error } = await supabase.from('budget_categories').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Change a bucket's targetPct and rebalance all other non-goal buckets so
 * the total stays at 100%.
 *
 * Increasing: cuts from others proportionally, respecting each bucket's floor.
 * Decreasing: distributes freed % to others proportionally.
 */
export async function rebalanceBucketPct(
  id: string,
  newPct: number,
  allCategories: BudgetCategory[],
  monthlyIncome: number,
): Promise<void> {
  const current = allCategories.find(c => c.id === id);
  if (!current) return;

  const oldPct = current.targetPct ?? 0;
  const delta = newPct - oldPct;
  if (Math.abs(delta) < 0.01) return;

  const others = allCategories.filter(c => c.id !== id && !c.isGoal && (c.targetPct ?? 0) > 0);
  const updates: Array<{ id: string; newPct: number }> = [
    { id, newPct: Math.round(newPct * 100) / 100 },
  ];

  if (delta > 0) {
    // Increasing — cut proportionally from others, respecting floor
    const slacks = others.map(c => {
      const floorPct = monthlyIncome > 0 ? (c.monthlyFloor / monthlyIncome) * 100 : 0;
      const minPct = Math.max(floorPct, 1);
      return { cat: c, slack: Math.max(0, (c.targetPct ?? 0) - minPct) };
    });

    let remaining = delta;
    const cutMap = new Map(slacks.map(x => [x.cat.id, 0]));
    let uncapped = slacks.filter(x => x.slack > 0);

    while (remaining > 0.001 && uncapped.length > 0) {
      const totalWeight = uncapped.reduce((s, x) => s + (1 / (x.cat.targetPct ?? 1)), 0);
      for (const entry of uncapped) {
        const weight = (1 / (entry.cat.targetPct ?? 1)) / totalWeight;
        const alreadyCut = cutMap.get(entry.cat.id) ?? 0;
        const actual = Math.min(weight * remaining, entry.slack - alreadyCut);
        cutMap.set(entry.cat.id, alreadyCut + actual);
      }
      const distributed = [...cutMap.values()].reduce((s, v) => s + v, 0);
      remaining = delta - distributed;
      uncapped = uncapped.filter(x => (cutMap.get(x.cat.id) ?? 0) < x.slack - 0.001);
    }

    for (const [otherId, cut] of cutMap) {
      if (Math.abs(cut) > 0.001) {
        const cat = others.find(c => c.id === otherId)!;
        updates.push({ id: otherId, newPct: Math.round(((cat.targetPct ?? 0) - cut) * 100) / 100 });
      }
    }
  } else {
    // Decreasing — redistribute freed % proportionally
    const freed = Math.abs(delta);
    const totalOther = others.reduce((s, c) => s + (c.targetPct ?? 0), 0);
    for (const c of others) {
      const share = totalOther > 0 ? (c.targetPct ?? 0) / totalOther : 1 / others.length;
      updates.push({ id: c.id, newPct: Math.round(((c.targetPct ?? 0) + freed * share) * 100) / 100 });
    }
  }

  await Promise.all(
    updates.map(u =>
      supabase.from('budget_categories').update({ target_pct: u.newPct }).eq('id', u.id),
    ),
  );
}
