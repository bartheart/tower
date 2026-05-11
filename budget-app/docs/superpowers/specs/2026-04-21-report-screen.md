# Report Screen Design Spec

## Overview

`ReportScreen` is a full-screen analytics view that shows the user how their spending maps against their budget for a given period. It combines three sections: a summary card (total spent vs total budget), a Sankey flow chart (income → L1 category → L2 category → merchant), and an expandable per-budget breakdown list. A floating "Adjust Plan" button at the bottom navigates back to the Plan screen to modify budgets.

The screen is navigable from the Home screen (period/budget tap) or from any budget row.

## Architecture

**File:** `mobile/src/screens/ReportScreen.tsx`

**Data sources:**
- `useCurrentPeriodTransactions(period)` — returns all non-pending, confirmed transactions for the current week or month
- `useBudgets(transactions)` — derives budget objects from the transaction list; each budget has `spent`, `monthlyLimit`, `monthlyFloor`, `color`, `isGoal`, and `id`
- `useIncome()` — returns `confirmedMonthlyIncome` (user-set) from local storage/DB
- `useMonthlyIncome(transactions)` — detected income estimated from transaction list
- Effective income: `confirmedMonthlyIncome > 0 ? confirmedMonthlyIncome : detectedIncome`

**Navigation params (read via `useRoute`):**
- `period: Period` — `'week'` or `'month'`; defaults to `'month'`
- `budgetId: string | undefined` — if present, scrolls the matching budget row to the top of the breakdown list and auto-expands it

**Layout:**
- `View` (flex: 1, dark background `#0f172a`) containing a `ScrollView` + a position-absolute FAB wrapper
- `RefreshControl` on the `ScrollView` triggers `reloadBudgets()`
- Safe-area insets applied via `useSafeAreaInsets` to `paddingTop` and FAB `bottom`

## Budget Report Section

### `BudgetReportRow` component

An inline component (`BudgetReportRow`) defined inside `ReportScreen.tsx`, rendered once per budget.

**Props:**
```typescript
{
  budget: ReturnType<typeof useBudgets>['budgets'][0];
  transactions: Transaction[];
  autoExpand: boolean;
}
```

**Expand/collapse:** Local `useState(autoExpand)`. Tapping the row header toggles the expanded state. The toggle control renders as `  −` (expanded) or `  +` (collapsed) inline with the spent amount.

**Ratio and color coding:**

| Condition | Bar color |
|-----------|-----------|
| `ratio > 1` (over budget) | `#ef4444` (red) |
| `ratio > 0.7` (approaching limit) | `#f59e0b` (amber) |
| Otherwise | `budget.color` |

Where `ratio = budget.spent / budget.monthlyLimit` (0 if limit is 0).

The spent amount text also turns `#ef4444` when over budget, and an `!` is appended to the displayed amount.

**Allocation bar:** A 5px-tall progress bar capped at 100% of the bar width (`Math.min(ratio, 1) * 100`). Renders inside `barTrackWrap` (relative-positioned) so the floor marker can be absolutely positioned over it.

**Floor marker:** A 2×9px vertical tick rendered at `(budget.monthlyFloor / budget.monthlyLimit) * 100%` from the left, only when both `monthlyFloor > 0` and `monthlyLimit > 0`. Color: `#94a3b8`.

**Sub-label:** `"{spent} spent · {limit} budget [· {floor} fixed floor]"` — the floor clause is omitted when `monthlyFloor === 0`.

**Goal badge:** When `budget.isGoal`, a `"Goal"` label in `#a5b4fc` is rendered beneath the budget name.

**Per-transaction drill-down (expanded):** Filters `transactions` to those where `amount > 0`, `pending === false`, and `categoryL1 === budget.name || categoryL2 === budget.name`. Sorted descending by `date` string. Each row shows `merchantName` + `date` on the left, formatted amount on the right. Empty state: `"No transactions in this category."`.

### Summary card

Rendered above the breakdown list. Shows:
- `TOTAL SPENT` (sum of all `budget.spent`) and `BUDGET` (sum of all `budget.monthlyLimit`) side-by-side
- A summary progress bar using the same three-color logic: red at `> 1`, amber at `> 0.8`, indigo `#6366f1` otherwise
- `"Monthly income: {income} (detected|confirmed)"` — label parenthetical depends on whether `confirmedMonthlyIncome === 0`

### Breakdown sort order

When a `budgetId` param is present, the matching budget row is sorted to position 0. Remaining rows are sorted descending by spend ratio.

## Sankey Chart

### `buildSankeyData` — `mobile/src/sankey/buildGraph.ts`

Pure function. Takes a transaction array and an income amount; returns `{ nodes: SankeyNode[], links: SankeyLink[] }`.

**Node construction:**
- Node 0 is always `'Income'` with `value = incomeAmount`
- Nodes are added lazily via `getOrAddNode(name)` using a `Map<string, index>` for O(1) deduplication

**Transaction filter:** Only transactions with `amount > 0` and `categoryL1` not equal to `'Income'` and not containing `'Transfer'` are included.

**Link aggregation:** Links are accumulated in a `Map<"source||target", totalAmount>`. Three links are emitted per transaction:
1. `Income → categoryL1`
2. `categoryL1 → categoryL2` (skipped when `categoryL2 === categoryL1`)
3. `categoryL2 → merchantName` (source is `categoryL2` if different from `categoryL1`, otherwise `categoryL1`)

