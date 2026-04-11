import { useEffect, useState } from 'react';
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

export function useGoals(): Goal[] {
  const [goals, setGoals] = useState<Goal[]>([]);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('savings_goals').select('*').order('created_at');
      if (!data) return;

      setGoals(data.map(g => {
        const progressPercent = Math.min(100, Math.round((g.current_amount / g.target_amount) * 100));
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
      }));
    }

    load();
  }, []);

  return goals;
}
