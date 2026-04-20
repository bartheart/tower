import { computeRedistribution } from '../redistributeOnDelete';

test('distributes freed pct by priority rank — rank 1 gets more than rank 2', () => {
  // weight_a = 1/1 = 1.0, weight_b = 1/2 = 0.5, total = 1.5
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, priorityRank: 1 },
    { id: 'b', targetPct: 15, priorityRank: 2 },
  ], 10);
  const a = result.find(r => r.id === 'a')!;
  const b = result.find(r => r.id === 'b')!;
  expect(a.newPct).toBeCloseTo(20 + 10 * (1 / 1.5), 1);
  expect(b.newPct).toBeCloseTo(15 + 10 * (0.5 / 1.5), 1);
});

test('single ranked candidate gets all of freed pct', () => {
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, priorityRank: 1 },
  ], 10);
  expect(result).toHaveLength(1);
  expect(result[0].newPct).toBeCloseTo(30, 1);
});

test('unranked candidates are excluded when ranked candidates exist', () => {
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, priorityRank: 1 },
    { id: 'b', targetPct: 15, priorityRank: null },
  ], 10);
  expect(result.find(r => r.id === 'b')).toBeUndefined();
  const a = result.find(r => r.id === 'a')!;
  expect(a.newPct).toBeCloseTo(30, 1);
});

test('all unranked: distributes proportionally to existing targetPct', () => {
  // a has 20%, b has 10% — total 30%; a gets 2/3 of freed, b gets 1/3
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, priorityRank: null },
    { id: 'b', targetPct: 10, priorityRank: null },
  ], 9);
  const a = result.find(r => r.id === 'a')!;
  const b = result.find(r => r.id === 'b')!;
  expect(a.newPct).toBeCloseTo(20 + 9 * (20 / 30), 1);
  expect(b.newPct).toBeCloseTo(10 + 9 * (10 / 30), 1);
});

test('all unranked with all zero targetPct returns empty', () => {
  const result = computeRedistribution([
    { id: 'a', targetPct: 0, priorityRank: null },
    { id: 'b', targetPct: 0, priorityRank: null },
  ], 10);
  expect(result).toEqual([]);
});

test('returns empty when freedPct is 0', () => {
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, priorityRank: 1 },
  ], 0);
  expect(result).toEqual([]);
});

test('returns empty when freedPct is negative', () => {
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, priorityRank: 1 },
  ], -5);
  expect(result).toEqual([]);
});

test('returns empty when candidates array is empty', () => {
  expect(computeRedistribution([], 10)).toEqual([]);
});

test('equal ranks share freed pct equally', () => {
  const result = computeRedistribution([
    { id: 'a', targetPct: 20, priorityRank: 1 },
    { id: 'b', targetPct: 15, priorityRank: 1 },
  ], 10);
  const a = result.find(r => r.id === 'a')!;
  const b = result.find(r => r.id === 'b')!;
  expect(a.newPct).toBeCloseTo(25, 1);
  expect(b.newPct).toBeCloseTo(20, 1);
});
