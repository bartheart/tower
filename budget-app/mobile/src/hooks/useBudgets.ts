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
}

export function useBudgets(transactions: Transaction[]): {
  budgets: BudgetCategory[];
  reload: () => void;
} {
  const [categories, setCategories] = useState<SupabaseBudget[]>([]);

  const loadCategories = useCallback(async () => {
    const { data } = await supabase
      .from('budget_categories')
      .select('*')
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
      spent: spendMap.get(cat.name) ?? 0,
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
  color: string
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await supabase
    .from('budget_categories')
    .insert({ user_id: user.id, name, emoji, monthly_limit: monthlyLimit, color });
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
