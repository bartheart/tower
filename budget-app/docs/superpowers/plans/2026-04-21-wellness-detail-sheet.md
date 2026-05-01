# Wellness Detail Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping the Wellness Score tile opens a bottom sheet showing a 7-day sparkline and a per-category factor list explaining what is helping or hurting the score.

**Architecture:** `computeScoreBreakdown()` (pure function) is added to `useWellnessScore.ts` and its output attached to `WellnessResult.factors`. A new `WellnessDetailSheet` component renders the sheet. `HomeScreen` wraps `ScoreTile` in a `TouchableOpacity` and controls sheet visibility with a boolean state.

**Tech Stack:** React Native, TypeScript, `react-native-svg` (already installed — used by existing `Sparkline`), WatermelonDB (transactions already loaded in HomeScreen).

---

## File Map

| File | Change |
|------|--------|
| `mobile/src/hooks/useWellnessScore.ts` | Add `ScoreFactor` interface, `computeScoreBreakdown()`, extend `WellnessResult` with `factors`, call from `useWellnessScore` |
| `mobile/src/hooks/__tests__/useWellnessScore.test.ts` | Add tests for `computeScoreBreakdown` |
| `mobile/src/components/WellnessDetailSheet.tsx` | New — full sheet UI |
| `mobile/src/components/__tests__/WellnessDetailSheet.test.tsx` | New — render tests |
| `mobile/src/screens/HomeScreen.tsx` | Wrap `ScoreTile` in `TouchableOpacity`, add `showWellnessSheet` state, render sheet |

---

## Context You Need

### Existing `WellnessResult` type (in `useWellnessScore.ts`)
```typescript
export interface WellnessResult {
  score: number;
  history: number[];   // 7 daily scores oldest-first
  delta: number;       // today minus 7 days ago
  status: string;      // 'Excellent' | 'Good' | 'Fair' | 'At risk'
  statusColor: string;
}
```

### Existing `computeScore` formula (same file)
```typescript
// For each category with targetPct > 0:
const targetSpend = monthlyIncome * (pct / 100);
const ratio = targetSpend > 0 ? b.spent / targetSpend : 0;
const catScore = Math.max(0, Math.min(1, 1 - Math.max(0, ratio - 1)));
// catScore: 1.0 at-or-under budget, 0.5 at 50% over, 0.0 at 100%+ over
```

### Existing `BudgetCategory` type (in `useBudgets.ts`)
```typescript
export interface BudgetCategory {
  id: string;
  name: string;
  emoji: string;
  monthlyLimit: number;
  color: string;
  targetPct: number | null;
  spent: number;
  // ...other fields
}
```

### Existing `Transaction` model fields (WatermelonDB)
- `t.merchantName` — string | null
- `t.categoryL1` — string
- `t.categoryL2` — string | null
- `t.amount` — number (positive = expense)
- `t.pending` — boolean

### How `ScoreTile` is rendered in `HomeScreen.tsx` (line ~254)
```tsx
<ScoreTile
  width={width - 32}
  score={wellness.score}
  history={wellness.history}
  delta={wellness.delta}
  status={wellness.status}
  statusColor={wellness.statusColor}
/>
```
`ScoreTile` is currently a `View`. `width` comes from `useWindowDimensions()`. `wellness` is `useWellnessScore(transactions, budgets, incomeForScore, 7)`. `transactions` is already in scope (from `useCurrentPeriodTransactions()`).

### `makeBudget` helper already in `useWellnessScore.test.ts`
```typescript
const makeBudget = (name: string, targetPct: number, spent: number): BudgetCategory => ({
  id: name, name, emoji: '💰', monthlyLimit: 500, color: '#6366f1', targetPct, spent,
  isGoal: false, goalId: null, monthlyFloor: 0, priorityRank: null,
});
```

---

## Task 1 — `ScoreFactor` type and `computeScoreBreakdown()`

**Files:**
- Modify: `mobile/src/hooks/useWellnessScore.ts`
- Modify: `mobile/src/hooks/__tests__/useWellnessScore.test.ts`

- [ ] **Step 1: Add failing tests for `computeScoreBreakdown`**

Append to `mobile/src/hooks/__tests__/useWellnessScore.test.ts`:

