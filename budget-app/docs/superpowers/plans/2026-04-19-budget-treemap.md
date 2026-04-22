# Budget Treemap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a squarified treemap above the bucket list in the Buckets tab so users can see allocation at a glance and tap a tile to scroll to that bucket.

**Architecture:** A pure-JS squarify algorithm in `budget/squarify.ts` computes pixel rects from `targetPct` values. `BudgetTreemap.tsx` renders absolute-positioned tiles using those rects. `PlanScreen.tsx` wires up scroll-to and highlight on tile tap.

**Tech Stack:** React Native (Expo bare), TypeScript, Jest + jest-expo for tests, `@testing-library/react-native` for component tests.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `mobile/src/budget/squarify.ts` | Create | Pure squarify algorithm — no React, fully unit-testable |
| `mobile/src/budget/__tests__/squarify.test.ts` | Create | Algorithm correctness tests |
| `mobile/src/components/BudgetTreemap.tsx` | Create | React Native treemap component |
| `mobile/src/components/__tests__/BudgetTreemap.test.tsx` | Create | Render smoke tests |
| `mobile/src/screens/PlanScreen.tsx` | Modify | Add scrollRef, pass to BucketsTab, render treemap |

---

## Task 1: Squarify Algorithm

**Files:**
- Create: `mobile/src/budget/squarify.ts`
- Create: `mobile/src/budget/__tests__/squarify.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `mobile/src/budget/__tests__/squarify.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd mobile && npx jest src/budget/__tests__/squarify.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../squarify'`

- [ ] **Step 3: Implement squarify.ts**

Create `mobile/src/budget/squarify.ts`:

```typescript
export interface SquarifyInput {
  id: string;
  value: number; // e.g. targetPct (any positive unit)
}

export interface TileRect {
  id: string;
  x: number; // pixels from container left
  y: number; // pixels from container top
  w: number; // pixels
  h: number; // pixels
}

interface Rect { x: number; y: number; w: number; h: number }
interface ScaledItem { id: string; area: number }

/** Worst aspect ratio of tiles in a row laid along a strip of given sideLen. */
function worstRatio(row: number[], sideLen: number): number {
  if (row.length === 0 || sideLen === 0) return Infinity;
  const s = row.reduce((a, b) => a + b, 0);
  if (s === 0) return Infinity;
  const max = Math.max(...row);
  const min = Math.min(...row);
  const s2 = s * s;
  const side2 = sideLen * sideLen;
  return Math.max((side2 * max) / s2, s2 / (side2 * min));
}

/** Place one row of items into rect, push TileRects into result. */
function placeRow(items: ScaledItem[], rect: Rect, result: TileRect[]): void {
  const isHoriz = rect.w >= rect.h;
  const rowSum = items.reduce((s, i) => s + i.area, 0);

  if (isHoriz) {
    // Horizontal strip at top of rect
    const stripH = rect.w > 0 ? rowSum / rect.w : 0;
    let cx = rect.x;
    for (const item of items) {
      const tileW = stripH > 0 ? item.area / stripH : 0;
      result.push({ id: item.id, x: cx, y: rect.y, w: tileW, h: stripH });
      cx += tileW;
    }
  } else {
    // Vertical strip at left of rect
    const stripW = rect.h > 0 ? rowSum / rect.h : 0;
    let cy = rect.y;
    for (const item of items) {
      const tileH = stripW > 0 ? item.area / stripW : 0;
      result.push({ id: item.id, x: rect.x, y: cy, w: stripW, h: tileH });
      cy += tileH;
    }
  }
}

/** Remaining rect after removing a placed row. */
function remainingRect(row: ScaledItem[], rect: Rect): Rect {
  const rowSum = row.reduce((s, i) => s + i.area, 0);
  if (rect.w >= rect.h) {
    const stripH = rect.w > 0 ? rowSum / rect.w : 0;
    return { x: rect.x, y: rect.y + stripH, w: rect.w, h: rect.h - stripH };
  } else {
    const stripW = rect.h > 0 ? rowSum / rect.h : 0;
    return { x: rect.x + stripW, y: rect.y, w: rect.w - stripW, h: rect.h };
  }
}

function layout(items: ScaledItem[], rect: Rect, result: TileRect[]): void {
  if (items.length === 0) return;
  if (items.length === 1) {
    result.push({ id: items[0].id, x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    return;
  }

  const sideLen = Math.min(rect.w, rect.h);

  // Build row greedily: keep adding items while worst ratio improves
  let row = [items[0]];
  for (let i = 1; i < items.length; i++) {
    const candidate = [...row, items[i]];
    if (
      worstRatio(candidate.map(x => x.area), sideLen) <=
      worstRatio(row.map(x => x.area), sideLen)
    ) {
      row = candidate;
    } else {
      break;
    }
  }

  placeRow(row, rect, result);
  layout(items.slice(row.length), remainingRect(row, rect), result);
}

/**
 * Compute squarified treemap layout.
 * Items are sorted descending by value internally; the returned rects preserve
 * each item's id so callers don't need to worry about sort order.
 */
export function computeLayout(
  items: SquarifyInput[],
  containerW: number,
  containerH: number,
): TileRect[] {
  if (items.length === 0 || containerW <= 0 || containerH <= 0) return [];

  const totalValue = items.reduce((s, i) => s + i.value, 0);
  if (totalValue === 0) return [];

  const containerArea = containerW * containerH;
  const scaled: ScaledItem[] = items
    .map(item => ({ id: item.id, area: (item.value / totalValue) * containerArea }))
    .sort((a, b) => b.area - a.area);

  const result: TileRect[] = [];
  layout(scaled, { x: 0, y: 0, w: containerW, h: containerH }, result);
  return result;
}
```

