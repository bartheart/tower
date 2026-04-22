# Wellness Detail Sheet — Design Spec

## Overview

Tapping the Wellness Score tile on HomeScreen opens a bottom sheet showing two things: a 7-day score sparkline (trend over time) and a per-category factor breakdown (what is helping or hurting the score right now). No new backend, no new persistence — all data is derived from the existing in-memory `useWellnessScore` result.

---

## Motivation

The wellness score tile shows a number and a delta but gives no explanation. Users can't tell why the score moved or which spending categories are responsible. This sheet provides that transparency without requiring a separate screen or any database changes.

Issue #36. Per-transaction drill-down is deferred to issue #47.

---

## Architecture

Three units of change:

| Unit | Responsibility |
|------|---------------|
| `computeScoreBreakdown()` in `useWellnessScore.ts` | Pure function — returns per-category contribution data. Extends `WellnessResult` with a `factors` array. |
| `WellnessDetailSheet.tsx` (new) | The sheet UI — header, sparkline, factor list. Receives `WellnessResult` + current month's transactions as props. Stateless. |
| `HomeScreen.tsx` | Makes `ScoreTile` tappable. Manages `showWellnessSheet` boolean state. Passes `wellness` and `transactions` into the sheet. |

No new hooks, no new DB tables, no navigation changes.

---

## Data Model

### `ScoreFactor`

```typescript
export interface ScoreFactor {
  categoryId: string;
  name: string;
  color: string;
  targetPct: number;    // e.g. 15 — the bucket's allocation %
  targetSpend: number;  // monthlyIncome × (targetPct / 100)
  actualSpend: number;  // b.spent
  ratio: number;        // actualSpend / targetSpend (1.0 = exactly on budget)
  catScore: number;     // 0–100, same formula as computeScore
  scoreDelta: number;   // global score points this category adds or costs
                        // = (catScore - 100) × (targetPct / totalAllocatedPct)
                        // negative = hurting the score, positive = contributing
}
```

`scoreDelta` is how many global points this category is costing or adding. A category at 100% of budget contributes 0 delta change (it's doing its part). A category 50% over budget costs points proportional to its weight.

### `computeScoreBreakdown()`

```typescript
export function computeScoreBreakdown(
  budgets: BudgetCategory[],
  monthlyIncome: number
): ScoreFactor[]
```

- Filters to categories with `targetPct > 0`
- Computes the same `catScore` formula as `computeScore`
- Computes `scoreDelta = (catScore - 100) * (targetPct / totalAllocatedPct)`
- Returns array sorted worst catScore first (most damaging → least damaging)
- Returns `[]` if `monthlyIncome <= 0` or no eligible categories

### `WellnessResult` extension

```typescript
export interface WellnessResult {
  score: number;
  history: number[];
  delta: number;
  status: string;
  statusColor: string;
  factors: ScoreFactor[];  // NEW — sorted worst first
}
```

`useWellnessScore` calls `computeScoreBreakdown` and attaches the result. No change to existing fields.

---

## UI — WellnessDetailSheet

### Trigger

`ScoreTile` gains an `onPress` prop. `HomeScreen` manages `const [showWellnessSheet, setShowWellnessSheet] = useState(false)`. Pressing the tile sets it `true`; the sheet's close button or backdrop dismiss sets it `false`.

### Modal

`Modal` with `animationType="slide"` and `presentationStyle="pageSheet"` — same pattern as `BucketDetailSheet`. Contains a `ScrollView` for the factor list.

### Header section

- "WELLNESS SCORE" label (small caps, amber, same as tile)
- Score number (large, ~48px, bold)
- Status label in `statusColor` (Excellent / Good / Fair / At risk)
- Delta badge: "↑ 5 pts this week" / "↓ 3 pts this week" in green/red

### Sparkline section

- Full-width, ~120px tall — larger version of the existing `Sparkline` component
- Day labels along the bottom: Mon · Tue · Wed · Thu · Fri · Sat · Sun (or actual date initials based on `history` length)
- Score value shown at the rightmost (today) point
- Line color = `statusColor`
- Section header: "7-day trend"

### Factor list

Section header: "What's affecting your score"

One row per `ScoreFactor`, sorted worst catScore first:

```
● Dining          $312 / $270    115%    −8 pts
    · Cheesecake Factory $89  · Uber Eats $34

● Housing         $820 / $1,040   79%    on track
```

**Row anatomy:**
- Colored dot (bucket color)
- Category name
- `$actualSpend / $targetSpend` (dollar amounts, no decimals)
- Ratio % — red if ratio > 1.0, muted gray if ≤ 1.0
- Score delta — red + "−N pts" if negative, green + "+N pts" if positive, "on track" in muted gray if catScore = 100

**Over-budget detail line (catScore < 100 only):**
- Up to 2 top transactions for that category, matched from current-month transactions by `plaidCategory` or category name (case-insensitive)
- Format: `· Merchant $amount · Merchant $amount`
- Muted color (`#475569`)
- If no transactions match: detail line is omitted silently

**On-track categories:** shown at the bottom of the list, visually de-emphasized (reduced opacity 0.5, no detail line). Not hidden — user can see all categories.

**Empty state:** If no categories have `targetPct` set, show a single centered line: "Set budget allocations on the Plan tab to see your score breakdown."

---

## Transaction Matching

To find top transactions per category, `WellnessDetailSheet` receives the current month's `transactions: Transaction[]` as a prop (already loaded in `HomeScreen`). Matching logic:

```typescript
function topTransactionsForCategory(
  category: ScoreFactor,
  transactions: Transaction[],
  limit = 2
): Transaction[] {
  return transactions
    .filter(t =>
      t.amount > 0 &&
      !t.pending &&
      (t.categoryL1.toLowerCase() === category.name.toLowerCase() ||
       t.categoryL2?.toLowerCase() === category.name.toLowerCase())
    )
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}
```

This is a simple name match — no fuzzy logic. Issue #47 (transaction → bucket classifier) will improve this later.

---

## Files Changed

| File | Change |
|------|--------|
| `mobile/src/hooks/useWellnessScore.ts` | Add `ScoreFactor` interface, `computeScoreBreakdown()`, extend `WellnessResult.factors`, call from `useWellnessScore` |
| `mobile/src/hooks/__tests__/useWellnessScore.test.ts` | Add tests for `computeScoreBreakdown` — scoreDelta math, sort order, zero-income edge case |
| `mobile/src/components/WellnessDetailSheet.tsx` | New — sheet component with header, sparkline, factor list |
| `mobile/src/components/__tests__/WellnessDetailSheet.test.tsx` | New — render tests: sheet hidden by default, shows correct factor rows, empty state |
| `mobile/src/screens/HomeScreen.tsx` | Add `showWellnessSheet` state, `onPress` to `ScoreTile`, render `WellnessDetailSheet` |

---

## Out of Scope

- Score history persistence beyond 7 days (issue #20)
- Per-transaction drill-down within a category (issue #47)
- Score change explainer triggered by sync (issue #36 original framing — superseded by this sheet)
- Animated sparkline scrubbing / interactive chart