```typescript
import { computeScore, computeStatus, computeScoreBreakdown } from '../useWellnessScore';
// (update the existing import line to add computeScoreBreakdown)

describe('computeScoreBreakdown', () => {
  it('returns [] when monthlyIncome is 0', () => {
    expect(computeScoreBreakdown([makeBudget('Food', 15, 100)], 0)).toEqual([]);
  });

  it('returns [] when no categories have targetPct > 0', () => {
    const b: BudgetCategory = { ...makeBudget('Food', 0, 100), targetPct: null };
    expect(computeScoreBreakdown([b], 1000)).toEqual([]);
  });

  it('returns catScore 100 and scoreDelta 0 for under-budget category', () => {
    const [f] = computeScoreBreakdown([makeBudget('Food', 100, 500)], 1000);
    expect(f.catScore).toBe(100);
    expect(f.scoreDelta).toBe(0);
  });

  it('returns catScore 50 and scoreDelta -50 for 50%-over single category', () => {
    // targetSpend = 1000, spent = 1500, ratio = 1.5
    // catScore = round((1 - 0.5) * 100) = 50
    // scoreDelta = round((50 - 100) * (100/100)) = -50
    const [f] = computeScoreBreakdown([makeBudget('Dining', 100, 1500)], 1000);
    expect(f.catScore).toBe(50);
    expect(f.scoreDelta).toBe(-50);
  });

  it('sorts worst catScore first', () => {
    const budgets = [
      makeBudget('Good', 50, 100),  // under budget → catScore 100
      makeBudget('Bad', 50, 900),   // way over → catScore 0
    ];
    const factors = computeScoreBreakdown(budgets, 1000);
    expect(factors[0].name).toBe('Bad');
    expect(factors[1].name).toBe('Good');
  });

  it('populates all fields correctly', () => {
    const b = makeBudget('Housing', 30, 270);
    // targetSpend = 1000 * 0.30 = 300; ratio = 0.9; catScore = 100; scoreDelta = 0
    const [f] = computeScoreBreakdown([b], 1000);
    expect(f.categoryId).toBe('Housing');
    expect(f.name).toBe('Housing');
    expect(f.color).toBe('#6366f1');
    expect(f.targetPct).toBe(30);
    expect(f.targetSpend).toBe(300);
    expect(f.actualSpend).toBe(270);
    expect(f.ratio).toBeCloseTo(0.9);
    expect(f.catScore).toBe(100);
    expect(f.scoreDelta).toBe(0);
  });

  it('splits scoreDelta proportionally across two categories', () => {
    // Each has 50% of total allocation
    // Cat A: 100% over → catScore 0; scoreDelta = (0-100) * 0.5 = -50
    // Cat B: under budget → catScore 100; scoreDelta = 0
    const budgets = [
      makeBudget('A', 50, 1000),  // targetSpend 500, spent 1000 → 100% over
      makeBudget('B', 50, 100),   // under budget
    ];
    const factors = computeScoreBreakdown(budgets, 1000);
    const a = factors.find(f => f.name === 'A')!;
    const b = factors.find(f => f.name === 'B')!;
    expect(a.scoreDelta).toBe(-50);
    expect(b.scoreDelta).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd budget-app/mobile
npx jest useWellnessScore --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `computeScoreBreakdown is not a function`

- [ ] **Step 3: Add `ScoreFactor` interface, `computeScoreBreakdown`, extend `WellnessResult`, update `useWellnessScore`**

In `mobile/src/hooks/useWellnessScore.ts`, make these changes:

**Add `ScoreFactor` interface** (after the `WellnessResult` interface):
```typescript
export interface ScoreFactor {
  categoryId: string;
  name: string;
  color: string;
  targetPct: number;    // e.g. 15
  targetSpend: number;  // monthlyIncome × (targetPct / 100)
  actualSpend: number;  // b.spent
  ratio: number;        // actualSpend / targetSpend
  catScore: number;     // 0–100 integer
  scoreDelta: number;   // global score points this category adds or costs
                        // = round((catScore - 100) × (targetPct / totalAllocatedPct))
}
```

**Extend `WellnessResult`** (add `factors` field):
```typescript
export interface WellnessResult {
  score: number;
  history: number[];
  delta: number;
  status: string;
  statusColor: string;
  factors: ScoreFactor[];  // sorted worst catScore first
}
```

**Add `computeScoreBreakdown` function** (after `computeScore`):
```typescript
export function computeScoreBreakdown(
  budgets: BudgetCategory[],
  monthlyIncome: number
): ScoreFactor[] {
  if (monthlyIncome <= 0) return [];
  const eligible = budgets.filter(b => b.targetPct != null && b.targetPct > 0);
  if (eligible.length === 0) return [];

  const totalAllocatedPct = eligible.reduce((s, b) => s + b.targetPct!, 0);

  return eligible
    .map(b => {
      const pct = b.targetPct!;
      const targetSpend = monthlyIncome * (pct / 100);
      const ratio = targetSpend > 0 ? b.spent / targetSpend : 0;
      const catScore = Math.round(
        Math.max(0, Math.min(1, 1 - Math.max(0, ratio - 1))) * 100
      );
      const scoreDelta = Math.round((catScore - 100) * (pct / totalAllocatedPct));
      return {
        categoryId: b.id,
        name: b.name,
        color: b.color,
        targetPct: pct,
        targetSpend,
        actualSpend: b.spent,
        ratio,
        catScore,
        scoreDelta,
      };
    })
    .sort((a, b) => a.catScore - b.catScore);
}
```

**Update `useWellnessScore`** — add `factors` to the return inside the `useMemo`:

Find the existing return statement inside `useMemo`:
```typescript
    const { label: status, color: statusColor } = computeStatus(score);
    return { score, history, delta, status, statusColor };
