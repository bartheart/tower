import { computeRedistribution } from '../redistributeOnDelete';

test('distributes freed pct weighted by priority × ceiling', () => {
  // weight_a = (1/1) * (400/500) = 0.8
  // weight_b = (1/2) * (100/500) = 0.1
  // total = 0.9 → a gets 0.8/0.9, b gets 0.1/0.9
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, monthlyLimit: 500, spent: 400, priorityRank: 1 },
    { id: 'b', targetPct: 15, monthlyLimit: 500, spent: 100, priorityRank: 2 },
  ], 10);
  const a = result.find(r => r.id === 'a')!;
  const b = result.find(r => r.id === 'b')!;
  expect(a.newPct).toBeCloseTo(20 + 10 * (0.8 / 0.9), 1);
  expect(b.newPct).toBeCloseTo(15 + 10 * (0.1 / 0.9), 1);
});

test('falls back to priority-only when all spent = 0', () => {
  // a weight=1/1=1.0, b weight=1/2=0.5, total=1.5
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, monthlyLimit: 500, spent: 0, priorityRank: 1 },
    { id: 'b', targetPct: 15, monthlyLimit: 500, spent: 0, priorityRank: 2 },
  ], 10);
  const a = result.find(r => r.id === 'a')!;
  const b = result.find(r => r.id === 'b')!;
  expect(a.newPct).toBeCloseTo(20 + 10 * (1 / 1.5), 1);
  expect(b.newPct).toBeCloseTo(15 + 10 * (0.5 / 1.5), 1);
});

test('returns empty when all candidates are unranked (freed stays unallocated)', () => {
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, monthlyLimit: 500, spent: 400, priorityRank: null },
    { id: 'b', targetPct: 15, monthlyLimit: 500, spent: 100, priorityRank: null },
  ], 10);
  expect(result).toEqual([]);
});

test('unranked candidates are excluded from distribution', () => {
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, monthlyLimit: 500, spent: 400, priorityRank: 1 },
    { id: 'b', targetPct: 15, monthlyLimit: 500, spent: 100, priorityRank: null },
  ], 10);
  expect(result.find(r => r.id === 'b')).toBeUndefined();
  expect(result.find(r => r.id === 'a')).toBeDefined();
});

test('returns empty when freedPct is 0', () => {
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, monthlyLimit: 500, spent: 400, priorityRank: 1 },
  ], 0);
  expect(result).toEqual([]);
});

test('clamps ceilingScore at 1 when spent > monthlyLimit', () => {
  // spent(600) > limit(500) → ceilingScore clamped to 1
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, monthlyLimit: 500, spent: 600, priorityRank: 1 },
    { id: 'b', targetPct: 15, monthlyLimit: 500, spent: 400, priorityRank: 1 },
  ], 10);
  // weight_a = 1*1=1, weight_b = 1*0.8=0.8, total=1.8
  const a = result.find(r => r.id === 'a')!;
  const b = result.find(r => r.id === 'b')!;
  expect(a.newPct).toBeCloseTo(20 + 10 * (1 / 1.8), 1);
  expect(b.newPct).toBeCloseTo(15 + 10 * (0.8 / 1.8), 1);
});
