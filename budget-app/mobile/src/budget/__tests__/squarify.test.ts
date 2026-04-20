import { computeLayout, type SquarifyInput, type TileRect } from '../squarify';

function totalArea(rects: TileRect[]): number {
  return rects.reduce((s, r) => s + r.w * r.h, 0);
}

describe('computeLayout', () => {
  it('returns empty array for empty input', () => {
    expect(computeLayout([], 400, 175)).toEqual([]);
  });

  it('returns empty array when all values are zero', () => {
    const items: SquarifyInput[] = [
      { id: 'a', value: 0 },
      { id: 'b', value: 0 },
    ];
    expect(computeLayout(items, 400, 175)).toEqual([]);
  });

  it('single item fills the entire container', () => {
    const items: SquarifyInput[] = [{ id: 'only', value: 50 }];
    const [rect] = computeLayout(items, 400, 175);
    expect(rect.id).toBe('only');
    expect(rect.x).toBeCloseTo(0);
    expect(rect.y).toBeCloseTo(0);
    expect(rect.w).toBeCloseTo(400);
    expect(rect.h).toBeCloseTo(175);
  });

  it('two equal items each occupy half the container area', () => {
    const items: SquarifyInput[] = [
      { id: 'a', value: 50 },
      { id: 'b', value: 50 },
    ];
    const rects = computeLayout(items, 400, 175);
    expect(rects).toHaveLength(2);
    const areaA = rects.find(r => r.id === 'a')!.w * rects.find(r => r.id === 'a')!.h;
    const areaB = rects.find(r => r.id === 'b')!.w * rects.find(r => r.id === 'b')!.h;
    expect(areaA).toBeCloseTo(areaB, 0);
  });

  it('total tile area equals container area', () => {
    const items: SquarifyInput[] = [
      { id: 'housing', value: 32 },
      { id: 'food', value: 24 },
      { id: 'transport', value: 15.5 },
      { id: 'entertainment', value: 7.5 },
      { id: 'unallocated', value: 21 },
    ];
    const rects = computeLayout(items, 390, 175);
    expect(totalArea(rects)).toBeCloseTo(390 * 175, 0);
  });

  it('all rects stay within container bounds', () => {
    const items: SquarifyInput[] = [
      { id: 'a', value: 32 },
      { id: 'b', value: 24 },
      { id: 'c', value: 15.5 },
      { id: 'd', value: 7.5 },
      { id: 'e', value: 21 },
    ];
    const rects = computeLayout(items, 390, 175);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-0.5);
      expect(r.y).toBeGreaterThanOrEqual(-0.5);
      expect(r.x + r.w).toBeLessThanOrEqual(390 + 0.5);
      expect(r.y + r.h).toBeLessThanOrEqual(175 + 0.5);
    }
  });

  it('larger value gets larger area', () => {
    const items: SquarifyInput[] = [
      { id: 'big', value: 70 },
      { id: 'small', value: 30 },
    ];
    const rects = computeLayout(items, 400, 175);
    const big = rects.find(r => r.id === 'big')!;
    const small = rects.find(r => r.id === 'small')!;
    expect(big.w * big.h).toBeGreaterThan(small.w * small.h);
  });

  it('returns a rect for every input item', () => {
    const items: SquarifyInput[] = [
      { id: 'a', value: 40 },
      { id: 'b', value: 30 },
      { id: 'c', value: 20 },
      { id: 'd', value: 10 },
    ];
    const rects = computeLayout(items, 400, 175);
    expect(rects).toHaveLength(4);
    const ids = rects.map(r => r.id).sort();
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });
});
