export interface SuggestionBucket {
  id: string;
  name: string;
  targetPct: number;
  monthlyFloor: number;
  monthlyLimit: number;
  priorityRank: number | null;
  isGoal: boolean;
}

export interface BudgetCut {
  bucketId: string;
  bucketName: string;
  currentPct: number;
  suggestedPct: number;
  cutAmount: number;
  reason: string;
}

export interface SuggestionInput {
  shortfall: number;
  buckets: SuggestionBucket[];
  confirmedMonthlyIncome: number;
  goalMonthlyContribution?: number;
  projectedSurplus?: number;
  monthsLeft?: number;
}

export interface SuggestionResult {
  cuts: BudgetCut[];
  coverableShortfall: number;
  timelineExtensionMonths: number;
}

export function computeSuggestions(input: SuggestionInput): SuggestionResult {
  const {
    shortfall,
    buckets,
    confirmedMonthlyIncome,
    goalMonthlyContribution = 0,
    projectedSurplus = 0,
    monthsLeft = 0,
  } = input;

  // Eligible: non-goal buckets with slack above their floor
  const eligible = buckets
    .filter(b => !b.isGoal && b.monthlyFloor < b.monthlyLimit)
    .map(b => ({
      ...b,
      slack: b.monthlyLimit - b.monthlyFloor,
    }))
    // Sort: unranked (null) first sorted by slack DESC, then ranked by rank DESC (higher rank number = lower priority = cut first)
    .sort((a, b) => {
      const aRanked = a.priorityRank !== null;
      const bRanked = b.priorityRank !== null;
      if (!aRanked && !bRanked) return b.slack - a.slack; // both unranked: most slack first
      if (!aRanked) return -1; // a unranked, b ranked: a comes first (cut unranked first)
      if (!bRanked) return 1;
      // Both ranked: higher rank number = lower priority = cut first
      return b.priorityRank! - a.priorityRank!;
    });

  const cuts: BudgetCut[] = [];
  let remaining = shortfall;
  let coverableShortfall = 0;

  for (const bucket of eligible) {
    if (remaining <= 0) break;
    const cut = Math.min(bucket.slack, remaining);
    if (cut <= 0) continue;

    const cutPct = confirmedMonthlyIncome > 0 ? (cut / confirmedMonthlyIncome) * 100 : 0;
    const reason = bucket.priorityRank !== null
      ? `ranked #${bucket.priorityRank} — lower priority`
      : `$${Math.round(bucket.slack)} headroom above floor`;

    cuts.push({
      bucketId: bucket.id,
      bucketName: bucket.name,
      currentPct: bucket.targetPct,
      suggestedPct: Math.max(0, bucket.targetPct - cutPct),
      cutAmount: cut,
      reason,
    });

    remaining -= cut;
    coverableShortfall += cut;
  }

  // Timeline extension: how many extra months needed if we keep current surplus
  let timelineExtensionMonths = 0;
  if (goalMonthlyContribution > 0 && projectedSurplus >= 0 && monthsLeft > 0) {
    const affordable = Math.max(0, projectedSurplus);
    if (affordable < goalMonthlyContribution && affordable > 0) {
      const amountStillNeeded = goalMonthlyContribution * monthsLeft - affordable * monthsLeft;
      timelineExtensionMonths = Math.ceil(amountStillNeeded / affordable);
    } else if (affordable === 0) {
      timelineExtensionMonths = monthsLeft;
    }
  }

  return { cuts, coverableShortfall, timelineExtensionMonths };
}