- [ ] **Step 4: Run tests — expect all to pass**

```bash
cd mobile && npx jest src/budget/__tests__/squarify.test.ts --no-coverage
```

Expected: PASS — 7 tests pass

- [ ] **Step 5: Commit**

```bash
git add mobile/src/budget/squarify.ts mobile/src/budget/__tests__/squarify.test.ts
git commit -m "feat: add squarify algorithm for treemap layout"
```

---

## Task 2: BudgetTreemap Component

**Context:** `BudgetCategory` is defined in `mobile/src/hooks/useBudgets.ts`. It has fields: `id: string`, `name: string`, `targetPct: number | null`, `color: string` (hex, e.g. `#6366f1`). The `computeLayout` function is from Task 1.

**Files:**
- Create: `mobile/src/components/BudgetTreemap.tsx`
- Create: `mobile/src/components/__tests__/BudgetTreemap.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `mobile/src/components/__tests__/BudgetTreemap.test.tsx`:

```typescript
import React from 'react';
import { render } from '@testing-library/react-native';
import { BudgetTreemap } from '../BudgetTreemap';

const mockBuckets = [
  { id: '1', name: 'Housing', targetPct: 32, color: '#6366f1' },
  { id: '2', name: 'Food', targetPct: 24, color: '#22c55e' },
  { id: '3', name: 'Transport', targetPct: 15, color: '#f59e0b' },
];

