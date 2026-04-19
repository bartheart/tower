import { Q } from '@nozbe/watermelondb';
import { database } from '../db';
import Transaction from '../db/models/Transaction';
import { supabase } from '../supabase/client';
import { runFeasibilityCheck, FeasibilityGoal, GoalStatus } from './feasibilityEngine';
import { writeGoalEvent } from './goalEvents';
import { fireGoalAtRiskNotification, clearGoalAtRiskKey } from './goalNotifications';

function currentMonthBounds(): { monthStart: string; monthEnd: string; daysElapsed: number; daysInMonth: number } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthStr = String(month + 1).padStart(2, '0');
  const nextMonth = month === 11 ? 1 : month + 2;
  const nextYear = month === 11 ? year + 1 : year;
  const nextMonthStr = String(nextMonth).padStart(2, '0');
  const monthStart = `${year}-${monthStr}-01`;
  const monthEnd = `${nextYear}-${nextMonthStr}-01`;
  const daysElapsed = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return { monthStart, monthEnd, daysElapsed, daysInMonth };
}

export async function checkGoalFeasibility(userId: string): Promise<void> {
  // 1. Load goals
  const { data: goalsData } = await supabase
    .from('savings_goals')
    .select('id, name, target_amount, current_amount, starting_amount, target_date, status')
    .eq('user_id', userId);
  if (!goalsData || goalsData.length === 0) return;

  // 2. Load confirmed monthly income
  const { data: incomeData } = await supabase
    .from('income_sources')
    .select('amount_monthly, is_confirmed')
    .eq('user_id', userId);
  const confirmedMonthlyIncome = (incomeData ?? [])
    .filter((s: any) => s.is_confirmed)
    .reduce((sum: number, s: any) => sum + s.amount_monthly, 0);

  // 3. Load budgets (for snapshot)
  const { data: bucketsData } = await supabase
    .from('budget_categories')
    .select('id, name, target_pct, monthly_floor, monthly_limit, priority_rank, is_goal')
    .eq('user_id', userId);

  // 4. Compute current month spend from WatermelonDB
  const { monthStart, monthEnd, daysElapsed, daysInMonth } = currentMonthBounds();
  const transactions = await database
    .get<Transaction>('transactions')
    .query(
      Q.where('user_id', userId),
      Q.where('date', Q.gte(monthStart)),
      Q.where('date', Q.lt(monthEnd)),
    )
    .fetch();

  const currentMonthSpend = transactions
    .filter(t => t.amount > 0 && !t.pending)
    .reduce((sum, t) => sum + t.amount, 0);

  // 5. Run feasibility engine
  const goals: FeasibilityGoal[] = goalsData.map((g: any) => ({
    id: g.id,
    targetAmount: g.target_amount,
    currentAmount: g.current_amount,
    startingAmount: g.starting_amount ?? 0,
    targetDate: g.target_date ?? null,
    status: g.status as GoalStatus,
  }));

  const results = runFeasibilityCheck({
    confirmedMonthlyIncome,
    currentMonthSpend,
    daysElapsed,
    daysInMonth,
    goals,
  });

  // 6. Handle each result
  for (const result of results) {
    const goal = goalsData.find((g: any) => g.id === result.goalId)!;

    // Update status in Supabase
    await supabase
      .from('savings_goals')
      .update({ status: result.newStatus, last_computed_at: new Date().toISOString() })
      .eq('id', result.goalId);

    if (!result.statusChanged) continue;

    // Write audit event
    await writeGoalEvent({
      userId,
      goalId: result.goalId,
      eventType: result.newStatus === 'on_track' ? 'back_on_track' : result.newStatus,
      trigger: 'sync',
      shortfall: result.shortfall,
      snapshot: {
        income: confirmedMonthlyIncome,
        projectedSurplus: result.projectedSurplus,
        shortfall: result.shortfall,
        contributionNeeded: result.monthlyContributionNeeded,
        monthsLeft: result.monthsLeft,
        buckets: bucketsData ?? [],
      },
    });

    // Fire notification or clear dedup key
    if (result.newStatus === 'at_risk') {
      await fireGoalAtRiskNotification(goal.name, goal.id);
    } else if (result.newStatus === 'on_track') {
      await clearGoalAtRiskKey(goal.id);
    }
  }
}