```

Replace with:
```typescript
    const { label: status, color: statusColor } = computeStatus(score);
    const factors = computeScoreBreakdown(budgets, monthlyIncome);
    return { score, history, delta, status, statusColor, factors };
```

- [ ] **Step 4: Run tests — all must pass**

```bash
npx jest useWellnessScore --no-coverage 2>&1 | tail -10
```

Expected: all tests pass including the 7 new `computeScoreBreakdown` tests.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/hooks/useWellnessScore.ts mobile/src/hooks/__tests__/useWellnessScore.test.ts
git commit -m "feat: add ScoreFactor type and computeScoreBreakdown to useWellnessScore"
```

---

## Task 2 — `WellnessDetailSheet` component

**Files:**
- Create: `mobile/src/components/WellnessDetailSheet.tsx`
- Create: `mobile/src/components/__tests__/WellnessDetailSheet.test.tsx`

- [ ] **Step 1: Write failing render tests**

Create `mobile/src/components/__tests__/WellnessDetailSheet.test.tsx`:

```typescript
import React from 'react';
import { render } from '@testing-library/react-native';
import { WellnessDetailSheet } from '../WellnessDetailSheet';
import { WellnessResult } from '../../hooks/useWellnessScore';

// react-native-svg is auto-mocked in this project's jest config
// Modal is rendered inline in test environment

const baseWellness: WellnessResult = {
  score: 72,
  history: [65, 68, 70, 71, 72, 71, 72],
  delta: 7,
  status: 'Good',
  statusColor: '#f59e0b',
  factors: [
    {
      categoryId: 'cat-1',
      name: 'Dining',
      color: '#ef4444',
      targetPct: 20,
      targetSpend: 800,
      actualSpend: 960,
      ratio: 1.2,
      catScore: 80,
      scoreDelta: -20,
    },
    {
      categoryId: 'cat-2',
      name: 'Housing',
      color: '#6366f1',
      targetPct: 30,
      targetSpend: 1200,
      actualSpend: 1000,
      ratio: 0.83,
      catScore: 100,
      scoreDelta: 0,
    },
  ],
};

describe('WellnessDetailSheet', () => {
  it('renders score and status when visible', () => {
    const { getByText } = render(
      <WellnessDetailSheet
        visible={true}
        onClose={() => {}}
        wellness={baseWellness}
        transactions={[]}
      />
    );
    expect(getByText('72')).toBeTruthy();
    expect(getByText('Good')).toBeTruthy();
  });

  it('renders factor rows for each category', () => {
    const { getByText } = render(
      <WellnessDetailSheet
        visible={true}
        onClose={() => {}}
        wellness={baseWellness}
        transactions={[]}
      />
    );
    expect(getByText('Dining')).toBeTruthy();
    expect(getByText('Housing')).toBeTruthy();
  });

  it('shows "on track" for catScore 100 category', () => {
    const { getByText } = render(
      <WellnessDetailSheet
        visible={true}
        onClose={() => {}}
        wellness={baseWellness}
        transactions={[]}
      />
    );
    expect(getByText('on track')).toBeTruthy();
  });

  it('shows negative scoreDelta for over-budget category', () => {
    const { getByText } = render(
      <WellnessDetailSheet
        visible={true}
        onClose={() => {}}
        wellness={baseWellness}
        transactions={[]}
      />
    );
    expect(getByText('-20 pts')).toBeTruthy();
  });

  it('shows empty state when factors is empty', () => {
    const { getByText } = render(
      <WellnessDetailSheet
        visible={true}
        onClose={() => {}}
        wellness={{ ...baseWellness, factors: [] }}
        transactions={[]}
      />
    );
    expect(getByText(/Set budget allocations/)).toBeTruthy();
  });

  it('does not render content when not visible', () => {
    const { queryByText } = render(
      <WellnessDetailSheet
        visible={false}
        onClose={() => {}}
        wellness={baseWellness}
        transactions={[]}
      />
    );
    // Modal with visible=false renders nothing in test environment
    expect(queryByText('72')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest WellnessDetailSheet --no-coverage 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../WellnessDetailSheet'`

