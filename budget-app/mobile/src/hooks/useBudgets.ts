import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../supabase/client';
import Transaction from '../db/models/Transaction';

export interface BudgetCategory {
  id: string;
  name: string;
  emoji: string;
  monthlyLimit: number;
  color: string;
  spent: number;
}

interface SupabaseBudget {
  id: string;
  name: string;
  emoji: string;
  monthly_limit: number;
  color: string;
}

export function useBudgets(transactions: Transaction[]): BudgetCategory[] {
  const [categories, setCategories] = useState<SupabaseBudget[]>([]);

  // Fetch category definitions once (they rarely change)
  useEffect(() => {
    supabase
      .from('budget_categories')
      .select('*')
      .order('name')
      .then(({ data }) => { if (data) setCategories(data); });
  }, []);

  // Recalculate spend whenever transactions change (reactive)
  return useMemo(() => {
    const spendMap = new Map<string, number>();
    for (const txn of transactions) {
      if (txn.amount <= 0 || txn.pending) continue;
      spendMap.set(txn.categoryL1, (spendMap.get(txn.categoryL1) ?? 0) + txn.amount);
    }

    const result: BudgetCategory[] = categories.map(cat => ({
      id: cat.id,
      name: cat.name,
      emoji: cat.emoji,
      monthlyLimit: cat.monthly_limit,
      color: cat.color,
      spent: spendMap.get(cat.name) ?? 0,
    }));

    result.sort((a, b) => (b.spent / b.monthlyLimit) - (a.spent / a.monthlyLimit));
    return result;
  }, [categories, transactions]);
}

export async function createBudget(
  name: string,
  emoji: string,
  monthlyLimit: number,
  color: string
): Promise<void> {
  const { error } = await supabase
    .from('budget_categories')
    .insert({ name, emoji, monthly_limit: monthlyLimit, color });
  if (error) throw error;
}

export async function deleteBudget(id: string): Promise<void> {
  const { error } = await supabase.from('budget_categories').delete().eq('id', id);
  if (error) throw error;
}