describe('BudgetTreemap', () => {
  it('renders without crashing', () => {
    const { getByTestId } = render(
      <BudgetTreemap
        buckets={mockBuckets}
        selectedId={null}
        onTilePress={jest.fn()}
      />,
    );
    expect(getByTestId('budget-treemap')).toBeTruthy();
  });

  it('renders a tile for each bucket', () => {
    const { getAllByTestId } = render(
      <BudgetTreemap
        buckets={mockBuckets}
        selectedId={null}
        onTilePress={jest.fn()}
      />,
    );
    // One tile per bucket + 1 unallocated tile (100 - 71 = 29%)
    expect(getAllByTestId('treemap-tile')).toHaveLength(4);
  });

  it('renders no unallocated tile when fully allocated', () => {
    const fullBuckets = [
      { id: '1', name: 'A', targetPct: 60, color: '#6366f1' },
      { id: '2', name: 'B', targetPct: 40, color: '#22c55e' },
    ];
    const { getAllByTestId } = render(
      <BudgetTreemap
        buckets={fullBuckets}
        selectedId={null}
        onTilePress={jest.fn()}
      />,
    );
    expect(getAllByTestId('treemap-tile')).toHaveLength(2);
  });

  it('calls onTilePress with bucket id when tile is pressed', () => {
    const onPress = jest.fn();
    const { getAllByTestId } = render(
      <BudgetTreemap
        buckets={mockBuckets}
        selectedId={null}
        onTilePress={onPress}
      />,
    );
    const tiles = getAllByTestId('treemap-tile');
    tiles[0].props.onPress();
    expect(onPress).toHaveBeenCalledWith(expect.any(String));
  });

  it('shows placeholder tile when all targetPcts are null/0', () => {
    const emptyBuckets = [
      { id: '1', name: 'Housing', targetPct: null, color: '#6366f1' },
    ];
    const { getByTestId } = render(
      <BudgetTreemap
        buckets={emptyBuckets}
        selectedId={null}
        onTilePress={jest.fn()}
      />,
    );
    expect(getByTestId('treemap-placeholder')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd mobile && npx jest src/components/__tests__/BudgetTreemap.test.tsx --no-coverage
```

Expected: FAIL — `Cannot find module '../BudgetTreemap'`

- [ ] **Step 3: Implement BudgetTreemap.tsx**

Create `mobile/src/components/BudgetTreemap.tsx`:

```typescript
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { computeLayout } from '../budget/squarify';

interface Bucket {
  id: string;
  name: string;
  targetPct: number | null;
  color: string; // hex e.g. '#6366f1'
}

interface BudgetTreemapProps {
  buckets: Bucket[];
  selectedId: string | null;
  onTilePress: (id: string | null) => void;
  height?: number;
}

/** Convert #rrggbb to rgba(r,g,b,alpha) string. Falls back to a neutral color. */
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return `rgba(100,100,100,${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const UNALLOCATED_ID = '__unallocated__';
const CONTAINER_W = 390; // layout computed at a fixed logical width; tiles use % of measured width

export function BudgetTreemap({
  buckets,
  selectedId,
  onTilePress,
  height = 175,
}: BudgetTreemapProps) {
  const [containerWidth, setContainerWidth] = useState(CONTAINER_W);

  const totalAllocated = buckets.reduce((s, b) => s + (b.targetPct ?? 0), 0);
  const unallocated = Math.max(0, 100 - totalAllocated);

  // Build items for squarify
  const squarifyItems: Array<{ id: string; value: number }> = buckets
    .filter(b => (b.targetPct ?? 0) > 0)
    .map(b => ({ id: b.id, value: b.targetPct! }));

  if (unallocated > 0) {
    squarifyItems.push({ id: UNALLOCATED_ID, value: unallocated });
  }

  // All-zero case: show placeholder
  if (squarifyItems.length === 0) {
    return (
      <View
        testID="budget-treemap"
        style={[styles.container, { height }]}
      >
        <View testID="treemap-placeholder" style={styles.placeholder}>
          <Text style={styles.placeholderText}>No allocations yet</Text>
        </View>
      </View>
    );
  }

  const rects = computeLayout(squarifyItems, containerWidth, height);

  // Build a quick lookup: id → bucket color
  const colorMap = new Map(buckets.map(b => [b.id, b.color]));

  return (
    <View
      testID="budget-treemap"
      style={[styles.container, { height }]}
      onLayout={e => setContainerWidth(e.nativeEvent.layout.width)}
    >
      {rects.map(rect => {
        const isUnalloc = rect.id === UNALLOCATED_ID;
        const isSelected = rect.id === selectedId;
        const bucket = buckets.find(b => b.id === rect.id);
        const color = colorMap.get(rect.id) ?? '#6366f1';
        const bgColor = isUnalloc
          ? 'rgba(30,41,59,0.6)'
          : hexToRgba(color, 0.5);

        // Only show label text if tile is wide and tall enough to be readable
        const showName = rect.w >= 40 && rect.h >= 30;
        const showPct = rect.h >= 20;
        const pct = isUnalloc
          ? unallocated
          : bucket?.targetPct ?? 0;

        return (
          <TouchableOpacity
            key={rect.id}
            testID="treemap-tile"
            activeOpacity={0.75}
            onPress={() => onTilePress(isUnalloc ? null : rect.id)}
            style={[
              styles.tile,
              {
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
                backgroundColor: bgColor,
              },
              isUnalloc && styles.unallocTile,
              isSelected && styles.selectedTile,
            ]}
          >
            {showName && !isUnalloc && (
              <Text style={styles.tileName} numberOfLines={1}>
                {bucket?.name ?? ''}
              </Text>
            )}
            {showName && isUnalloc && (
              <Text style={[styles.tileName, styles.unallocName]} numberOfLines={1}>
                Free
              </Text>
            )}
            {showPct && (
              <Text
                style={[styles.tilePct, isUnalloc && styles.unallocPct]}
                numberOfLines={1}
              >
                {pct > 0 ? `${Math.round(pct)}%` : ''}
              </Text>
            )}
            {/* Inner shadow overlay */}
            <View style={styles.innerShadow} pointerEvents="none" />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    position: 'relative',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
    backgroundColor: '#1e293b',
  },
  tile: {
    position: 'absolute',
    justifyContent: 'flex-end',
    padding: 8,
  },
  unallocTile: {
    borderWidth: 1.5,
    borderColor: '#334155',
    borderStyle: 'dashed',
  },
  selectedTile: {
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    borderStyle: 'solid',
  },
  tileName: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.9)',
    lineHeight: 13,
  },
  tilePct: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 13,
  },
  unallocName: {
    color: '#475569',
  },
  unallocPct: {
    color: '#334155',
  },
  innerShadow: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.15)',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: 12,
    color: '#475569',
  },
});
```

- [ ] **Step 4: Run tests — expect all to pass**

```bash
cd mobile && npx jest src/components/__tests__/BudgetTreemap.test.tsx --no-coverage
```

Expected: PASS — 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/BudgetTreemap.tsx mobile/src/components/__tests__/BudgetTreemap.test.tsx
git commit -m "feat: add BudgetTreemap component with squarify layout"
```

---

## Task 3: PlanScreen Integration

**Context:** `PlanScreen.tsx` lives at `mobile/src/screens/PlanScreen.tsx`. Key areas:
- Line 1: imports — `useRef` is already imported
- Line 1222: outer `ScrollView` — needs a `ref`
- Line 755: `BucketsTab` function signature — needs `scrollRef` prop added
- Line 777: `BucketsTab` return — needs treemap rendered at top
- Line 793: `isHighlighted` — needs to include `selectedTreemapId`
- Line 796–814: each bucket card `TouchableOpacity` — needs `onLayout` to cache Y offset
- Line 1246: `<BucketsTab ...>` in PlanScreen render — needs `scrollRef` passed

**Files:**
- Modify: `mobile/src/screens/PlanScreen.tsx`

There are no new unit tests for this task (the integration is manual/visual). Run the existing test suite to confirm nothing is broken.

- [ ] **Step 1: Add scrollRef to outer ScrollView in PlanScreen**

In `PlanScreen.tsx`, find the `return (` of the main `PlanScreen` component (around line 1220). Add a ref declaration near the top of the function body (find the block of `const` declarations there and add after them):

```typescript
const scrollRef = useRef<ScrollView>(null);
```

Then on the `<ScrollView` at line 1222, add the ref:

```tsx
<ScrollView
  ref={scrollRef}
  style={s.container}
  contentContainerStyle={[s.content, { paddingTop: top + 16 }]}
  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#6366f1" />}
>
```

- [ ] **Step 2: Pass scrollRef to BucketsTab**

In the `<BucketsTab ...>` JSX (around line 1246), add the `scrollRef` prop:

```tsx
{planningTab === 'buckets' && (
  <BucketsTab
    budgets={budgets}
    transactions={transactions}
    confirmedMonthlyIncome={confirmedMonthlyIncome}
    onReload={handleReload}
    highlightId={route.params?.highlightId}
    scrollRef={scrollRef}
  />
)}
```

- [ ] **Step 3: Update BucketsTab signature and add state/refs**

Find the `BucketsTab` function signature at line 755. Replace it with:

```typescript
function BucketsTab({ budgets, transactions, confirmedMonthlyIncome, onReload, highlightId, scrollRef }: {
  budgets: ReturnType<typeof useBudgets>['budgets'];
  transactions: Transaction[];
  confirmedMonthlyIncome: number;
  onReload: (savedBudgetId?: string) => void;
  highlightId?: string;
  scrollRef: React.RefObject<ScrollView>;
}) {
```

Inside the function body, after the existing `const [detailBudget, ...]` line, add:

```typescript
const [selectedTreemapId, setSelectedTreemapId] = useState<string | null>(null);
const bucketYOffsets = useRef<Record<string, number>>({});
const tabYOffset = useRef<number>(0);
```

- [ ] **Step 4: Add onLayout to BucketsTab root View and each bucket card**

Find the BucketsTab `return (` at line 777. Add `onLayout` to the root `<View>`:

```tsx
return (
  <View onLayout={e => { tabYOffset.current = e.nativeEvent.layout.y; }}>
```

Find the bucket card `<TouchableOpacity` (around line 796). Add `onLayout` to it:

```tsx
<TouchableOpacity
  key={b.id}
  style={[s.bucketCard, isHighlighted && s.bucketCardHighlighted]}
  onPress={() => setDetailBudget(b)}
  activeOpacity={0.75}
  onLayout={e => { bucketYOffsets.current[b.id] = e.nativeEvent.layout.y; }}
>
```

- [ ] **Step 5: Update isHighlighted to include selectedTreemapId**

Find this line (around 793):

```typescript
const isHighlighted = b.id === highlightId;
```

Replace it with:

```typescript
const isHighlighted = b.id === highlightId || b.id === selectedTreemapId;
```

- [ ] **Step 6: Add the tile press handler and render BudgetTreemap**

Add the `handleTilePress` function inside `BucketsTab`, after the `tabYOffset` ref declaration:

```typescript
const handleTilePress = (id: string | null) => {
  setSelectedTreemapId(id);
  if (id && bucketYOffsets.current[id] != null) {
    scrollRef.current?.scrollTo({
      y: tabYOffset.current + bucketYOffsets.current[id],
      animated: true,
    });
  }
};
```

Add the import for `BudgetTreemap` at the top of the file (after existing imports):

```typescript
import { BudgetTreemap } from '../components/BudgetTreemap';
```

Render the treemap as the first child inside the BucketsTab root View, before the `{pendingReview.length > 0 && ...}` block:

```tsx
return (
  <View onLayout={e => { tabYOffset.current = e.nativeEvent.layout.y; }}>
    <BudgetTreemap
      buckets={budgets}
      selectedId={selectedTreemapId}
      onTilePress={handleTilePress}
    />

    {pendingReview.length > 0 && (
      // ... existing pendingReview banner
```

- [ ] **Step 7: Run full test suite to confirm nothing is broken**

```bash
cd mobile && npx jest --no-coverage
```

Expected: all previously-passing tests still pass, plus the 7 squarify tests and 5 BudgetTreemap tests.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/screens/PlanScreen.tsx
git commit -m "feat: integrate BudgetTreemap into BucketsTab with scroll-to on tile tap"
```
