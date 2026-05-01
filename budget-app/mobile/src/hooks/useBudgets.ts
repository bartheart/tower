import { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '../supabase/client';
import Transaction from '../db/models/Transaction';
import { computeRedistribution } from '../budget/redistributeOnDelete';

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
      .order('priority_rank', { ascending: true, nullsFirst: false });
    if (!data) return;

    // One-time rank initialization: if every row has null priority_rank,
    // assign ranks 1…N ordered by created_at (oldest = highest priority).
    const allNull = data.every(c => c.priority_rank == null);
    if (allNull && data.length > 0) {
      const { data: ordered } = await supabase
        .from('budget_categories')
        .select('id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });
      if (ordered) {
        const results = await Promise.all(
          ordered.map((row, index) =>
            supabase
              .from('budget_categories')
              .update({ priority_rank: index + 1 })
              .eq('id', row.id)
          )
        );
        const writeError = results.find(r => r.error)?.error;
        if (writeError) {
          // Partial write — some ranks may not have been set.
          // Fall through and reload so the user at least sees their data.
          console.warn('[useBudgets] rank init partial failure', writeError);
        }
        // Reload now that ranks are set
        const { data: ranked } = await supabase
          .from('budget_categories')
          .select('*')
          .eq('user_id', user.id)
          .order('priority_rank', { ascending: true, nullsFirst: false });
        if (ranked) { setCategories(ranked); return; }
      }
    }

    setCategories(data);
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

  // New bucket always joins at the bottom (lowest priority).
  const { data: existing } = await supabase
    .from('budget_categories')
    .select('priority_rank')
    .eq('user_id', user.id)
    .order('priority_rank', { ascending: false })
    .limit(1);
  const nextRank = (existing?.[0]?.priority_rank ?? 0) + 1;

  const row: Record<string, unknown> = {
    user_id: user.id, name, emoji, monthly_limit: monthlyLimit,
    color, priority_rank: nextRank,
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
 * Change a bucket's targetPct.
 *
 * Increasing: consumes unallocated budget first; only cuts from others if delta > unallocated.
 * Decreasing: only updates the target bucket — freed % stays unallocated.
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

  const updates: Array<{ id: string; newPct: number }> = [
    { id, newPct: Math.round(newPct * 100) / 100 },
  ];

  if (delta > 0) {
    // Consume unallocated budget first, then cut from others only if needed
    const totalAllocated = allCategories.reduce((s, c) => s + (c.targetPct ?? 0), 0);
    const unallocated = Math.max(0, 100 - totalAllocated);
    const fromOthers = Math.max(0, delta - unallocated);

    if (fromOthers > 0.001) {
      const others = allCategories.filter(c => c.id !== id && !c.isGoal && (c.targetPct ?? 0) > 0);
      const slacks = others.map(c => {
        const floorPct = monthlyIncome > 0 ? (c.monthlyFloor / monthlyIncome) * 100 : 0;
        const minPct = Math.max(floorPct, 1);
        return { cat: c, slack: Math.max(0, (c.targetPct ?? 0) - minPct) };
      });

      let remaining = fromOthers;
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
        remaining = fromOthers - distributed;
        uncapped = uncapped.filter(x => (cutMap.get(x.cat.id) ?? 0) < x.slack - 0.001);
      }

      for (const [otherId, cut] of cutMap) {
        if (Math.abs(cut) > 0.001) {
          const cat = allCategories.find(c => c.id === otherId)!;
          updates.push({ id: otherId, newPct: Math.round(((cat.targetPct ?? 0) - cut) * 100) / 100 });
        }
      }
    }
    // If delta <= unallocated: only target bucket updated, no cuts needed
  }
  // Decreasing: only update target bucket — freed % stays unallocated

  await Promise.all(
    updates.map(u =>
      supabase.from('budget_categories').update({ target_pct: u.newPct }).eq('id', u.id),
    ),
  );
}

export async function deleteBudgetWithRedistribution(
  id: string,
  allCategories: BudgetCategory[],
): Promise<void> {
  const target = allCategories.find(c => c.id === id);
  const freedPct = target?.targetPct ?? 0;

  const candidates = allCategories
    .filter(c => c.id !== id && !c.isGoal && (c.targetPct ?? 0) > 0)
    .map(c => ({
      id: c.id,
      targetPct: c.targetPct ?? 0,
      priorityRank: c.priorityRank,
    }));

  const redistributed = computeRedistribution(candidates, freedPct);

  // Delete first — redistribution only fires if delete succeeds
  const { error: deleteError } = await supabase
    .from('budget_categories')
    .delete()
    .eq('id', id);
  if (deleteError) throw deleteError;

  if (redistributed.length > 0) {
    const results = await Promise.all(
      redistributed.map(r =>
        supabase.from('budget_categories').update({ target_pct: r.newPct }).eq('id', r.id)
      ),
    );
    const failed = results.find(r => r.error);
    if (failed?.error) throw failed.error;
  }
}

/**
 * Batch-update priority_rank for all buckets based on the new display order.
 * Called after a drag-to-reorder gesture completes. Assigns rank 1…N.
 */
export async function updateBucketRanks(orderedIds: string[]): Promise<void> {
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from('budget_categories')
        .update({ priority_rank: index + 1 })
        .eq('id', id)
    )
  );
  const failed = results.find(r => r.error);
  if (failed) throw failed.error;
}
