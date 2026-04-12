import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabase/client';

export interface Goal {
  id: string;
  name: string;
  emoji: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string | null;
  progressPercent: number;
  monthsLeft: number | null;
}

function toGoal(g: any): Goal {
  const progressPercent = g.target_amount > 0
    ? Math.min(100, Math.round((g.current_amount / g.target_amount) * 100))
    : 0;
  let monthsLeft: number | null = null;
  if (g.target_date) {
    const months = Math.ceil(
      (new Date(g.target_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30)
    );
    monthsLeft = Math.max(0, months);
  }
  return {
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    targetAmount: g.target_amount,
    currentAmount: g.current_amount,
    targetDate: g.target_date,
    progressPercent,
    monthsLeft,
  };
}

export function useGoals(): { goals: Goal[]; reload: () => void } {
  const [goals, setGoals] = useState<Goal[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase.from('savings_goals').select('*').order('created_at');
    if (data) setGoals(data.map(toGoal));
  }, []);

  useEffect(() => { load(); }, [load]);

  return { goals, reload: load };
}

export async function createGoal(
  name: string,
  emoji: string,
  targetAmount: number,
  currentAmount: number,
  targetDate: string | null
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await supabase.from('savings_goals').insert({
    user_id: user.id,
    name,
    emoji,
    target_amount: targetAmount,
    current_amount: currentAmount,
    target_date: targetDate || null,
  });
  if (error) throw error;
}

export async function updateGoalProgress(id: string, currentAmount: number): Promise<void> {
  const { error } = await supabase
    .from('savings_goals')
    .update({ current_amount: currentAmount })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteGoal(id: string): Promise<void> {
  const { error } = await supabase.from('savings_goals').delete().eq('id', id);
  if (error) throw error;
}