- [ ] **Step 3: Create `WellnessDetailSheet.tsx`**

Create `mobile/src/components/WellnessDetailSheet.tsx`:

```typescript
import React, { useState } from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet,
} from 'react-native';
import Svg, { Polyline, Circle } from 'react-native-svg';
import { WellnessResult, ScoreFactor } from '../hooks/useWellnessScore';
import Transaction from '../db/models/Transaction';

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

// ─── Expanded Sparkline ───────────────────────────────────────────────────────

function ExpandedSparkline({ history, color }: { history: number[]; color: string }) {
  const [chartWidth, setChartWidth] = useState(300);
  const H = 120;
  const PAD = 12;

  if (history.length < 2) return null;

  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;

  const points = history.map((v, i) => {
    const x = PAD + (i / (history.length - 1)) * (chartWidth - PAD * 2);
    const y = PAD + (1 - (v - min) / range) * (H - PAD * 2);
    return `${x},${y}`;
  }).join(' ');

  const lastX = PAD + (chartWidth - PAD * 2);
  const lastY = PAD + (1 - (history[history.length - 1] - min) / range) * (H - PAD * 2);

  const dayLabels = history.map((_, i) => {
    const offset = history.length - 1 - i;
    const d = new Date();
    d.setDate(d.getDate() - offset);
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  });

  return (
    <View onLayout={e => setChartWidth(e.nativeEvent.layout.width)}>
      <Svg width={chartWidth} height={H}>
        <Polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle cx={lastX} cy={lastY} r={4} fill={color} />
      </Svg>
      <View style={s.dayRow}>
        {dayLabels.map((label, i) => (
          <Text key={i} style={s.dayLabel}>{label}</Text>
        ))}
      </View>
    </View>
  );
}

// ─── Transaction matching ─────────────────────────────────────────────────────

function topTransactionsForFactor(
  factor: ScoreFactor,
  transactions: Transaction[],
  limit = 2
): Transaction[] {
  const name = factor.name.toLowerCase();
  return transactions
    .filter(t =>
      t.amount > 0 &&
      !t.pending &&
      (t.categoryL1.toLowerCase() === name ||
       (t.categoryL2?.toLowerCase() ?? '') === name)
    )
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

// ─── Factor Row ───────────────────────────────────────────────────────────────

function FactorRow({ factor, transactions }: { factor: ScoreFactor; transactions: Transaction[] }) {
  const isOnTrack = factor.catScore === 100;
  const topTxns = isOnTrack ? [] : topTransactionsForFactor(factor, transactions);

  return (
    <View style={[s.factorRow, isOnTrack && s.factorRowMuted]}>
      <View style={[s.factorDot, { backgroundColor: factor.color }]} />
      <View style={s.factorContent}>
        <View style={s.factorTopLine}>
          <Text style={[s.factorName, isOnTrack && s.textMuted]}>{factor.name}</Text>
          <View style={s.factorRight}>
            <Text style={[s.factorRatioPct, { color: factor.ratio > 1 ? '#ef4444' : '#64748b' }]}>
              {Math.round(factor.ratio * 100)}%
            </Text>
            <Text style={[
              s.factorDeltaText,
              { color: isOnTrack ? '#475569' : '#ef4444' },
            ]}>
              {isOnTrack ? 'on track' : `${factor.scoreDelta} pts`}
            </Text>
          </View>
        </View>
        <Text style={[s.factorSpend, isOnTrack && s.textMuted]}>
          {fmt(factor.actualSpend)} / {fmt(factor.targetSpend)}
        </Text>
        {topTxns.length > 0 && (
          <Text style={s.factorTxns} numberOfLines={1}>
            {topTxns
              .map(t => `${t.merchantName ?? t.categoryL1} ${fmt(t.amount)}`)
              .join('  ·  ')}
          </Text>
        )}
      </View>
    </View>
  );
}

// ─── Sheet ────────────────────────────────────────────────────────────────────

interface WellnessDetailSheetProps {
  visible: boolean;
  onClose: () => void;
  wellness: WellnessResult;
  transactions: Transaction[];
}

export function WellnessDetailSheet({
  visible,
  onClose,
  wellness,
  transactions,
}: WellnessDetailSheetProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={s.container}>
        <View style={s.handle} />

        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerLabel}>WELLNESS SCORE</Text>
          <Text style={s.headerScore}>{wellness.score}</Text>
          <Text style={[s.headerStatus, { color: wellness.statusColor }]}>
            {wellness.status}
          </Text>
          <Text style={[
            s.headerDelta,
            { color: wellness.delta >= 0 ? '#4ade80' : '#ef4444' },
          ]}>
            {wellness.delta >= 0 ? '↑' : '↓'} {Math.abs(wellness.delta)} pts this week
          </Text>
        </View>

        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
          {/* Sparkline */}
          <Text style={s.sectionTitle}>7-day trend</Text>
          <View style={s.sparklineWrap}>
            <ExpandedSparkline history={wellness.history} color={wellness.statusColor} />
          </View>

          {/* Factor list */}
          <Text style={s.sectionTitle}>What's affecting your score</Text>
          {wellness.factors.length === 0 ? (
            <Text style={s.emptyHint}>
              Set budget allocations on the Plan tab to see your score breakdown.
            </Text>
          ) : (
            wellness.factors.map(factor => (
              <FactorRow
                key={factor.categoryId}
                factor={factor}
                transactions={transactions}
              />
            ))
          )}
        </ScrollView>

        <TouchableOpacity style={s.closeBtn} onPress={onClose} activeOpacity={0.75}>
          <Text style={s.closeBtnText}>Close</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0f1e' },
  handle: {
    width: 40, height: 4, backgroundColor: '#334155', borderRadius: 2,
    alignSelf: 'center', marginTop: 12, marginBottom: 8,
  },
  header: { alignItems: 'center', paddingVertical: 20, paddingHorizontal: 24 },
  headerLabel: {
    fontSize: 10, color: '#f59e0b', letterSpacing: 1.5, marginBottom: 8,
  },
  headerScore: { fontSize: 56, fontWeight: '800', color: '#e2e8f0', letterSpacing: -2 },
  headerStatus: { fontSize: 14, fontWeight: '600', marginTop: 4 },
  headerDelta: { fontSize: 13, marginTop: 6 },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 24 },

  sectionTitle: {
    fontSize: 11, color: '#64748b', letterSpacing: 1, textTransform: 'uppercase',
    marginTop: 20, marginBottom: 12,
  },
  sparklineWrap: { backgroundColor: '#0d1526', borderRadius: 10, padding: 12 },
  dayRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  dayLabel: { fontSize: 9, color: '#475569' },

  factorRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#0d1526',
  },
  factorRowMuted: { opacity: 0.5 },
  factorDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4, marginRight: 12 },
  factorContent: { flex: 1 },
  factorTopLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  factorName: { fontSize: 13, color: '#cbd5e1', fontWeight: '500' },
  factorRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  factorRatioPct: { fontSize: 12, fontWeight: '600' },
  factorDeltaText: { fontSize: 11, fontWeight: '500', minWidth: 56, textAlign: 'right' },
  factorSpend: { fontSize: 11, color: '#475569', marginTop: 2 },
  factorTxns: { fontSize: 10, color: '#334155', marginTop: 4 },
  textMuted: { color: '#475569' },

  emptyHint: { fontSize: 13, color: '#475569', textAlign: 'center', paddingVertical: 24 },

  closeBtn: {
    margin: 20, backgroundColor: '#1e293b', borderRadius: 10, paddingVertical: 14,
    alignItems: 'center',
  },
  closeBtnText: { fontSize: 15, color: '#e2e8f0', fontWeight: '600' },
});
```

