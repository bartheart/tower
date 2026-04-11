import { useEffect, useState } from 'react';
import { Q } from '@nozbe/watermelondb';
import { supabase } from '../supabase/client';
import { database } from '../db';
import Transaction from '../db/models/Transaction';

export interface BudgetCategory {
  id: string;
  name: string;
  emoji: string;
  monthlyLimit: number;
  color: string;
  spent: number;
}

function currentMonthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
}

export function useBudgets(): BudgetCategory[] {
  const [budgets, setBudgets] = useState<BudgetCategory[]>([]);

  useEffect(() => {
    async function load() {
      const { data: categories } = await supabase
        .from('budget_categories')
        .select('*')
        .order('name');

      if (!categories) return;

      const start = currentMonthStart();
      const txns = await database
        .get<Transaction>('transactions')
        .query(Q.where('date', Q.gte(start)), Q.where('pending', false))
        .fetch();

      const spendMap = new Map<string, number>();
      for (const txn of txns) {
        if (txn.amount <= 0) continue;
        const key = txn.categoryL1;
        spendMap.set(key, (spendMap.get(key) ?? 0) + txn.amount);
      }

      const result: BudgetCategory[] = categories.map(cat => ({
        id: cat.id,
        name: cat.name,
        emoji: cat.emoji,
        monthlyLimit: cat.monthly_limit,
        color: cat.color,
        spent: spendMap.get(cat.name) ?? 0,
      }));

      // Over-budget categories float to top
      result.sort((a, b) => (b.spent / b.monthlyLimit) - (a.spent / a.monthlyLimit));
      setBudgets(result);
    }

    load();
  }, []);

  return budgets;
}
