export interface RedistributionCandidate {
  id: string;
  targetPct: number;
  monthlyLimit: number;
  spent: number;
  priorityRank: number | null;
}

export interface RedistributionResult {
  id: string;
  newPct: number;
}

/**
 * Distributes freedPct among candidates weighted by priority rank × ceiling proximity.
 *
 * Weight formula per candidate:
 *   priorityScore = 1 / rank  (null rank → excluded, receives nothing)
 *   ceilingScore  = clamp(spent / monthlyLimit, 0, 1)
 *   weight        = priorityScore × ceilingScore
 *
 * Fallback when all weights = 0 (no spend data): use priority-only.
 * If still all zero (all unranked): return [] — freed % stays unallocated.
 */
export function computeRedistribution(
  candidates: RedistributionCandidate[],
  freedPct: number,
): RedistributionResult[] {
  if (freedPct <= 0 || candidates.length === 0) return [];

  const withWeights = candidates.map(c => {
    const priorityScore = c.priorityRank != null ? 1 / c.priorityRank : 0;
    const ceilingScore = c.monthlyLimit > 0 ? Math.min(1, c.spent / c.monthlyLimit) : 0;
    return { c, weight: priorityScore * ceilingScore };
  });

  let totalWeight = withWeights.reduce((s, x) => s + x.weight, 0);

  // Fallback: no spend data yet — use priority-only
  if (totalWeight === 0) {
    const priorityOnly = candidates.map(c => ({
      c,
      weight: c.priorityRank != null ? 1 / c.priorityRank : 0,
    }));
    totalWeight = priorityOnly.reduce((s, x) => s + x.weight, 0);
    // All unranked — leave freed % as unallocated
    if (totalWeight === 0) return [];
    return priorityOnly
      .filter(x => x.weight > 0)
      .map(x => ({
        id: x.c.id,
        newPct: Math.round((x.c.targetPct + freedPct * (x.weight / totalWeight)) * 100) / 100,
      }));
  }

  return withWeights
    .filter(x => x.weight > 0)
    .map(x => ({
      id: x.c.id,
      newPct: Math.round((x.c.targetPct + freedPct * (x.weight / totalWeight)) * 100) / 100,
    }));
}
