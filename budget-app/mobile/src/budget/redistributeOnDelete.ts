export interface RedistributionCandidate {
  id: string;
  targetPct: number;
  priorityRank: number | null;
}

export interface RedistributionResult {
  id: string;
  newPct: number;
}

/**
 * Distributes freedPct among candidates weighted by priority rank.
 *
 * Weight formula: weight = 1 / priorityRank  (rank 1 = highest priority)
 * Candidates with null rank are excluded when any ranked candidate exists.
 *
 * Fallback when ALL candidates are unranked: distribute proportionally to
 * existing targetPct so freed budget is never silently dropped.
 * If all targetPct values are also 0: return [] (nothing to weight against).
 *
 * Note: spend ratio (ceilingScore) was intentionally removed — high spend
 * does not imply a bucket should receive more budget during redistribution.
 * See issue #44 for spend-based recommendations (separate feature).
 */
export function computeRedistribution(
  candidates: RedistributionCandidate[],
  freedPct: number,
): RedistributionResult[] {
  if (freedPct <= 0 || candidates.length === 0) return [];

  const withWeights = candidates.map(c => ({
    c,
    weight: c.priorityRank != null && c.priorityRank > 0 ? 1 / c.priorityRank : 0,
  }));

  const totalWeight = withWeights.reduce((s, x) => s + x.weight, 0);

  if (totalWeight === 0) {
    // All unranked — distribute proportionally to existing targetPct
    const totalPct = candidates.reduce((s, c) => s + c.targetPct, 0);
    if (totalPct === 0) return [];
    return candidates.map(c => ({
      id: c.id,
      newPct: Math.round((c.targetPct + freedPct * (c.targetPct / totalPct)) * 100) / 100,
    }));
  }

  return withWeights
    .filter(x => x.weight > 0)
    .map(x => ({
      id: x.c.id,
      newPct: Math.round((x.c.targetPct + freedPct * (x.weight / totalWeight)) * 100) / 100,
    }));
}