**Link resolution:** After aggregation, `linkMap` entries are converted to `SankeyLink` objects where `source` and `target` are the actual `SankeyNode` objects (not indices). This is required by `d3-sankey`.

**Fallbacks:** `categoryL1` defaults to `'Other'` if falsy; `categoryL2` defaults to `categoryL1`; `merchantName` defaults to `'Unknown'`.

### `SankeyChart` component — `mobile/src/sankey/SankeyChart.tsx`

**Props:**
```typescript
{
  data: SankeyData;
  width: number;
  height: number;
  onNodePress?: (nodeName: string) => void;
}
```

**Layout constants:**
- `NODE_WIDTH = 12`
- `NODE_PADDING = 14`
- Extent: `[[8, 8], [width - 80, height - 8]]` — 80px right margin to fit node labels

**d3-sankey integration:** The `sankey()` layout from `d3-sankey` is called inside a `useMemo`. Node names are re-indexed from the `SankeyData` before passing to the layout. The `try/catch` around the layout call returns empty `{ nodes: [], links: [] }` on any error.

**Color assignment:** A `useMemo`-derived `Map<nodeName, color>` assigns colors from a 10-color palette cyclically by node index:
```
['#4ade80', '#6366f1', '#f59e0b', '#ef4444', '#a78bfa', '#fb923c', '#fcd34d', '#818cf8', '#34d399', '#f87171']
```

**SVG rendering (react-native-svg):**
- `Path` elements for links: colored by source node's color, `strokeOpacity: 0.35`, `strokeWidth = Math.max(1, link.width)`
- `Rect` elements for nodes: `rx={2}`, `opacity: 1` for Income node, `0.85` for all others
- `SvgText` elements for node labels: positioned at `x = node.x1 + 4`, vertically centered between `y0` and `y1`, `fontSize: 9`, colored matching the node

**Node press:** The `Rect` for each node has `onPress={() => onNodePress?.(node.name)}`. In `ReportScreen`, `onNodePress` is not currently wired (no handler is passed).

### Integration in ReportScreen

```typescript
const sankeyData = useMemo(() => buildSankeyData(transactions, income), [transactions, income]);
```

Rendered inside a `ScrollView` with `minimumZoomScale={1}`, `maximumZoomScale={4}`, `bouncesZoom`. Height is fixed at 280px for the outer scroll container; `SankeyChart` renders at `height={260}`. A `"Pinch to zoom"` hint label appears below.

The chart is only rendered when `sankeyData.nodes.length > 1` (i.e., at least one spending transaction exists). Otherwise: `"No data yet — sync your accounts to see the flow."`.

## Navigation

### Incoming params

| Param | Type | Source | Effect |
|-------|------|--------|--------|
| `period` | `'week' \| 'month'` | HomeScreen or push notification | Selects transaction window |
| `budgetId` | `string` | Tapping a budget row anywhere | Sorts matching budget to top, auto-expands, shown in header title |
| `focusedBudget` | — | Derived locally from `budgetId` lookup | Not a route param; computed as `budgets.find(b => b.id === budgetId)` |

The header title shows `focusedBudget.name` when a `budgetId` is provided, otherwise `'Report'`.

### "Adjust Plan" FAB

Positioned absolutely at `bottom + 16`, full-width minus 16px gutters. On press:

```typescript
navigation.navigate('Tabs', {
  screen: 'Plan',
  params: {
    planningTab: 'buckets',
    highlightId: budgetId,
  },
});
```

## Known Issues

- **Scroll-to `budgetId` not implemented.** The spec originally called for `ScrollView.scrollTo` after render to bring the focused budget into view. The current implementation only sorts it to position 0 and auto-expands it; no imperative scroll is performed. This means on long lists the user must scroll manually to see the focused row.
- **No spec existed before this document.** This spec is being written retroactively from the implementation.
- **No screen-level tests.** `ReportScreen` has no test file.

## Test Coverage

### What is tested

`mobile/src/sankey/__tests__/buildGraph.test.ts` covers `buildSankeyData`:

| Test | Assertion |
|------|-----------|
| Builds nodes from transaction list | Verifies `Income`, `Food and Drink`, `Groceries`, `Whole Foods` are in `nodes` |
| Link values are correct aggregations | `Food and Drink → Groceries` link value = 200 (120 + 80) |
| Income node value equals provided income amount | `nodes[0].value === 5200` |

The test data includes an income transaction (`amount: -5200`) which is correctly excluded from the graph by the `amount > 0` filter.

### What is missing

| Area | Gap |
|------|-----|
| `SankeyChart` render | No render test; pinch-zoom behavior, color assignment, and SVG output are untested |
| `ReportScreen` | No integration or snapshot test |
| `BudgetReportRow` | Expand/collapse, color thresholds, floor marker, and drill-down filtering are untested |
| `buildSankeyData` edge cases | No tests for empty transactions, Transfer filtering, or missing L2 categories |

## Files

| File | Role |
|------|------|
| `mobile/src/screens/ReportScreen.tsx` | Screen + `BudgetReportRow` component |
| `mobile/src/sankey/buildGraph.ts` | `buildSankeyData` pure function |
| `mobile/src/sankey/SankeyChart.tsx` | SVG Sankey renderer |
| `mobile/src/sankey/__tests__/buildGraph.test.ts` | Unit tests for `buildSankeyData` |