- [ ] **Step 4: Run tests — all must pass**

```bash
npx jest WellnessDetailSheet --no-coverage 2>&1 | tail -10
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/WellnessDetailSheet.tsx mobile/src/components/__tests__/WellnessDetailSheet.test.tsx
git commit -m "feat: add WellnessDetailSheet component with sparkline and factor breakdown"
```

---

## Task 3 — Wire sheet into `HomeScreen`

**Files:**
- Modify: `mobile/src/screens/HomeScreen.tsx`

- [ ] **Step 1: Add `WellnessDetailSheet` import**

At the top of `HomeScreen.tsx`, add:
```typescript
import { WellnessDetailSheet } from '../components/WellnessDetailSheet';
```

- [ ] **Step 2: Add `showWellnessSheet` state**

In the `HomeScreen` component body, alongside the existing `useState` calls (around line 192):
```typescript
const [showWellnessSheet, setShowWellnessSheet] = useState(false);
```

- [ ] **Step 3: Wrap `ScoreTile` in `TouchableOpacity`**

Find (around line 254):
```tsx
        <ScoreTile
          width={width - 32}
          score={wellness.score}
          history={wellness.history}
          delta={wellness.delta}
          status={wellness.status}
          statusColor={wellness.statusColor}
        />
```

Replace with:
```tsx
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => setShowWellnessSheet(true)}
        >
          <ScoreTile
            width={width - 32}
            score={wellness.score}
            history={wellness.history}
            delta={wellness.delta}
            status={wellness.status}
            statusColor={wellness.statusColor}
          />
        </TouchableOpacity>
```

