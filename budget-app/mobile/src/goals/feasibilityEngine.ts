export type GoalStatus = 'on_track' | 'at_risk' | 'completed';

export interface FeasibilityGoal {
  id: string;
  targetAmount: number;
  currentAmount: number;
  startingAmount: number;
  targetDate: string | null;
  status: GoalStatus;
}

export interface FeasibilityInput {
  confirmedMonthlyIncome: number;
  currentMonthSpend: number;
  daysElapsed: number;
  daysInMonth: number;
  priorMonthSpend?: number; // used when daysElapsed === 0
  goals: FeasibilityGoal[];
}

export interface GoalFeasibilityResult {
  goalId: string;
  previousStatus: GoalStatus;
  newStatus: GoalStatus;
  statusChanged: boolean;
  projectedSurplus: number;
  shortfall: number;       // 0 if feasible
  monthlyContributionNeeded: number;
  monthsLeft: number | null;
}

function monthsUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30));
}

export function runFeasibilityCheck(input: FeasibilityInput): GoalFeasibilityResult[] {
  const {
    confirmedMonthlyIncome,
    currentMonthSpend,
    daysElapsed,
    daysInMonth,
    priorMonthSpend = 0,
    goals,
  } = input;

  // Projected spend: extrapolate current month, fall back to prior month on day 0
  const baseSpend = daysElapsed > 0
    ? (currentMonthSpend / daysElapsed) * daysInMonth
    : priorMonthSpend;

  const projectedSurplus = confirmedMonthlyIncome - baseSpend;

  // Sum of all active goal contributions
  const totalContributionNeeded = goals.reduce((sum, g) => {
    if (!g.targetDate || g.currentAmount >= g.targetAmount) return sum;
    const months = monthsUntil(g.targetDate);
    if (months <= 0) return sum; // overdue handled per-goal
    return sum + (g.targetAmount - g.currentAmount) / months;
  }, 0);

  return goals.map((goal): GoalFeasibilityResult => {
    const previousStatus = goal.status;

    // Already completed
    if (goal.currentAmount >= goal.targetAmount) {
      return {
        goalId: goal.id,
        previousStatus,
        newStatus: 'completed',
        statusChanged: previousStatus !== 'completed',
        projectedSurplus,
        shortfall: 0,
        monthlyContributionNeeded: 0,
        monthsLeft: 0,
      };
    }

    // No target date — aspirational goal, skip feasibility
    if (!goal.targetDate) {
      return {
        goalId: goal.id,
        previousStatus,
        newStatus: previousStatus === 'completed' ? 'on_track' : previousStatus,
        statusChanged: false,
        projectedSurplus,
        shortfall: 0,
        monthlyContributionNeeded: 0,
        monthsLeft: null,
      };
    }

    const monthsLeft = monthsUntil(goal.targetDate);

    // Overdue
    if (monthsLeft <= 0) {
      const newStatus: GoalStatus = 'at_risk';
      return {
        goalId: goal.id,
        previousStatus,
        newStatus,
        statusChanged: previousStatus !== newStatus,
        projectedSurplus,
        shortfall: goal.targetAmount - goal.currentAmount,
        monthlyContributionNeeded: goal.targetAmount - goal.currentAmount,
        monthsLeft: 0,
      };
    }

    const monthlyContributionNeeded = (goal.targetAmount - goal.currentAmount) / monthsLeft;
    const feasible = confirmedMonthlyIncome > 0 && projectedSurplus >= totalContributionNeeded;
    const shortfall = feasible ? 0 : Math.max(0, totalContributionNeeded - projectedSurplus);
    const newStatus: GoalStatus = feasible ? 'on_track' : 'at_risk';

    return {
      goalId: goal.id,
      previousStatus,
      newStatus,
      statusChanged: previousStatus !== newStatus,
      projectedSurplus,
      shortfall,
      monthlyContributionNeeded,
      monthsLeft,
    };
  });
}
