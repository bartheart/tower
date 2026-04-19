import { computeSuggestions, SuggestionBucket } from '../suggestionEngine';

const buckets: SuggestionBucket[] = [
  { id: 'b1', name: 'Dining',        targetPct: 12, monthlyFloor: 0,   priorityRank: null, monthlyLimit: 600,  isGoal: false },
  { id: 'b2', name: 'Entertainment', targetPct: 8,  monthlyFloor: 0,   priorityRank: null, monthlyLimit: 400,  isGoal: false },
  { id: 'b3', name: 'Rent',          targetPct: 30, monthlyFloor: 1500, priorityRank: 1,   monthlyLimit: 1500, isGoal: false },
  { id: 'b4', name: 'Groceries',     targetPct: 10, monthlyFloor: 400,  priorityRank: 2,   monthlyLimit: 500,  isGoal: false },
  { id: 'b5', name: 'Goal bucket',   targetPct: 10, monthlyFloor: 0,   priorityRank: null, monthlyLimit: 500,  isGoal: true  },
];

const income = 5000;

test('excludes goal buckets from suggestions', () => {
  const result = computeSuggestions({ shortfall: 200, buckets, confirmedMonthlyIncome: income });
  expect(result.cuts.find(c => c.bucketId === 'b5')).toBeUndefined();
});

test('excludes buckets with no slack above floor', () => {
  const result = computeSuggestions({ shortfall: 200, buckets, confirmedMonthlyIncome: income });
  // Rent: monthlyLimit=1500, floor=1500 → no slack
  expect(result.cuts.find(c => c.bucketId === 'b3')).toBeUndefined();
});

test('cuts unranked buckets before ranked ones', () => {
  const result = computeSuggestions({ shortfall: 200, buckets, confirmedMonthlyIncome: income });
  const ids = result.cuts.map(c => c.bucketId);
  // b1 and b2 are unranked (null) so they come before b4 (rank 2)
  const unrankedIdx = Math.max(ids.indexOf('b1'), ids.indexOf('b2'));
  const rankedIdx = ids.indexOf('b4');
  if (rankedIdx !== -1) expect(unrankedIdx).toBeLessThan(rankedIdx);
});

test('cuts most slack first among unranked buckets', () => {
  const result = computeSuggestions({ shortfall: 100, buckets, confirmedMonthlyIncome: income });
  // b1 slack = 600, b2 slack = 400 → b1 comes first
  const ids = result.cuts.map(c => c.bucketId);
  if (ids.includes('b1') && ids.includes('b2')) {
    expect(ids.indexOf('b1')).toBeLessThan(ids.indexOf('b2'));
  }
});

test('sum of cuts >= shortfall when enough slack exists', () => {
  const result = computeSuggestions({ shortfall: 300, buckets, confirmedMonthlyIncome: income });
  const totalCut = result.cuts.reduce((s, c) => s + c.cutAmount, 0);
  expect(totalCut).toBeGreaterThanOrEqual(300);
});

test('reason label says "ranked #N" for ranked buckets', () => {
  // Force a large shortfall so we reach b4 (rank 2)
  const result = computeSuggestions({ shortfall: 1200, buckets, confirmedMonthlyIncome: income });
  const b4cut = result.cuts.find(c => c.bucketId === 'b4');
  if (b4cut) expect(b4cut.reason).toMatch(/ranked #2/);
});

test('reason label says headroom for unranked buckets', () => {
  const result = computeSuggestions({ shortfall: 100, buckets, confirmedMonthlyIncome: income });
  const b1cut = result.cuts.find(c => c.bucketId === 'b1');
  expect(b1cut?.reason).toMatch(/headroom above floor/);
});

test('computes timelineExtensionMonths > 0 when shortfall exists', () => {
  const result = computeSuggestions({
    shortfall: 300,
    buckets,
    confirmedMonthlyIncome: income,
    goalMonthlyContribution: 500,
    projectedSurplus: 200,
    monthsLeft: 12,
  });
  expect(result.timelineExtensionMonths).toBeGreaterThan(0);
});