- [ ] **Step 4: Render `WellnessDetailSheet`**

At the bottom of the `HomeScreen` return, just before the closing `</>`, add:
```tsx
        <WellnessDetailSheet
          visible={showWellnessSheet}
          onClose={() => setShowWellnessSheet(false)}
          wellness={wellness}
          transactions={transactions}
        />
```

The full return structure will look like:
```tsx
  return (
    <>
      <ScrollView ...>
        {/* ...existing content... */}
      </ScrollView>

      {/* Transaction detail modal — already here */}
      <Modal ...>...</Modal>

      {/* Wellness detail sheet — new */}
      <WellnessDetailSheet
        visible={showWellnessSheet}
        onClose={() => setShowWellnessSheet(false)}
        wellness={wellness}
        transactions={transactions}
      />
    </>
  );
```

- [ ] **Step 5: Run full test suite**

```bash
npx jest --passWithNoTests 2>&1 | tail -8
```

Expected: all existing tests still pass (102+). No type errors.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/screens/HomeScreen.tsx
git commit -m "feat: make ScoreTile tappable — opens WellnessDetailSheet on press"
```

---

## Self-Review

**Spec coverage:**
- ✓ Sheet triggered by tapping score tile
- ✓ Header: score, status, delta
- ✓ Expanded sparkline with day labels
- ✓ Per-category factor list sorted worst first
- ✓ `scoreDelta` shows pts impact (negative = hurting)
- ✓ On-track categories shown muted at bottom with "on track" label
- ✓ Top-2 transactions shown for over-budget categories
- ✓ Empty state when no factors
- ✓ Close button
- ✓ No DB changes, no new persistence

**Type consistency check:**
- `ScoreFactor.categoryId` used as `key` in map ✓
- `WellnessResult.factors: ScoreFactor[]` matches `computeScoreBreakdown` return type ✓
- `WellnessDetailSheet` props use `WellnessResult` and `Transaction[]` ✓
- `topTransactionsForFactor` uses `ScoreFactor` and `Transaction[]` ✓
